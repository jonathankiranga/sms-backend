const express = require('express');
const crypto = require('crypto');
const router = express.Router();

router.post('/request-otp', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number required' });

  const [teacher] = await req.db.execute(
    'SELECT teacher_id, school_id FROM teachers WHERE phone = ?',
    [phone]
  );
  if (teacher.length === 0) return res.status(404).json({ error: 'No teacher found with this phone' });

  const code = Math.floor(1000 + Math.random() * 9000).toString();
  const sessionId = crypto.randomBytes(32).toString('hex');

  await req.db.execute(
    'INSERT INTO otp_sessions (session_id, phone, code, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))',
    [sessionId, phone, code]
  );

  try {
    const { sendOtp } = require('../services/messaging');
    await sendOtp(phone, code);
  } catch (e) {
    console.error('OTP send failed (non-blocking):', e.message);
  }

  res.json({ session_id: sessionId, message: 'OTP sent' });
});

router.post('/verify-otp', async (req, res) => {
  const { session_id, code } = req.body;
  if (!session_id || !code) return res.status(400).json({ error: 'Missing session_id or code' });

  const [rows] = await req.db.execute(
    'SELECT phone FROM otp_sessions WHERE session_id = ? AND code = ? AND expires_at > NOW() AND verified = FALSE',
    [session_id, code]
  );

  if (rows.length === 0) return res.status(401).json({ error: 'Invalid or expired code' });

  await req.db.execute('UPDATE otp_sessions SET verified = TRUE WHERE session_id = ?', [session_id]);

  const [teacher] = await req.db.execute(
    'SELECT teacher_id, school_id FROM teachers WHERE phone = ?',
    [rows[0].phone]
  );

  res.json({ teacher_id: teacher[0].teacher_id, school_id: teacher[0].school_id, verified: true });
});

module.exports = router;
