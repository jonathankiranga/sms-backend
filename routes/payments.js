const express = require('express');
const crypto = require('crypto');
const { authenticate } = require('../lib/auth');
const router = express.Router();

async function getSchoolByCallbackKey(db, callbackKey) {
  const [rows] = await db.execute(
    'SELECT mpesa_consumer_key, mpesa_consumer_secret, mpesa_passkey, mpesa_paybill, mpesa_environment, mpesa_callback_key, school_id FROM schools WHERE mpesa_callback_key = ? LIMIT 1',
    [callbackKey]
  );
  return rows[0];
}

async function ensureSchoolCallbackKey(db, school_id) {
  const [rows] = await db.execute('SELECT mpesa_callback_key FROM schools WHERE school_id = ? LIMIT 1', [school_id]);
  if (rows.length === 0) return null;
  let key = rows[0].mpesa_callback_key;
  if (!key) {
    for (let attempt = 0; attempt < 5; attempt++) {
      key = crypto.randomBytes(16).toString('hex');
      try {
        await db.execute('UPDATE schools SET mpesa_callback_key = ? WHERE school_id = ?', [key, school_id]);
        break;
      } catch (err) {
        if (err && err.code === 'ER_DUP_ENTRY') {
          key = null;
          continue;
        }
        throw err;
      }
    }
  }
  return key;
}

async function handleC2BConfirmation(req, res) {
  const { TransID, TransAmount, MSISDN, BillRefNumber } = req.body;
  if (!TransID || !MSISDN || !BillRefNumber) {
    return res.status(400).json({ ResultCode: 1, ResultDesc: 'Missing required fields' });
  }

  const connection = await req.db.getConnection();
  try {
    await connection.beginTransaction();

    const [existing] = await connection.execute(
      'SELECT parent_phone FROM parent_profiles WHERE parent_phone = ?',
      [MSISDN]
    );

    if (existing.length === 0) {
      await connection.execute(
        'INSERT INTO parent_profiles (parent_phone, is_premium) VALUES (?, FALSE)',
        [MSISDN]
      );
      await connection.execute(
        'INSERT IGNORE INTO student_parent_map (student_id, parent_phone) VALUES (?, ?)',
        [BillRefNumber, MSISDN]
      );
    }

    let c2bExpires = new Date(Date.now() + 90 * 86400000);
    const [c2bStudent] = await connection.execute('SELECT school_id FROM students WHERE student_id = ?', [BillRefNumber]);
    if (c2bStudent.length > 0) {
      const [c2bTerm] = await connection.execute(
        'SELECT MIN(start_date) AS next_start FROM school_terms WHERE school_id = ? AND start_date > CURDATE()',
        [c2bStudent[0].school_id]
      );
      if (c2bTerm.length > 0 && c2bTerm[0].next_start) c2bExpires = new Date(c2bTerm[0].next_start);
    }

    await connection.execute(
      'UPDATE parent_profiles SET is_premium = TRUE, premium_expires_at = ? WHERE parent_phone = ?',
      [c2bExpires, MSISDN]
    );

    await connection.execute(
      'INSERT INTO payment_ledger (transaction_reference, amount, parent_phone, student_reference, payment_method, logged_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [TransID, parseFloat(TransAmount || 0), MSISDN, BillRefNumber, 'M-Pesa']
    );

    await connection.commit();
    console.log(`[PAYMENT] ${MSISDN} paid ${TransAmount} — premium active 90 days`);
    return res.status(200).json({ ResultCode: 0, ResultDesc: 'Confirmation received successfully' });
  } catch (err) {
    await connection.rollback();
    console.error('[MPESA ERROR]', err.message);
    return res.status(500).json({ ResultCode: 1, ResultDesc: 'Internal Server Error' });
  } finally {
    connection.release();
  }
}

