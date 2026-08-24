const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const router = express.Router();

// Request OTP using phone or email. Teachers and headteachers may sign in with email or phone.
router.post('/request-otp', async (req, res) => {
  const { phone, email } = req.body;
  if (!phone && !email) return res.status(400).json({ error: 'Phone or email required' });

  // Find teacher by phone or email
  const [teacher] = await req.db.execute(
    'SELECT teacher_id, school_id, role FROM teachers WHERE phone = ? OR email = ? LIMIT 1',
    [phone || '', email || '']
  );
  if (teacher.length === 0) return res.status(404).json({ error: 'No teacher found with that phone or email' });

  const code = Math.floor(1000 + Math.random() * 9000).toString();
  const sessionId = crypto.randomBytes(32).toString('hex');

  // Store session with phone and/or email populated.
  // otp_sessions.phone is NOT NULL, so use '' (empty string) for email-only logins.
  await req.db.execute(
    'INSERT INTO otp_sessions (session_id, phone, email, code, expires_at, verified) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE), FALSE)',
    [sessionId, phone || '', email || null, code]
  );

  try {
    const messaging = require('../services/messaging');
    if (email) {
      if (messaging.sendEmailOtp) await messaging.sendEmailOtp(email, code);
      else console.log('=== Email OTP for', email, ':', code, '===');
    } else {
      await messaging.sendOtp(phone, code);
    }
  } catch (e) {
    console.error('OTP send failed (non-blocking):', e.message);
    if (email) console.log('=== Email OTP for', email, ':', code, '===');
    else console.log('=== OTP for', phone, ':', code, '===');
  }

  res.json({ session_id: sessionId, message: 'OTP sent' });
});

// Verify OTP (works for phone or email-backed sessions). Returns session_id as bearer token for 4 hours.
router.post('/verify-otp', async (req, res) => {
  const { session_id, code } = req.body;
  if (!session_id || !code) return res.status(400).json({ error: 'Missing session_id or code' });

  const [rows] = await req.db.execute(
    'SELECT phone FROM otp_sessions WHERE session_id = ? AND code = ? AND expires_at > NOW() AND verified = FALSE',
    [session_id, code]
  );

  if (rows.length === 0) {
    // Distinguish an expired-but-correct code from a plain wrong one
    const [expiredRows] = await req.db.execute(
      'SELECT phone FROM otp_sessions WHERE session_id = ? AND code = ? AND verified = FALSE',
      [session_id, code]
    );
    if (expiredRows.length > 0) {
      return res.status(410).json({ error: 'Code expired - tap Resend to get a new one' });
    }
    return res.status(401).json({ error: 'Invalid or expired code' });
  }

  // Mark OTP session as verified and extend session expiry to 4 hours so session_id can be used as bearer token
  await req.db.execute('UPDATE otp_sessions SET verified = TRUE, expires_at = DATE_ADD(NOW(), INTERVAL 4 HOUR) WHERE session_id = ?', [session_id]);

  const phone = rows[0].phone;
  // Try to resolve teacher by phone first; if not found, try by email mapping in otp_sessions
  let [teacher] = await req.db.execute('SELECT teacher_id, school_id, role FROM teachers WHERE phone = ?', [phone]);
  if (!teacher || teacher.length === 0) {
    // If no phone mapping, try to read email from otp_sessions (migration adds email column)
    const [sessRows] = await req.db.execute('SELECT email FROM otp_sessions WHERE session_id = ?', [session_id]);
    const email = (sessRows[0] && sessRows[0].email) ? sessRows[0].email : null;
    if (email) {
      [teacher] = await req.db.execute('SELECT teacher_id, school_id, role FROM teachers WHERE email = ?', [email]);
    }
  }

  if (!teacher || teacher.length === 0) return res.status(404).json({ error: 'Teacher not found' });

  // Return the opaque session_id (created during request-otp) as the bearer token. No server-side SECRET required.
  res.json({ teacher_id: teacher[0].teacher_id, school_id: teacher[0].school_id, role: teacher[0].role, session_id, verified: true });
});

// Google sign-in for teachers. When GOOGLE_CLIENT_ID is configured, verify id_token with Google.
// For development (no GOOGLE_CLIENT_ID), a dev endpoint is available at /auth/google/dev to create a verified session for an existing teacher email.
router.post('/auth/google', async (req, res) => {
  const { id_token } = req.body;
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
  if (!id_token) return res.status(400).json({ error: 'Missing id_token' });
  if (!GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google OAuth not configured on server' });

  try {
    const r = await axios.get('https://oauth2.googleapis.com/tokeninfo', { params: { id_token } });
    const email = r.data.email;
    const emailVerified = r.data.email_verified === 'true' || r.data.email_verified === true;
    if (!emailVerified) return res.status(401).json({ error: 'Google account not verified' });

    // Only allow sign-in for existing teachers
    const [teacher] = await req.db.execute('SELECT teacher_id, school_id, role FROM teachers WHERE email = ?', [email]);
    if (teacher.length === 0) return res.status(404).json({ error: 'No teacher account for this Google email' });

    // Create a verified otp_session to reuse the session flow
    const sessionId = crypto.randomBytes(32).toString('hex');
    await req.db.execute('INSERT INTO otp_sessions (session_id, phone, email, code, expires_at, verified) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 4 HOUR), TRUE)', [sessionId, '', email, '0000']);

    res.json({ teacher_id: teacher[0].teacher_id, school_id: teacher[0].school_id, role: teacher[0].role, session_id, verified: true });
  } catch (err) {
    console.error('Google token verification failed:', err.message);
    return res.status(401).json({ error: 'Invalid Google token' });
  }
});

// Development-only Google sign-in (no secrets required). Use only in non-production environments.
router.post('/auth/google/dev', async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(403).json({ error: 'Dev endpoint disabled in production' });
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Missing email for dev sign-in' });
  // Ensure teacher exists
  const [teacher] = await req.db.execute('SELECT teacher_id, school_id, role FROM teachers WHERE email = ?', [email]);
  if (teacher.length === 0) return res.status(404).json({ error: 'Teacher not found' });
  const sessionId = crypto.randomBytes(32).toString('hex');
  await req.db.execute('INSERT INTO otp_sessions (session_id, phone, email, code, expires_at, verified) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 4 HOUR), TRUE)', [sessionId, '', email, '0000']);
  res.json({ teacher_id: teacher[0].teacher_id, school_id: teacher[0].school_id, role: teacher[0].role, session_id, verified: true });
});

module.exports = router;
