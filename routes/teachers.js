const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const router = express.Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const STAFF_LOGIN_ROLES = ['teacher', 'head', 'bursar', 'school_admin'];

function normalizeEmail(value) {
  return value ? String(value).trim().toLowerCase() : '';
}

function normalizePhone(value) {
  return value ? String(value).replace(/[\\s-]/g, '').replace(/^\\+/, '') : '';
}

async function findSchoolMembership(db, { schoolId, role, phone, email }) {
  const normalizedPhone = normalizePhone(phone);
  const normalizedEmail = normalizeEmail(email);
  const [rows] = await db.execute(
    `SELECT t.teacher_id, t.staff_account_id, t.school_id, t.role, t.active,
            m.membership_id, m.status AS membership_status
     FROM teachers t
     LEFT JOIN teacher_school_memberships m
       ON m.teacher_id = t.teacher_id AND m.school_id = t.school_id
     WHERE t.school_id = ? AND t.role = ?
       AND ((? <> '' AND REPLACE(REPLACE(REPLACE(t.phone, ' ', ''), '-', ''), '+', '') = ?)
         OR (? <> '' AND LOWER(TRIM(t.email)) = ?))
     LIMIT 2`,
    [schoolId, role, normalizedPhone, normalizedPhone, normalizedEmail, normalizedEmail]
  );

  if (rows.length > 1) return { ambiguous: true };
  if (!rows.length) return { membership: null };
  const row = rows[0];
  if (row.active === 0 || row.membership_status === 'inactive' || row.membership_status === 'suspended') {
    return { inactive: true };
  }
  return { membership: row };
}

// The school is deliberately selected before the contact is submitted.
// School selection is not authorization: membership is checked server-side.
router.post('/request-otp', wrap(async (req, res) => {
  const schoolId = String(req.body.school_id || '').trim();
  const phone = normalizePhone(req.body.phone);
  const email = normalizeEmail(req.body.email);
  const role = String(req.body.role || '').toLowerCase();

  if (!schoolId) return res.status(400).json({ error: 'Select a school before requesting an OTP', code: 'SCHOOL_REQUIRED' });
  if (!phone && !email) return res.status(400).json({ error: 'Phone or email required' });
  if (!STAFF_LOGIN_ROLES.includes(role)) return res.status(400).json({ error: 'Valid role required (teacher, head, bursar or school_admin)' });

  const [schoolRows] = await req.db.execute('SELECT school_id FROM schools WHERE school_id = ? LIMIT 1', [schoolId]);
  if (!schoolRows.length) return res.status(404).json({ error: 'School not found' });

  const found = await findSchoolMembership(req.db, { schoolId, role, phone, email });
  if (found.ambiguous) return res.status(409).json({ error: 'More than one matching staff account exists in this school. Contact the school administrator.' });
  if (!found.membership) return res.status(404).json({ error: 'No staff membership found for this school and role' });
  if (found.inactive) return res.status(403).json({ error: 'Your membership is inactive. Contact your school administrator.' });

  const code = crypto.randomInt(1000, 10000).toString();
  const sessionId = crypto.randomBytes(32).toString('hex');
  await req.db.execute(
    `INSERT INTO otp_sessions
       (session_id, phone, email, code, expires_at, verified, teacher_id, school_id, login_role)
     VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE), FALSE, '', ?, ?)`,
    [sessionId, phone, email || null, code, schoolId, role]
  );

  try {
    const messaging = require('../services/messaging');
    if (email) {
      if (messaging.sendEmailOtp) await messaging.sendEmailOtp(email, code);
      else throw new Error('Email OTP delivery is not configured');
    } else {
      await messaging.sendOtp(phone, code);
    }
  } catch (err) {
    console.error('[STAFF OTP] Delivery failed:', err.message);
    await req.db.execute('DELETE FROM otp_sessions WHERE session_id = ?', [sessionId]);
    return res.status(503).json({ error: 'Unable to send the verification code. Please try again.' });
  }

  res.json({ session_id: sessionId, message: 'OTP sent', school_id: schoolId });
}));

