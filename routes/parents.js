const express = require('express');
const crypto = require('crypto');
const router = express.Router();

router.post('/request-otp', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number required' });

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

  res.json({ phone: rows[0].phone, verified: true });
});

router.get('/dashboard/:phone', async (req, res) => {
  const { phone } = req.params;

  const [children] = await req.db.execute(
    `SELECT s.student_id, s.full_name, c.class_name, s.school_id,
       (SELECT status FROM attendance_logs WHERE student_id = s.student_id ORDER BY attendance_date DESC LIMIT 1) AS last_attendance,
       (SELECT attendance_date FROM attendance_logs WHERE student_id = s.student_id ORDER BY attendance_date DESC LIMIT 1) AS last_date
     FROM students s
     JOIN classes c ON s.class_id = c.class_id
     JOIN student_parent_map m ON s.student_id = m.student_id
     WHERE m.parent_phone = ? AND s.enrollment_status = 'Active'`,
    [phone]
  );

  const schoolId = children.length > 0 ? children[0].school_id : null;

  const [parent] = await req.db.execute(
    'SELECT is_premium, premium_expires_at FROM parent_profiles WHERE parent_phone = ?',
    [phone]
  );

  res.json({
    parent: parent[0] || { is_premium: false },
    school_id: schoolId,
    children
  });
});

module.exports = router;