async function handleStkCallback(req, res, school_id) {
  try {
    const { Body } = req.body;
    if (!Body || !Body.stkCallback) {
      return res.status(200).json({ ResultCode: 1, ResultDesc: 'Invalid callback' });
    }

    const { ResultCode, ResultDesc, CallbackMetadata } = Body.stkCallback;
    if (ResultCode !== 0) {
      console.log(`[STK][${school_id || 'GLOBAL'}] Payment failed:`, ResultDesc);
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Received' });
    }

    const items = CallbackMetadata?.Item || [];
    const getVal = (name) => {
      const item = items.find(i => i.Name === name);
      return item ? item.Value : null;
    };

    const phoneOrHash = (getVal('PhoneNumber') || '').toString();
    const amount = parseFloat(getVal('Amount') || 0);
    const receipt = (getVal('MpesaReceiptNumber') || '').toString();
    const ref = (Body.stkCallback.AccountReference || '').toString();

    console.log(`[STK][${school_id || 'GLOBAL'}] ${phoneOrHash} paid KSh ${amount} — ref ${receipt} (${ref})`);

    const [pending] = await req.db.execute(
      "SELECT parent_phone, school_id AS ledger_school_id FROM payment_ledger WHERE transaction_reference = ? AND notes = 'STK_PENDING' LIMIT 1",
      [ref]
    );
    const pendingParentPhone = pending.length > 0 ? pending[0].parent_phone : null;

    const isHashed = /^[a-f0-9]{64}$/i.test(phoneOrHash);
    let phone = phoneOrHash;
    if (pendingParentPhone) {
      phone = pendingParentPhone;
    }

    if (isHashed && !pendingParentPhone) {
      console.warn(`[STK] Cannot resolve hashed phone for ref ${ref}`);
      await req.db.execute(
        'INSERT IGNORE INTO payment_ledger (transaction_reference, amount, parent_phone, student_reference, payment_method, logged_at, notes) VALUES (?, ?, ?, ?, ?, NOW(), ?)',
        [receipt, amount, phoneOrHash, ref, 'M-Pesa', 'HASHED_PHONE_UNRESOLVED']
      );
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Success — pending manual reconciliation' });
    }

    if (ref.startsWith('UPG') || ref.startsWith('BAZPAY-')) {
      // Allocate to the school tagged on the pending ledger row (per-school upgrade),
      // then the callback route's school, then the parent's first linked student's school.
      const ledgerSchoolId = pending.length > 0 ? pending[0].ledger_school_id : null;
      const [link] = await req.db.execute(
        'SELECT s.school_id FROM students s JOIN student_parent_map m ON s.student_id = m.student_id WHERE m.parent_phone = ? ORDER BY s.school_id LIMIT 1',
        [phone]
      );
      const activeSchoolId = ledgerSchoolId || school_id || (link.length > 0 ? link[0].school_id : null);

      let expiresAt = new Date(Date.now() + 90 * 86400000);
      if (activeSchoolId) {
        const [termRow] = await req.db.execute(
          'SELECT MIN(start_date) AS next_start FROM school_terms WHERE school_id = ? AND start_date > CURDATE()',
          [activeSchoolId]
        );
        if (termRow.length > 0 && termRow[0].next_start) {
          expiresAt = new Date(termRow[0].next_start);
        }
      }
      await req.db.execute(
        'UPDATE parent_profiles SET is_premium = TRUE, premium_expires_at = ? WHERE parent_phone = ?',
        [expiresAt, phone]
      );

      const currentTerm = `Term ${Math.ceil((new Date().getMonth() + 1) / 4)}`;
      const currentYear = new Date().getFullYear();
      if (activeSchoolId) {
        await req.db.execute(
          `INSERT INTO premium_subscriptions
           (school_id, parent_phone, term, year, payment_model, payment_status, amount, activated_at, expires_at)
           VALUES (?, ?, ?, ?, 'parent', 'paid', ?, NOW(), ?)
           ON DUPLICATE KEY UPDATE payment_status = 'paid', activated_at = NOW(), expires_at = VALUES(expires_at), amount = VALUES(amount)`,
          [activeSchoolId, phone, currentTerm, currentYear, amount, expiresAt]
        );
      }

      await req.db.execute(
        "UPDATE payment_ledger SET notes = 'STK_COMPLETED', transaction_reference = ? WHERE transaction_reference = ? AND notes = 'STK_PENDING'",
        [receipt, ref]
      );
    }

    if (ref.startsWith('BLK-')) {
      const paymentId = parseInt(ref.replace('BLK-', ''), 10);
      const currentTerm = `Term ${Math.ceil((new Date().getMonth() + 1) / 4)}`;
      const currentYear = new Date().getFullYear();
      await req.db.execute(
        "UPDATE premium_bulk_payments SET payment_status = 'completed', paid_at = NOW(), transaction_reference = ? WHERE payment_id = ?",
        [receipt, paymentId]
      );

      const activeSchoolId = school_id || null;
      if (activeSchoolId) {
        const [parents] = await req.db.execute(
          `SELECT DISTINCT spm.parent_phone
           FROM student_parent_map spm
           JOIN students s ON spm.student_id = s.student_id
           WHERE s.school_id = ? AND s.enrollment_status = 'Active'`,
          [activeSchoolId]
        );
        const { getNextTermStart } = require('../lib/config');
        const expiresAt = await getNextTermStart(req.db, activeSchoolId);
        for (const p of parents) {
          await req.db.execute(
            'INSERT IGNORE INTO parent_profiles (parent_phone, is_premium) VALUES (?, FALSE)',
            [p.parent_phone]
          );
          await req.db.execute(
            `INSERT INTO premium_subscriptions (school_id, parent_phone, term, year, payment_model, payment_status, amount, activated_at, expires_at)
             VALUES (?, ?, ?, ?, 'school', 'paid', 0, NOW(), ?)
             ON DUPLICATE KEY UPDATE payment_status = 'paid', activated_at = NOW(), expires_at = VALUES(expires_at)`,
            [activeSchoolId, p.parent_phone, currentTerm, currentYear, expiresAt]
          );
          await req.db.execute(
            'UPDATE parent_profiles SET is_premium = TRUE, premium_expires_at = ? WHERE parent_phone = ?',
            [expiresAt, p.parent_phone]
          );
        }
        console.log(`[BLK][${activeSchoolId}] Bulk premium activated for ${parents.length} parents`);
      }
    }

    await req.db.execute(
      `INSERT IGNORE INTO payment_ledger (transaction_reference, amount, parent_phone, student_reference, payment_method, school_id, term, academic_year, logged_at)
       VALUES (?, ?, ?, ?, 'M-Pesa', ?, ?, ?, NOW())`,
      [receipt, amount, phone, ref, school_id || null, Body.stkCallback.term || null, Body.stkCallback.year || null]
    );

    return res.status(200).json({ ResultCode: 0, ResultDesc: 'Success' });
  } catch (err) {
    console.error(`[STK CALLBACK ERROR][${school_id || 'GLOBAL'}]`, err.message);
    return res.status(200).json({ ResultCode: 0, ResultDesc: 'Received' });
  }
}

