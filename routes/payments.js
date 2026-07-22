const express = require('express');
const router = express.Router();

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

module.exports = router;
