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

module.exports = router;