// POST /v1/payments/query — query STK Push status by checkout_request_id or transaction reference
router.post('/query', async (req, res) => {
  const { checkout_request_id, transaction_reference } = req.body;
  if (!checkout_request_id && !transaction_reference) {
    return res.status(400).json({ error: 'checkout_request_id or transaction_reference required' });
  }

  // Check ledger first if reference supplied
  if (transaction_reference) {
    const [ledger] = await req.db.execute(
      'SELECT notes, transaction_reference FROM payment_ledger WHERE transaction_reference = ? OR (notes = "STK_COMPLETED" AND transaction_reference = ?) LIMIT 1',
      [transaction_reference, transaction_reference]
    );
    if (ledger.length > 0 && ledger[0].notes === 'STK_COMPLETED') {
      return res.json({ status: 'completed', ResultCode: '0', ResultDesc: 'The service request is processed successfully.' });
    }
  }

  if (checkout_request_id && process.env.MPESA_CONSUMER_KEY && process.env.MPESA_CONSUMER_SECRET) {
    try {
      const mpesa = require('../services/mpesa');
      const result = await mpesa.stkPushQuery(checkout_request_id);
      return res.json({
        status: result.ResultCode === '0' ? 'completed' : result.ResultCode === '1032' ? 'cancelled' : 'pending',
        ResultCode: result.ResultCode,
        ResultDesc: result.ResultDesc,
        detail: result
      });
    } catch (err) {
      console.error('[STK QUERY ERROR]', err.message);
      return res.status(500).json({ error: 'Failed to query STK Push status', message: err.message });
    }
  }

  return res.json({ status: 'pending', ResultCode: '1', ResultDesc: 'Payment pending confirmation' });
});

// M-Pesa C2B confirmation callback (Safaricom → us)
router.post('/mpesa', async (req, res) => {
  return handleC2BConfirmation(req, res);
});