router.post('/verify-otp', wrap(async (req, res) => {
  const sessionId = String(req.body.session_id || '').trim();
  const code = String(req.body.code || '').trim();
  const role = String(req.body.role || '').toLowerCase();
  if (!sessionId || !code) return res.status(400).json({ error: 'Missing session_id or code' });
  if (!STAFF_LOGIN_ROLES.includes(role)) return res.status(400).json({ error: 'Valid role required (teacher, head, bursar or school_admin)' });

  const [sessions] = await req.db.execute(
    `SELECT phone, email, school_id, login_role
     FROM otp_sessions
     WHERE session_id = ? AND code = ? AND expires_at > NOW() AND verified = FALSE
     LIMIT 1`,
    [sessionId, code]
  );
  if (!sessions.length) {
    const [expired] = await req.db.execute(
      'SELECT session_id FROM otp_sessions WHERE session_id = ? AND code = ? AND verified = FALSE LIMIT 1',
      [sessionId, code]
    );
    return res.status(expired.length ? 410 : 401).json({
      error: expired.length ? 'Code expired - request a new one' : 'Invalid or expired code'
    });
  }

  const session = sessions[0];
  if (!session.school_id || session.login_role !== role) {
    return res.status(403).json({ error: 'The selected school or login role does not match this verification session' });
  }

  const found = await findSchoolMembership(req.db, {
    schoolId: session.school_id,
    role,
    phone: session.phone,
    email: session.email
  });
  if (found.ambiguous) return res.status(409).json({ error: 'Staff membership is ambiguous. Contact the school administrator.' });
  if (!found.membership) return res.status(404).json({ error: 'Staff membership no longer exists for the selected school' });
  if (found.inactive) return res.status(403).json({ error: 'Your membership is inactive. Contact your school administrator.' });

  const teacher = found.membership;
  await req.db.execute(
    'UPDATE otp_sessions SET verified = TRUE, expires_at = DATE_ADD(NOW(), INTERVAL 4 HOUR), teacher_id = ? WHERE session_id = ?',
    [teacher.teacher_id, sessionId]
  );

  let terms = null;
  if (teacher.role === 'head') {
    try {
      const { TERMS } = require('../terms/headteacher');
      await req.db.execute(`CREATE TABLE IF NOT EXISTS terms_acceptance (
        teacher_id VARCHAR(40) NOT NULL,
        accepted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ip_address VARCHAR(45) NULL,
        PRIMARY KEY (teacher_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      const [termsRows] = await req.db.execute(
        'SELECT accepted_at FROM terms_acceptance WHERE teacher_id = ?',
        [teacher.teacher_id]
      );
      terms = {
        required: true,
        version: TERMS.version,
        accepted: termsRows.length > 0,
        accepted_at: termsRows.length ? termsRows[0].accepted_at : null
      };
    } catch (err) {
      console.error('[TERMS] Failed to read acceptance status:', err.message);
    }
  }

  res.json({
    teacher_id: teacher.teacher_id,
    staff_account_id: teacher.staff_account_id || null,
    membership_id: teacher.membership_id || null,
    school_id: teacher.school_id,
    role: teacher.role,
    session_id: sessionId,
    verified: true,
    terms
  });
}));

// Google sign-in is also school-scoped; an email alone never selects a school.
router.post('/auth/google', wrap(async (req, res) => {
  const { id_token } = req.body;
  const schoolId = String(req.body.school_id || '').trim();
  const role = String(req.body.role || '').toLowerCase();
  const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
  if (!schoolId) return res.status(400).json({ error: 'Select a school before signing in', code: 'SCHOOL_REQUIRED' });
  if (!STAFF_LOGIN_ROLES.includes(role)) return res.status(400).json({ error: 'Valid role required' });
  if (!id_token) return res.status(400).json({ error: 'Missing id_token' });
  if (!googleClientId) return res.status(503).json({ error: 'Google OAuth not configured on server' });

  try {
    const response = await axios.get('https://oauth2.googleapis.com/tokeninfo', { params: { id_token } });
    const email = normalizeEmail(response.data.email);
    const emailVerified = response.data.email_verified === 'true' || response.data.email_verified === true;
    if (!emailVerified) return res.status(401).json({ error: 'Google account not verified' });

    const found = await findSchoolMembership(req.db, { schoolId, role, email });
    if (found.ambiguous) return res.status(409).json({ error: 'Staff membership is ambiguous for this school' });
    if (!found.membership) return res.status(404).json({ error: 'No staff membership for this school and Google account' });
    if (found.inactive) return res.status(403).json({ error: 'Your membership is inactive' });

    const teacher = found.membership;
    const sessionId = crypto.randomBytes(32).toString('hex');
    await req.db.execute(
      `INSERT INTO otp_sessions
        (session_id, phone, email, code, expires_at, verified, teacher_id, school_id, login_role)
       VALUES (?, '', ?, 'GOOGLE-OAUTH', DATE_ADD(NOW(), INTERVAL 4 HOUR), TRUE, ?, ?, ?)`,
      [sessionId, email, teacher.teacher_id, schoolId, role]
    );
    res.json({
      teacher_id: teacher.teacher_id,
      staff_account_id: teacher.staff_account_id || null,
      membership_id: teacher.membership_id || null,
      school_id: teacher.school_id,
      role: teacher.role,
      session_id: sessionId,
      verified: true
    });
  } catch (err) {
    console.error('Google token verification failed:', err.message);
    return res.status(401).json({ error: 'Invalid Google token' });
  }
}));

router.post('/auth/google/dev', wrap(async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(403).json({ error: 'Dev endpoint disabled in production' });
  const email = normalizeEmail(req.body.email);
  const schoolId = String(req.body.school_id || '').trim();
  const role = String(req.body.role || '').toLowerCase();
  if (!email || !schoolId || !STAFF_LOGIN_ROLES.includes(role)) {
    return res.status(400).json({ error: 'Email, school_id and valid role are required' });
  }

  const found = await findSchoolMembership(req.db, { schoolId, role, email });
  if (found.ambiguous) return res.status(409).json({ error: 'Staff membership is ambiguous for this school' });
  if (!found.membership) return res.status(404).json({ error: 'Teacher not found in selected school' });
  if (found.inactive) return res.status(403).json({ error: 'Your membership is inactive' });

  const teacher = found.membership;
  const sessionId = crypto.randomBytes(32).toString('hex');
  await req.db.execute(
    `INSERT INTO otp_sessions
      (session_id, phone, email, code, expires_at, verified, teacher_id, school_id, login_role)
     VALUES (?, '', ?, 'DEV-OAUTH', DATE_ADD(NOW(), INTERVAL 4 HOUR), TRUE, ?, ?, ?)`,
    [sessionId, email, teacher.teacher_id, schoolId, role]
  );
  res.json({
    teacher_id: teacher.teacher_id,
    staff_account_id: teacher.staff_account_id || null,
    membership_id: teacher.membership_id || null,
    school_id: teacher.school_id,
    role: teacher.role,
    session_id: sessionId,
    verified: true
  });
}));

module.exports = router;
