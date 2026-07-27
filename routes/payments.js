const express = require('express');
const { authenticate } = require('../lib/auth');
const router = express.Router();

// M-Pesa C2B confirmation callback (Safaricom → us)
router.post('/mpesa', async (req, res) => {
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

    // Resolve school from student to compute term-based expiry
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

    res.status(200).json({ ResultCode: 0, ResultDesc: 'Confirmation received successfully' });
  } catch (err) {
    await connection.rollback();
    console.error('[MPESA ERROR]', err.message);
    res.status(500).json({ ResultCode: 1, ResultDesc: 'Internal Server Error' });
  } finally {
    connection.release();
  }
});

// STK Push callback (Safaricom → us after STK push)
router.post('/callback', async (req, res) => {
  try {
    const { Body } = req.body;
    if (!Body || !Body.stkCallback) {
      return res.status(200).json({ ResultCode: 1, ResultDesc: 'Invalid callback' });
    }

    const { ResultCode, ResultDesc, CallbackMetadata } = Body.stkCallback;

    if (ResultCode !== 0) {
      console.log('[STK] Payment failed:', ResultDesc);
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Received' });
    }

    const items = CallbackMetadata?.Item || [];
    const getVal = (name) => {
      const item = items.find(i => i.Name === name);
      return item ? item.Value : null;
    };

    const phone = (getVal('PhoneNumber') || '').toString();
    const amount = parseFloat(getVal('Amount') || 0);
    const receipt = (getVal('MpesaReceiptNumber') || '').toString();
    const ref = (Body.stkCallback.AccountReference || '').toString();

    console.log(`[STK] ${phone} paid KSh ${amount} — ref ${receipt} (${ref})`);

    // If reference starts with UPG, it's a premium upgrade for a parent
    if (ref.startsWith('UPG')) {
      // Resolve school from parent's linked children to compute term-based expiry
      const [link] = await req.db.execute(
        'SELECT s.school_id FROM students s JOIN student_parent_map m ON s.student_id = m.student_id WHERE m.parent_phone = ? LIMIT 1',
        [phone]
      );
      let expiresAt = new Date(Date.now() + 90 * 86400000);
      if (link.length > 0) {
        const [termRow] = await req.db.execute(
          'SELECT MIN(start_date) AS next_start FROM school_terms WHERE school_id = ? AND start_date > CURDATE()',
          [link[0].school_id]
        );
        if (termRow.length > 0 && termRow[0].next_start) {
          expiresAt = new Date(termRow[0].next_start);
        }
      }
      await req.db.execute(
        'UPDATE parent_profiles SET is_premium = TRUE, premium_expires_at = ? WHERE parent_phone = ?',
        [expiresAt, phone]
      );
    }

    // If reference starts with CAM, it's a merchant campaign payment
    if (ref.startsWith('CAM')) {
      const campaignId = ref.replace('CAM', '');
      await req.db.execute(
        'UPDATE marketplace_campaigns SET status = \'Active\' WHERE ad_id = ?',
        [campaignId]
      );
    }

    await req.db.execute(
      'INSERT INTO payment_ledger (transaction_reference, amount, parent_phone, student_reference, payment_method, logged_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [receipt, amount, phone, ref, 'M-Pesa']
    );

    res.status(200).json({ ResultCode: 0, ResultDesc: 'Success' });
  } catch (err) {
    console.error('[STK CALLBACK ERROR]', err.message);
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Received' });
  }
});

// ===== Dynamic per-school M-Pesa routes =====

// POST /v1/payments/:school_id/stkpush — initiate STK push using school's credentials
router.post('/:school_id/stkpush', authenticate, async (req, res) => {
  const { school_id } = req.params;
  const { phone, amount, reference, description } = req.body;
  if (!phone || !amount) return res.status(400).json({ error: 'phone and amount required' });

  const [schoolRows] = await req.db.execute(
    'SELECT mpesa_consumer_key, mpesa_consumer_secret, mpesa_passkey, mpesa_paybill, mpesa_environment, school_id FROM schools WHERE school_id = ?',
    [school_id]
  );
  if (schoolRows.length === 0) return res.status(404).json({ error: 'School not found' });

  const mpesa = require('../services/mpesa');
  const result = await mpesa.stkPush(phone, amount, reference || `SCH_${school_id}_${Date.now()}`, description || 'School Fee', schoolRows[0]);
  res.json(result);
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

  const baseUrl = process.env.BASE_URL || 'https://sms-backend-r0tn.onrender.com';
  const mpesa = require('../services/mpesa');
  const result = await mpesa.registerC2BUrls(
    `${baseUrl}/v1/payments/${school_id}/validation`,
    `${baseUrl}/v1/payments/${school_id}/confirmation`,
    schoolRows[0]
  );
  res.json(result);
});

module.exports = router;