router.post('/secret/:callback_key/v', async (req, res) => {
  const { callback_key } = req.params;
  const school = await getSchoolByCallbackKey(req.db, callback_key);
  if (!school) {
    return res.status(404).json({ ResultCode: 1, ResultDesc: 'School not found' });
  }
  return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

router.post('/secret/:callback_key/c', async (req, res) => {
  const { callback_key } = req.params;
  const school = await getSchoolByCallbackKey(req.db, callback_key);
  if (!school) {
    return res.status(404).json({ ResultCode: 1, ResultDesc: 'School not found' });
  }
  return handleC2BConfirmation(req, res);
});

router.post('/secret/:callback_key/s', async (req, res) => {
  const { callback_key } = req.params;
  const school = await getSchoolByCallbackKey(req.db, callback_key);
  if (!school) {
    return res.status(404).json({ ResultCode: 1, ResultDesc: 'School not found' });
  }
  return handleStkCallback(req, res, school.school_id);
});

// ===== Public short-form proxy routes (internal rewrite/proxy) =====
router.post('/cb/:callback_key/v', async (req, res) => {
  const { callback_key } = req.params;
  const school = await getSchoolByCallbackKey(req.db, callback_key);
  if (!school) return res.status(404).json({ ResultCode: 1, ResultDesc: 'School not found' });
  return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

router.post('/cb/:callback_key/c', async (req, res) => {
  const { callback_key } = req.params;
  const school = await getSchoolByCallbackKey(req.db, callback_key);
  if (!school) return res.status(404).json({ ResultCode: 1, ResultDesc: 'School not found' });
  return handleC2BConfirmation(req, res);
});

router.post('/cb/:callback_key/s', async (req, res) => {
  const { callback_key } = req.params;
  const school = await getSchoolByCallbackKey(req.db, callback_key);
  if (!school) return res.status(404).json({ ResultCode: 1, ResultDesc: 'School not found' });
  return handleStkCallback(req, res, school.school_id);
});

// STK Push callback (Safaricom → us after STK push)
router.post('/callback', async (req, res) => {
  return handleStkCallback(req, res, null);
});

// ===== Dynamic per-school M-Pesa routes =====

// POST /v1/payments/stkpush — initiate STK push using the VENDOR's MPESA account
// This endpoint is intended for bazar subscription collection, not regular fee collection.
router.post('/stkpush', authenticate, async (req, res) => {
  const { school_id, phone, parent_phone, amount, reference, description, purpose, term, year } = req.body;
  if (!phone || !amount) return res.status(400).json({ error: 'phone and amount required' });
  if (!school_id) return res.status(400).json({ error: 'school_id required for vendor STK collection' });

  const [schoolRows] = await req.db.execute(
    'SELECT mpesa_callback_key, school_id FROM schools WHERE school_id = ?',
    [school_id]
  );
  if (schoolRows.length === 0) return res.status(404).json({ error: 'School not found' });

  const callbackKey = schoolRows[0].mpesa_callback_key || await ensureSchoolCallbackKey(req.db, school_id);
  const ref = reference || `BAZPAY-${(parent_phone || phone).replace(/\D/g, '').slice(-6)}-${Date.now().toString(36).toUpperCase()}`;
  const mpesa = require('../services/mpesa');

  if (purpose === 'parent_subscription' || ref.startsWith('BAZPAY-')) {
    if (!parent_phone) {
      return res.status(400).json({ error: 'parent_phone is required for parent_subscription STK collection' });
    }
    await req.db.execute(
      `INSERT INTO payment_ledger
       (transaction_reference, amount, parent_phone, student_reference, payment_method, school_id, term, academic_year, notes, logged_at)
       VALUES (?, ?, ?, ?, 'M-Pesa-Pending', ?, ?, ?, 'STK_PENDING', NOW())`,
      [ref, amount, parent_phone, `SUB-${parent_phone}`, school_id, term || null, year || null]
    );
  }

  const result = await mpesa.stkPush(
    phone,
    amount,
    ref,
    description || 'Bazar subscription collection',
    { callbackKey }
  );

  if (result.ResponseCode === '0') {
    return res.json({
      status: 'pending',
      message: `M-Pesa STK push sent to ${phone}. Ask the bazar/vendor to enter their PIN.`,
      checkout_request_id: result.CheckoutRequestID,
      transaction_reference: ref,
      amount
    });
  }

  return res.status(502).json({ error: 'M-Pesa STK push failed', detail: result });
});

// POST /v1/payments/:school_id/callback — Daraja callback per school
router.post('/:school_id/callback', async (req, res) => {
  const { school_id } = req.params;
  try {
    const { Body } = req.body;
    if (!Body || !Body.stkCallback) {
      return res.status(200).json({ ResultCode: 1, ResultDesc: 'Invalid callback' });
    }

    const { ResultCode, ResultDesc, CallbackMetadata } = Body.stkCallback;
    if (ResultCode !== 0) {
      console.log(`[STK][${school_id}] Payment failed:`, ResultDesc);
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Received' });
    }

    const items = CallbackMetadata?.Item || [];
    const getVal = (name) => { const item = items.find(i => i.Name === name); return item ? item.Value : null; };

    const phone = (getVal('PhoneNumber') || '').toString();
    const amount = parseFloat(getVal('Amount') || 0);
    const receipt = (getVal('MpesaReceiptNumber') || '').toString();
    const ref = (Body.stkCallback.AccountReference || '').toString();

    console.log(`[STK][${school_id}] ${phone} paid KSh ${amount} — ref ${receipt} (${ref})`);

    await req.db.execute(
      `INSERT INTO payment_ledger (transaction_reference, amount, parent_phone, student_reference, payment_method, school_id, term, academic_year, logged_at)
       VALUES (?, ?, ?, ?, 'M-Pesa', ?, ?, ?, NOW())`,
      [receipt, amount, phone, ref, school_id, Body.stkCallback.term || null, Body.stkCallback.year || null]
    );

    // Handle bulk premium payment (BLK prefix) — school pays for all students
    if (ref.startsWith('BLK-')) {
      const paymentId = parseInt(ref.replace('BLK-', ''), 10);
      const currentTerm = `Term ${Math.ceil((new Date().getMonth() + 1) / 4)}`;
      const currentYear = new Date().getFullYear();
      // Mark the bulk payment as completed
      await req.db.execute(
        "UPDATE premium_bulk_payments SET payment_status = 'completed', paid_at = NOW(), transaction_reference = ? WHERE payment_id = ?",
        [receipt, paymentId]
      );
      // Get all parents of active students in this school
      const [parents] = await req.db.execute(
        `SELECT DISTINCT spm.parent_phone
         FROM student_parent_map spm
         JOIN students s ON spm.student_id = s.student_id
         WHERE s.school_id = ? AND s.enrollment_status = 'Active'`,
        [school_id]
      );
      const { getNextTermStart } = require('../lib/config');
      const expiresAt = await getNextTermStart(req.db, school_id);
      for (const p of parents) {
        await req.db.execute(
          'INSERT IGNORE INTO parent_profiles (parent_phone, is_premium) VALUES (?, FALSE)',
          [p.parent_phone]
        );
        await req.db.execute(
          `INSERT INTO premium_subscriptions (school_id, parent_phone, term, year, payment_model, payment_status, amount, activated_at, expires_at)
           VALUES (?, ?, ?, ?, 'school', 'paid', 0, NOW(), ?)
           ON DUPLICATE KEY UPDATE payment_status = 'paid', activated_at = NOW(), expires_at = VALUES(expires_at)`,
          [school_id, p.parent_phone, currentTerm, currentYear, expiresAt]
        );
        await req.db.execute(
          'UPDATE parent_profiles SET is_premium = TRUE, premium_expires_at = ? WHERE parent_phone = ?',
          [expiresAt, p.parent_phone]
        );
      }
      console.log(`[BLK][${school_id}] Bulk premium activated for ${parents.length} parents`);
    }

    res.status(200).json({ ResultCode: 0, ResultDesc: 'Success' });
  } catch (err) {
    console.error(`[STK CALLBACK ERROR][${school_id}]`, err.message);
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Received' });
  }
});

// POST /v1/payments/:school_id/register — register C2B URLs for this school
router.post('/:school_id/register', async (req, res) => {
  const { school_id } = req.params;
  const [schoolRows] = await req.db.execute(
    'SELECT mpesa_consumer_key, mpesa_consumer_secret, mpesa_passkey, mpesa_paybill, mpesa_environment, school_id FROM schools WHERE school_id = ?',
    [school_id]
  );
  if (schoolRows.length === 0) return res.status(404).json({ error: 'School not found' });

  const callbackKey = await ensureSchoolCallbackKey(req.db, school_id);
  if (!callbackKey) return res.status(500).json({ error: 'Unable to ensure callback key' });

  const baseUrl = process.env.BASE_URL || 'https://sms-backend-r0tn.onrender.com';
  const mpesa = require('../services/mpesa');
  const result = await mpesa.registerC2BUrls(
    `${baseUrl}/v1/payments/secret/${callbackKey}/v`,
    `${baseUrl}/v1/payments/secret/${callbackKey}/c`
  );
  res.json({ ...result, mpesa_callback_key: callbackKey });
});

module.exports = router;
router.ensureSchoolCallbackKey = ensureSchoolCallbackKey;
