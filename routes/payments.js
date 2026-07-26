const express = require('express');
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

    await connection.execute(
      `UPDATE parent_profiles SET is_premium = TRUE, premium_expires_at = DATE_ADD(NOW(), INTERVAL 90 DAY) WHERE parent_phone = ?`,
      [MSISDN]
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
      await req.db.execute(
        'UPDATE parent_profiles SET is_premium = TRUE, premium_expires_at = DATE_ADD(NOW(), INTERVAL 90 DAY) WHERE parent_phone = ?',
        [phone]
      );
      await req.db.execute(
        'INSERT IGNORE INTO parent_profiles (parent_phone, is_premium) VALUES (?, TRUE)',
        [phone]
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
router.post('/:school_id/stkpush', async (req, res) => {
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
