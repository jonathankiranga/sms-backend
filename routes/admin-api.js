const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'jonathankiranga@gmail.com';

// ─── ADMIN EMAIL-OTP LOGIN ─────────────────────────────────────────
// POST /admin/api/request-otp  { email }  → sends OTP if email is the admin email
// POST /admin/api/verify-otp   { session_id, code } → returns bearer token (session_id)
router.post('/request-otp', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  if (email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    return res.status(404).json({ error: 'No admin account with that email' });
  }
  const code = Math.floor(1000 + Math.random() * 9000).toString();
  const sessionId = crypto.randomBytes(32).toString('hex');
  await req.db.execute(
    'INSERT INTO otp_sessions (session_id, phone, email, code, expires_at, verified) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE), FALSE)',
    [sessionId, '', email, code]
  );
  try {
    const { sendEmailOtp } = require('../services/messaging');
    await sendEmailOtp(email, code);
  } catch (e) {
    console.error('Admin OTP send failed (non-blocking):', e.message);
    if (process.env.NODE_ENV !== 'production') console.log('=== Admin OTP for', email, ':', code, '===');
  }
  res.json({ session_id: sessionId, message: 'OTP sent' });
});

router.post('/verify-otp', async (req, res) => {
  const { session_id, code } = req.body;
  if (!session_id || !code) return res.status(400).json({ error: 'Missing session_id or code' });
  const [rows] = await req.db.execute(
    'SELECT email FROM otp_sessions WHERE session_id = ? AND code = ? AND expires_at > NOW() AND verified = FALSE',
    [session_id, code]
  );
  if (rows.length === 0) return res.status(401).json({ error: 'Invalid or expired code' });
  await req.db.execute('UPDATE otp_sessions SET verified = TRUE, expires_at = DATE_ADD(NOW(), INTERVAL 4 HOUR) WHERE session_id = ?', [session_id]);
  res.json({ email: rows[0].email, session_id, verified: true, token: session_id });
});

async function requireAuth(req, res, next) {
  const key = req.headers['x-admin-key'];
  const oauthEmail = req.headers['x-admin-oauth-email'];
  if (key === ADMIN_PASSWORD) return next();
  if (oauthEmail && oauthEmail.toLowerCase() === ADMIN_EMAIL.toLowerCase()) return next();
  // Accept a verified OTP session as bearer token when the session's email is the admin email
  const auth = (req.headers.authorization || '').trim();
  if (auth.startsWith('Bearer ')) {
    const sessionId = auth.split(' ')[1];
    const [rows] = await req.db.execute(
      'SELECT email, verified, expires_at FROM otp_sessions WHERE session_id = ?',
      [sessionId]
    );
    if (rows.length > 0 && rows[0].verified && rows[0].expires_at && new Date(rows[0].expires_at) > new Date()) {
      if ((rows[0].email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
        req.adminEmail = rows[0].email;
        return next();
      }
    }
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

router.use(requireAuth);

// SCHOOLS
router.get('/schools', async (req, res) => {
  const limit = parseInt(req.query.limit) || 0;
  let sql = 'SELECT school_id, school_name, region, sales_rep_id, created_at FROM schools ORDER BY school_name';
  if (limit > 0) sql += ' LIMIT ' + limit;
  const [rows] = await req.db.execute(sql);
  res.json({ schools: rows });
});

// Shared M-Pesa helpers

async function ensureMpesaCallbackKey(db, schoolId) {
  const [rows] = await db.execute('SELECT mpesa_callback_key FROM schools WHERE school_id = ? LIMIT 1', [schoolId]);
  if (rows.length === 0) return { error: 'School not found' };
  let key = rows[0].mpesa_callback_key;
  if (!key) {
    for (let attempt = 0; attempt < 5; attempt++) {
      key = crypto.randomBytes(16).toString('hex');
      try {
        await db.execute('UPDATE schools SET mpesa_callback_key = ? WHERE school_id = ?', [key, schoolId]);
        break;
      } catch (err) {
        if (err && err.code === 'ER_DUP_ENTRY') { key = null; continue; }
        throw err;
      }
    }
    if (!key) return { error: 'Failed to allocate callback key' };
  }
  return { key };
}

function buildCallbackUrls(key, req) {
  const baseUrl = process.env.BASE_URL || (req.get('origin') || `${req.protocol}://${req.get('host')}`);
  const base = baseUrl.replace(/\/$/, '');
  return {
    public: { validation: `${base}/cb/${key}/v`, confirmation: `${base}/cb/${key}/c`, stk: `${base}/cb/${key}/s` },
    secret: { validation: `${base}/v1/payments/secret/${key}/v`, confirmation: `${base}/v1/payments/secret/${key}/c`, stk: `${base}/v1/payments/secret/${key}/s` }
  };
}

const MPESA_CREDENTIAL_FIELDS = ['mpesa_environment', 'mpesa_paybill', 'mpesa_consumer_key', 'mpesa_consumer_secret', 'mpesa_passkey'];

function mpesaReadiness(school) {
  const missing = [];
  if (!school.mpesa_consumer_key) missing.push('Consumer Key');
  if (!school.mpesa_consumer_secret) missing.push('Consumer Secret');
  if (!school.mpesa_passkey) missing.push('Passkey');
  if (!school.mpesa_paybill) missing.push('Paybill');
  const env = school.mpesa_environment || 'sandbox';
  return { env, complete: missing.length === 0, missing, production_ready: env === 'production' && missing.length === 0 };
}

// GET /admin/api/schools/:id/mpesa-callbacks
// Returns or generates the mpesa callback key and public/secret URLs for registration
router.get('/schools/:id/mpesa-callbacks', async (req, res) => {
  const r = await ensureMpesaCallbackKey(req.db, req.params.id);
  if (r.error) return res.status(r.error === 'School not found' ? 404 : 500).json({ error: r.error });
  return res.json({ mpesa_callback_key: r.key, ...buildCallbackUrls(r.key, req) });
});

// GET /admin/api/schools/:id/mpesa — credentials + callback URLs + readiness for the portal UI
router.get('/schools/:id/mpesa', async (req, res) => {
  try {
    // s.* so a missing optional column can never break the endpoint
    const [rows] = await req.db.execute('SELECT * FROM schools WHERE school_id = ? LIMIT 1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'School not found' });
    const school = rows[0];
    const r = await ensureMpesaCallbackKey(req.db, req.params.id);
    if (r.error) return res.status(r.error === 'School not found' ? 404 : 500).json({ error: r.error });
    res.json({
      ...school,
      mpesa_callback_key: r.key,
      urls: buildCallbackUrls(r.key, req),
      readiness: mpesaReadiness(school)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /admin/api/schools/:id/mpesa — partial update of M-Pesa credentials (validated)
router.put('/schools/:id/mpesa', async (req, res) => {
  try {
    const updates = {};
    for (const f of MPESA_CREDENTIAL_FIELDS) {
      if (req.body[f] !== undefined) updates[f] = String(req.body[f]).trim();
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No valid fields to update' });

    if (updates.mpesa_environment !== undefined && !['sandbox', 'production'].includes(updates.mpesa_environment)) {
      return res.status(400).json({ error: 'mpesa_environment must be sandbox or production' });
    }
    if (updates.mpesa_paybill !== undefined && !/^[0-9]{5,20}$/.test(updates.mpesa_paybill)) {
      return res.status(400).json({ error: 'Paybill must be 5-20 digits' });
    }
    for (const f of ['mpesa_consumer_key', 'mpesa_consumer_secret', 'mpesa_passkey']) {
      if (updates[f] !== undefined && updates[f].length < 8) {
        return res.status(400).json({ error: `${f.replace('mpesa_', '').replace('_', ' ')} looks too short — check the paste` });
      }
    }

    const fields = Object.keys(updates);
    await req.db.execute(
      `UPDATE schools SET ${fields.map(f => `${f} = ?`).join(', ')} WHERE school_id = ?`,
      [...fields.map(f => updates[f]), req.params.id]
    );

    const [rows] = await req.db.execute('SELECT * FROM schools WHERE school_id = ? LIMIT 1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'School not found' });
    res.json({ success: true, school: rows[0], readiness: mpesaReadiness(rows[0]) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/schools', async (req, res) => {
  const { school_id, school_name, region, sales_rep_id } = req.body;
  if (!school_id || !school_name) return res.status(400).json({ error: 'school_id and school_name required' });
  if (!sales_rep_id) return res.status(400).json({ error: 'sales_rep_id required. Assign a sales representative when creating a school.' });

  // verify sales_rep exists
  const [rep] = await req.db.execute('SELECT rep_id FROM sales_reps WHERE rep_id = ?', [sales_rep_id]);
  if (rep.length === 0) return res.status(404).json({ error: 'Sales representative not found' });

  await req.db.execute(
    'INSERT INTO schools (school_id, school_name, region, sales_rep_id) VALUES (?, ?, ?, ?)',
    [school_id, school_name, region || null, sales_rep_id]
  );
  res.json({ school_id, school_name, sales_rep_id });
});

router.delete('/schools/:id', async (req, res) => {
  const schoolId = req.params.id;
  const conn = await req.db.getConnection();
  try {
    await conn.beginTransaction();
    // Students' exam results
    await conn.execute('DELETE FROM exam_results WHERE student_id IN (SELECT student_id FROM students WHERE school_id = ?)', [schoolId]);
    await conn.execute('DELETE FROM student_competency_ratings WHERE student_id IN (SELECT student_id FROM students WHERE school_id = ?)', [schoolId]);
    await conn.execute('DELETE FROM attendance_logs WHERE student_id IN (SELECT student_id FROM students WHERE school_id = ?)', [schoolId]);
    await conn.execute('DELETE FROM assessment_results WHERE assessment_id IN (SELECT assessment_id FROM assessments WHERE class_id IN (SELECT class_id FROM classes WHERE school_id = ?))', [schoolId]);
    await conn.execute('DELETE FROM assessments WHERE class_id IN (SELECT class_id FROM classes WHERE school_id = ?)', [schoolId]);
    await conn.execute('DELETE FROM payment_ledger WHERE school_id = ?', [schoolId]);
    await conn.execute('DELETE FROM exam_sessions WHERE school_id = ?', [schoolId]);
    await conn.execute('DELETE FROM lesson_plans WHERE school_id = ?', [schoolId]);
    await conn.execute('DELETE FROM student_competency_ratings WHERE student_id IN (SELECT student_id FROM students WHERE school_id = ?)', [schoolId]);
    await conn.execute('DELETE FROM premium_subscriptions WHERE school_id = ?', [schoolId]);
    await conn.execute('DELETE FROM premium_bulk_payments WHERE school_id = ?', [schoolId]);
    await conn.execute('DELETE FROM promotion_history WHERE student_id IN (SELECT student_id FROM students WHERE school_id = ?)', [schoolId]);
    // Learning areas tree (sub_learning_areas -> learning_areas) and strands tree
    await conn.execute('DELETE FROM sub_learning_areas WHERE area_id IN (SELECT area_id FROM learning_areas WHERE school_id = ?)', [schoolId]);
    await conn.execute('DELETE FROM sub_strands WHERE strand_id IN (SELECT strand_id FROM strands WHERE area_id IN (SELECT area_id FROM learning_areas WHERE school_id = ?))', [schoolId]);
    await conn.execute('DELETE FROM strands WHERE area_id IN (SELECT area_id FROM learning_areas WHERE school_id = ?)', [schoolId]);
    await conn.execute('DELETE FROM learning_areas WHERE school_id = ?', [schoolId]);
    await conn.execute('DELETE FROM fee_assignments WHERE fee_id IN (SELECT fee_id FROM fee_structures WHERE school_id = ?)', [schoolId]);
    await conn.execute('DELETE FROM fee_structures WHERE school_id = ?', [schoolId]);
    await conn.execute('DELETE FROM marketplace_campaigns WHERE target_school_id = ?', [schoolId]);
    await conn.execute('DELETE FROM student_parent_map WHERE student_id IN (SELECT student_id FROM students WHERE school_id = ?)', [schoolId]);
    await conn.execute('DELETE FROM students WHERE school_id = ?', [schoolId]);
    await conn.execute('DELETE FROM teachers WHERE school_id = ?', [schoolId]);
    await conn.execute('DELETE FROM student_id_sequences WHERE school_id = ?', [schoolId]);
    await conn.execute('DELETE FROM school_streams WHERE school_id = ?', [schoolId]);
    await conn.execute('DELETE FROM school_terms WHERE school_id = ?', [schoolId]);
    await conn.execute('DELETE FROM school_rubric_config WHERE school_id = ?', [schoolId]);
    await conn.execute('DELETE FROM school_report_settings WHERE school_id = ?', [schoolId]);
    await conn.execute('DELETE FROM classes WHERE school_id = ?', [schoolId]);
    await conn.execute('DELETE FROM schools WHERE school_id = ?', [schoolId]);
    await conn.commit();
    res.json({ deleted: true });
  } catch (err) {
    await conn.rollback();
    console.error('[DELETE SCHOOL]', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ─── RAPID-START SCHOOL SETUP ──────────────────────────────────────
// POST /admin/api/schools/setup
// Creates a school + sales rep + headteacher + classes + learning areas + terms + rubric + fees in one shot.
// The headteacher's only remaining job is to import students.
// Body: {
//   school_name, region, contact_name, contact_phone, contact_email,
//   headteacher_name, headteacher_phone, headteacher_email,
//   academic_year, class_names: ["PP1","PP2","Grade 1",...],  // optional, defaults to PP1-Grade 9
//   streams: ["East","West"],  // optional; one class per level x stream when provided
//   premium_payment_model: "parent"|"school", premium_fee_per_term,
//   fees: [{ name, amount, term }]  // optional
// }
router.post('/schools/setup', async (req, res) => {
  const {
    school_name, region, contact_name, contact_phone, contact_email,
    headteacher_name, headteacher_phone, headteacher_email,
    academic_year, class_names, streams, premium_payment_model, premium_fee_per_term, fees
  } = req.body;

  if (!school_name) return res.status(400).json({ error: 'school_name required' });
  if (!headteacher_name || !headteacher_phone) return res.status(400).json({ error: 'headteacher_name and headteacher_phone required' });
  const year = parseInt(academic_year) || new Date().getFullYear();

  const conn = await req.db.getConnection();
  try {
    await conn.beginTransaction();

    // Generate unique school_id (SCH + 6 digits)
    let schoolId = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = 'SCH' + String(Math.floor(100000 + Math.random() * 900000));
      const [exist] = await conn.execute('SELECT school_id FROM schools WHERE school_id = ?', [candidate]);
      if (exist.length === 0) { schoolId = candidate; break; }
    }
    if (!schoolId) return res.status(500).json({ error: 'Failed to allocate school id' });

    // Sales rep (reuse the admin's default rep or create a generic one)
    const [repRows] = await conn.execute("SELECT rep_id FROM sales_reps WHERE email = ? LIMIT 1", [headteacher_email || ADMIN_EMAIL]);
    let repId = repRows[0]?.rep_id || null;
    if (!repId) {
      repId = 'REP' + String(Math.floor(100000 + Math.random() * 900000));
      await conn.execute('INSERT INTO sales_reps (rep_id, full_name, phone, email) VALUES (?, ?, ?, ?)',
        [repId, headteacher_name, headteacher_phone, headteacher_email || null]);
    }

    await conn.execute(
      `INSERT INTO schools (school_id, school_name, region, contact_name, contact_phone, contact_email,
         premium_payment_model, premium_fee_per_term, sales_rep_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [schoolId, school_name, region || null, contact_name || null, contact_phone || null, contact_email || null,
        premium_payment_model === 'school' ? 'school' : 'parent',
        premium_payment_model === 'school' ? (premium_fee_per_term || 0) : null, repId]
    );

    // Headteacher
    const headId = 'TCH' + String(Math.floor(100000 + Math.random() * 900000));
    await conn.execute(
      'INSERT INTO teachers (teacher_id, full_name, phone, email, role, school_id) VALUES (?, ?, ?, ?, ?, ?)',
      [headId, headteacher_name, headteacher_phone, headteacher_email || null, 'head', schoolId]
    );

    // Classes — default CBC progression (PP1 → Grade 9) if not provided
    const defaultClasses = ['PP1', 'PP2', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9'];
    const classes = Array.isArray(class_names) && class_names.length > 0 ? class_names : defaultClasses;

    // Optional streams — one class per level × stream when provided
    const streams = Array.isArray(streams) ? streams.map(s => String(s).trim()).filter(Boolean) : [];
    for (let i = 0; i < streams.length; i++) {
      await conn.execute('INSERT INTO school_streams (school_id, stream_name, display_order) VALUES (?, ?, ?)',
        [schoolId, streams[i], i + 1]);
    }

    const classRows = [];
    if (streams.length > 0) {
      let rank = 0;
      for (const level of classes) {
        rank++;
        for (const stream of streams) {
          const [r] = await conn.execute(
            'INSERT INTO classes (school_id, class_name, stream, level_name, academic_year, class_rank) VALUES (?, ?, ?, ?, ?, ?)',
            [schoolId, `${level} - ${stream}`, stream, level, year, rank]
          );
          classRows.push({ class_id: r.insertId, class_name: `${level} - ${stream}` });
        }
      }
    } else {
      for (let i = 0; i < classes.length; i++) {
        const [r] = await conn.execute(
          'INSERT INTO classes (school_id, class_name, level_name, academic_year, class_rank) VALUES (?, ?, ?, ?, ?)',
          [schoolId, classes[i], classes[i], year, i + 1]
        );
        classRows.push({ class_id: r.insertId, class_name: classes[i] });
      }
    }

    // Learning areas + sub-areas per level
    const levelAreas = {
      'PP1': { areas: ['Language Activities', 'Mathematical Activities', 'Environmental Activities', 'Psychomotor and Creative Activities', 'Religious Education'],
               subs: { 'Language Activities': ['Listening', 'Speaking', 'Reading'], 'Mathematical Activities': ['Number Work', 'Measurement', 'Geometry'],
                       'Environmental Activities': ['Our Environment', 'Living Things'], 'Psychomotor and Creative Activities': ['Creative Arts', 'Physical Activities'],
                       'Religious Education': ['Bible Stories', 'Values'] } },
      'PP2': { areas: ['Language Activities', 'Mathematical Activities', 'Environmental Activities', 'Psychomotor and Creative Activities', 'Religious Education'],
               subs: { 'Language Activities': ['Listening', 'Speaking', 'Reading', 'Writing'], 'Mathematical Activities': ['Number Work', 'Measurement', 'Geometry'],
                       'Environmental Activities': ['Our Environment', 'Living Things'], 'Psychomotor and Creative Activities': ['Creative Arts', 'Physical Activities'],
                       'Religious Education': ['Bible Stories', 'Values'] } },
      'Grade 1': { areas: ['English', 'Mathematics', 'Environmental Activities', 'Kiswahili', 'Creative Arts', 'Religious Education'],
                   subs: { 'English': ['Listening and Speaking', 'Reading', 'Writing'], 'Mathematics': ['Numbers', 'Measurement', 'Geometry'],
                           'Environmental Activities': ['Our Environment', 'Living Things'], 'Kiswahili': ['Kusikiliza', 'Kusoma', 'Kuandika'],
                           'Creative Arts': ['Creative Arts', 'Physical Education'], 'Religious Education': ['Stories', 'Values'] } },
      'Grade 2': { areas: ['English', 'Mathematics', 'Environmental Activities', 'Kiswahili', 'Creative Arts', 'Religious Education'],
                   subs: { 'English': ['Listening and Speaking', 'Reading', 'Writing'], 'Mathematics': ['Numbers', 'Measurement', 'Geometry'],
                           'Environmental Activities': ['Our Environment', 'Living Things'], 'Kiswahili': ['Kusikiliza', 'Kusoma', 'Kuandika'],
                           'Creative Arts': ['Creative Arts', 'Physical Education'], 'Religious Education': ['Stories', 'Values'] } },
      'Grade 3': { areas: ['English', 'Mathematics', 'Science and Technology', 'Kiswahili', 'Social Studies', 'Creative Arts', 'Religious Education'],
                   subs: { 'English': ['Listening and Speaking', 'Reading', 'Writing'], 'Mathematics': ['Numbers', 'Measurement', 'Geometry'],
                           'Science and Technology': ['Science', 'Technology'], 'Kiswahili': ['Kusikiliza', 'Kusoma', 'Kuandika'],
                           'Social Studies': ['Our Environment', 'Our Nation'], 'Creative Arts': ['Creative Arts', 'Physical Education'],
                           'Religious Education': ['Stories', 'Values'] } },
      'Grade 4': { areas: ['English', 'Mathematics', 'Science and Technology', 'Kiswahili', 'Social Studies', 'Creative Arts', 'Religious Education'],
                   subs: { 'English': ['Listening and Speaking', 'Reading', 'Writing', 'Grammar'], 'Mathematics': ['Numbers', 'Measurement', 'Geometry', 'Algebra'],
                           'Science and Technology': ['Science', 'Technology'], 'Kiswahili': ['Kusikiliza', 'Kusoma', 'Kuandika', 'Sarufi'],
                           'Social Studies': ['Our Environment', 'Our Nation', 'Our County'], 'Creative Arts': ['Creative Arts', 'Physical Education'],
                           'Religious Education': ['Stories', 'Values'] } },
      'Grade 5': { areas: ['English', 'Mathematics', 'Science and Technology', 'Kiswahili', 'Social Studies', 'Creative Arts', 'Religious Education'],
                   subs: { 'English': ['Listening and Speaking', 'Reading', 'Writing', 'Grammar'], 'Mathematics': ['Numbers', 'Measurement', 'Geometry', 'Algebra'],
                           'Science and Technology': ['Science', 'Technology'], 'Kiswahili': ['Kusikiliza', 'Kusoma', 'Kuandika', 'Sarufi'],
                           'Social Studies': ['Our Environment', 'Our Nation', 'Our County'], 'Creative Arts': ['Creative Arts', 'Physical Education'],
                           'Religious Education': ['Stories', 'Values'] } },
      'Grade 6': { areas: ['English', 'Mathematics', 'Science and Technology', 'Kiswahili', 'Social Studies', 'Creative Arts', 'Religious Education'],
                   subs: { 'English': ['Listening and Speaking', 'Reading', 'Writing', 'Grammar'], 'Mathematics': ['Numbers', 'Measurement', 'Geometry', 'Algebra'],
                           'Science and Technology': ['Science', 'Technology'], 'Kiswahili': ['Kusikiliza', 'Kusoma', 'Kuandika', 'Sarufi'],
                           'Social Studies': ['Our Environment', 'Our Nation', 'Our County'], 'Creative Arts': ['Creative Arts', 'Physical Education'],
                           'Religious Education': ['Stories', 'Values'] } },
      // CBC Junior Secondary (Grades 7-9)
      'Grade 7': { areas: ['English', 'Kiswahili', 'Mathematics', 'Integrated Science', 'Pre-Technical Studies', 'Social Studies', 'Religious Education', 'Business Studies', 'Agriculture', 'Creative Arts and Sports'],
                   subs: { 'English': ['Listening and Speaking', 'Reading', 'Writing', 'Grammar in Use'],
                           'Kiswahili': ['Kusikiliza na Kuzungumza', 'Kusoma', 'Kuandika', 'Sarufi'],
                           'Mathematics': ['Numbers', 'Algebra', 'Measurements', 'Geometry', 'Data Handling'],
                           'Integrated Science': ['Scientific Investigation', 'Mixtures and Separation', 'Living Things and Their Environment', 'Force and Energy'],
                           'Pre-Technical Studies': ['Safety and Injury Prevention', 'Materials for Production', 'Technical Drawing', 'ICT and Digital Devices'],
                           'Social Studies': ['Natural and Historical Built Environments', 'People, Population and Social Organizations', 'Resources and Economic Activities', 'Political Developments and Governance'],
                           'Religious Education': ['Creation', 'The Bible', 'Faith and God\'s Promises', 'Christian Values'],
                           'Business Studies': ['Business and Money Management Skills', 'Ethical Practices in Business', 'Record Keeping', 'Markets'],
                           'Agriculture': ['Introduction to Agriculture', 'Crop Production', 'Livestock Production', 'Agribusiness'],
                           'Creative Arts and Sports': ['Visual Arts', 'Performing Arts', 'Physical Fitness', 'Ball Games'] } },
      'Grade 8': { areas: ['English', 'Kiswahili', 'Mathematics', 'Integrated Science', 'Pre-Technical Studies', 'Social Studies', 'Religious Education', 'Business Studies', 'Agriculture', 'Creative Arts and Sports'],
                   subs: { 'English': ['Listening and Speaking', 'Reading', 'Writing', 'Grammar in Use'],
                           'Kiswahili': ['Kusikiliza na Kuzungumza', 'Kusoma', 'Kuandika', 'Sarufi'],
                           'Mathematics': ['Numbers', 'Algebra', 'Measurements', 'Geometry', 'Data Handling'],
                           'Integrated Science': ['Scientific Investigation', 'Matter and Its Properties', 'Living Things and Their Environment', 'Force and Energy'],
                           'Pre-Technical Studies': ['Safety and Injury Prevention', 'Materials for Production', 'Technical Drawing', 'Entrepreneurship and ICT'],
                           'Social Studies': ['Natural and Historical Built Environments', 'People, Population and Social Organizations', 'Resources and Economic Activities', 'Political Developments and Governance'],
                           'Religious Education': ['Creation', 'The Bible', 'Faith and God\'s Promises', 'Christian Values'],
                           'Business Studies': ['Business and Money Management Skills', 'Ethical Practices in Business', 'Record Keeping', 'Markets'],
                           'Agriculture': ['Introduction to Agriculture', 'Crop Production', 'Livestock Production', 'Agribusiness'],
                           'Creative Arts and Sports': ['Visual Arts', 'Performing Arts', 'Physical Fitness', 'Ball Games'] } },
      'Grade 9': { areas: ['English', 'Kiswahili', 'Mathematics', 'Integrated Science', 'Pre-Technical Studies', 'Social Studies', 'Religious Education', 'Business Studies', 'Agriculture', 'Creative Arts and Sports'],
                   subs: { 'English': ['Listening and Speaking', 'Reading', 'Writing', 'Grammar in Use'],
                           'Kiswahili': ['Kusikiliza na Kuzungumza', 'Kusoma', 'Kuandika', 'Sarufi'],
                           'Mathematics': ['Numbers', 'Algebra', 'Measurements', 'Geometry', 'Data Handling'],
                           'Integrated Science': ['Scientific Investigation', 'Matter and Its Interactions', 'Living Things and Their Environment', 'Force and Energy'],
                           'Pre-Technical Studies': ['Safety and Career Opportunities', 'Materials for Production', 'Technical Drawing', 'Entrepreneurship and ICT'],
                           'Social Studies': ['Natural and Historical Built Environments', 'People, Population and Social Organizations', 'Resources and Economic Activities', 'Political Developments and Governance'],
                           'Religious Education': ['Creation', 'The Bible', 'Faith and God\'s Promises', 'Christian Values'],
                           'Business Studies': ['Business and Money Management Skills', 'Ethical Practices in Business', 'Record Keeping', 'Markets'],
                           'Agriculture': ['Introduction to Agriculture', 'Crop Production', 'Livestock Production', 'Agribusiness'],
                           'Creative Arts and Sports': ['Visual Arts', 'Performing Arts', 'Physical Fitness', 'Ball Games'] } }
    };

    const areaIdCache = {};
    for (const cls of classes) {
      const def = levelAreas[cls] || levelAreas['Grade 4'];
      const areas = def.areas;
      for (const areaName of areas) {
        const [a] = await conn.execute(
          'INSERT INTO learning_areas (school_id, level_name, area_name) VALUES (?, ?, ?)',
          [schoolId, cls, areaName]
        );
        const subs = (def.subs[areaName] || []).map((s, idx) => ({ name: s, order: idx + 1 }));
        for (const sub of subs) {
          await conn.execute(
            'INSERT INTO sub_learning_areas (area_id, sub_area_name, display_order) VALUES (?, ?, ?)',
            [a.insertId, sub.name, sub.order]
          );
        }
        areaIdCache[`${cls}|${areaName}`] = a.insertId;
      }
    }

    // School terms
    const termDefs = [
      ['Term 1', `${year}-01-06`, `${year}-04-04`],
      ['Term 2', `${year}-05-04`, `${year}-08-07`],
      ['Term 3', `${year}-09-07`, `${year}-11-20`]
    ];
    for (const [tname, start, end] of termDefs) {
      await conn.execute('INSERT INTO school_terms (school_id, term_name, start_date, end_date, academic_year) VALUES (?, ?, ?, ?, ?)',
        [schoolId, tname, start, end, year]);
    }

    // Rubric
    const rubric = [['EE',80,'Exceeding Expectations','#2E7D32'],['ME',60,'Meeting Expectations','#1565C0'],['AE',40,'Approaching Expectations','#E65100'],['BE',0,'Below Expectations','#C62828']];
    for (const [code, min, label, color] of rubric) {
      await conn.execute('INSERT INTO school_rubric_config (school_id, level_code, min_percent, label, color) VALUES (?, ?, ?, ?, ?)',
        [schoolId, code, min, label, color]);
    }

    // Fee structures (optional) — spread across terms if term not specified
    if (Array.isArray(fees) && fees.length > 0) {
      for (const fee of fees) {
        if (!fee.name || !fee.amount) continue;
        const terms = fee.term ? [fee.term] : ['Term 1', 'Term 2', 'Term 3'];
        for (const t of terms) {
          await conn.execute(
            'INSERT INTO fee_structures (school_id, fee_name, amount, term, academic_year, is_optional) VALUES (?, ?, ?, ?, ?, ?)',
            [schoolId, fee.name, fee.amount, t, year, fee.is_optional || false]
          );
        }
      }
    }

    await conn.commit();

    res.json({
      success: true,
      school_id: schoolId,
      school_name,
      headteacher_id: headId,
      headteacher_email: headteacher_email || null,
      sales_rep_id: repId,
      classes: classRows,
      note: 'Headteacher can now log in via email/phone OTP and import students.'
    });
  } catch (err) {
    await conn.rollback();
    console.error('[SCHOOL SETUP]', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// GET /admin/api/schools/:id/details — full snapshot for the admin portal
// Returns school info, classes, learning areas, fee structures across terms,
// student counts, and per-term payment summary (paid/unpaid/outstanding).
router.get('/schools/:id/details', async (req, res) => {
  const { id } = req.params;
  const year = parseInt(req.query.year) || new Date().getFullYear();

  const [school] = await req.db.execute(
    `SELECT s.*, sr.full_name AS sales_rep_name FROM schools s
     LEFT JOIN sales_reps sr ON s.sales_rep_id = sr.rep_id
     WHERE s.school_id = ?`, [id]);
  if (school.length === 0) return res.status(404).json({ error: 'School not found' });

  const [classes] = await req.db.execute(
    'SELECT class_id, class_name, academic_year FROM classes WHERE school_id = ? ORDER BY class_rank, class_name', [id]);

  const [learningAreas] = await req.db.execute(
    'SELECT area_id, level_name, area_name FROM learning_areas WHERE school_id = ? ORDER BY level_name, area_name', [id]);

  const [subLearningAreas] = await req.db.execute(
    `SELECT sla.sub_area_id, sla.area_id, sla.sub_area_name, sla.display_order
     FROM sub_learning_areas sla JOIN learning_areas la ON sla.area_id = la.area_id
     WHERE la.school_id = ? ORDER BY sla.display_order, sla.sub_area_name`, [id]);

  const [fees] = await req.db.execute(
    'SELECT fee_id, fee_name, amount, term, academic_year, is_optional FROM fee_structures WHERE school_id = ? AND academic_year = ? ORDER BY term, fee_name', [id, year]);

  const [teachers] = await req.db.execute(
    'SELECT teacher_id, full_name, phone, email, role FROM teachers WHERE school_id = ?', [id]);

  const [studentCount] = await req.db.execute(
    'SELECT COUNT(*) AS total FROM students WHERE school_id = ? AND enrollment_status = ?', [id, 'Active']);

  // Per-term payment summary
  const terms = ['Term 1', 'Term 2', 'Term 3'];
  const termSummary = [];
  for (const term of terms) {
    const [feeTotal] = await req.db.execute(
      `SELECT COALESCE(SUM(COALESCE(fa.adjusted_amount, f.amount)), 0) AS expected
       FROM (SELECT fee_id, amount, is_optional FROM fee_structures WHERE school_id = ? AND term = ? AND academic_year = ?) f
       JOIN fee_assignments fa ON f.fee_id = fa.fee_id WHERE fa.waived = FALSE`, [id, term, year]);
    const [paidTotal] = await req.db.execute(
      `SELECT COALESCE(SUM(amount), 0) AS paid, COUNT(*) AS txns
       FROM payment_ledger WHERE school_id = ? AND term = ? AND academic_year = ? AND reversed_at IS NULL`, [id, term, year]);
    const expected = parseFloat(feeTotal[0]?.expected || 0);
    const paid = parseFloat(paidTotal[0]?.paid || 0);
    termSummary.push({
      term, year,
      expected, paid,
      outstanding: Math.max(0, expected - paid),
      collection_rate: expected > 0 ? Math.round(paid / expected * 100 * 10) / 10 : 0,
      transactions: paidTotal[0]?.txns || 0
    });
  }

  // Who has paid premium — subscription revenue for the admin (not school fees)
  const [parents] = await req.db.execute(
    `SELECT spm.parent_phone, pp.full_name AS parent_name, pp.is_premium, pp.premium_expires_at,
       COUNT(s.student_id) AS child_count
     FROM student_parent_map spm
     JOIN students s ON spm.student_id = s.student_id AND s.school_id = ? AND s.enrollment_status = 'Active'
     LEFT JOIN parent_profiles pp ON spm.parent_phone = pp.parent_phone
     GROUP BY spm.parent_phone, pp.full_name, pp.is_premium, pp.premium_expires_at
     ORDER BY pp.full_name`, [id]);
  const [activeSubs] = await req.db.execute(
    `SELECT parent_phone, term FROM premium_subscriptions
     WHERE school_id = ? AND year = ? AND payment_status = 'paid'
       AND (expires_at IS NULL OR expires_at > NOW())`, [id, year]);
  const activeTermsByPhone = {};
  for (const s of activeSubs) {
    if (!activeTermsByPhone[s.parent_phone]) activeTermsByPhone[s.parent_phone] = [];
    if (!activeTermsByPhone[s.parent_phone].includes(s.term)) activeTermsByPhone[s.parent_phone].push(s.term);
  }
  const [setting] = await req.db.execute("SELECT setting_value FROM app_settings WHERE setting_key = 'premium_price'");
  const pricePerChild = parseInt(setting[0]?.setting_value || '100');
  const parentSummary = parents.map(p => {
    const activeFromProfile = p.is_premium && (!p.premium_expires_at || new Date(p.premium_expires_at) > new Date());
    const paidTerms = activeTermsByPhone[p.parent_phone] || [];
    const active = activeFromProfile || paidTerms.length > 0;
    return {
      parent_phone: p.parent_phone,
      parent_name: p.parent_name || 'Unknown',
      child_count: p.child_count,
      premium: Boolean(active),
      premium_expires_at: p.premium_expires_at,
      paid_terms: paidTerms,
      amount_due: active ? 0 : pricePerChild * p.child_count
    };
  });
  const premiumParents = parentSummary.filter(p => p.premium).length;

  res.json({
    school: school[0],
    classes,
    learning_areas: learningAreas,
    sub_learning_areas: subLearningAreas,
    fees,
    teachers,
    students: studentCount[0]?.total || 0,
    payment_summary: { terms: termSummary, parents: parentSummary, paid_parents: premiumParents, total_parents: parentSummary.length }
  });
});

// CLASSES
router.get('/classes', async (req, res) => {
  const { school_id } = req.query;
  let sql = 'SELECT c.*, s.school_name FROM classes c JOIN schools s ON c.school_id = s.school_id';
  const params = [];
  if (school_id) { sql += ' WHERE c.school_id = ?'; params.push(school_id); }
  sql += ' ORDER BY s.school_name, c.class_name';
  const [rows] = await req.db.execute(sql, params);
  res.json({ classes: rows });
});

router.post('/classes', async (req, res) => {
  // Creating classes must be performed by the school's headteacher via the teacher interface.
  // Admin UI no longer allows creating classes to ensure ownership and correct school assignment.
  return res.status(403).json({ error: 'Creating classes is disallowed via admin UI. Headteachers must create classes via the teacher interface.' });
});

router.delete('/classes/:id', async (req, res) => {
  await req.db.execute('DELETE FROM attendance_logs WHERE student_id IN (SELECT student_id FROM students WHERE class_id = ?)', [req.params.id]);
  await req.db.execute('DELETE FROM assessment_results WHERE assessment_id IN (SELECT assessment_id FROM assessments WHERE class_id = ?)', [req.params.id]);
  await req.db.execute('DELETE FROM assessments WHERE class_id = ?', [req.params.id]);
  await req.db.execute('DELETE FROM fee_assignments WHERE class_id = ?', [req.params.id]);
  await req.db.execute('DELETE FROM student_parent_map WHERE student_id IN (SELECT student_id FROM students WHERE class_id = ?)', [req.params.id]);
  await req.db.execute('DELETE FROM students WHERE class_id = ?', [req.params.id]);
  await req.db.execute('DELETE FROM classes WHERE class_id = ?', [req.params.id]);
  res.json({ deleted: true });
});

// POST /admin/api/schools/:id/classes — add a class to a school
router.post('/schools/:id/classes', async (req, res) => {
  const { class_name, academic_year, class_rank } = req.body;
  if (!class_name) return res.status(400).json({ error: 'class_name required' });
  const year = parseInt(academic_year) || new Date().getFullYear();
  const [r] = await req.db.execute(
    'INSERT INTO classes (school_id, class_name, academic_year, class_rank) VALUES (?, ?, ?, ?)',
    [req.params.id, class_name, year, class_rank === undefined ? null : parseInt(class_rank)]);
  res.json({ class_id: r.insertId, class_name, academic_year: year });
});

router.put('/classes/:id', async (req, res) => {
  const { class_name, class_rank } = req.body;
  const fields = [];
  const params = [];
  if (class_name) { fields.push('class_name = ?'); params.push(class_name); }
  if (class_rank !== undefined) { fields.push('class_rank = ?'); params.push(parseInt(class_rank)); }
  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
  params.push(req.params.id);
  await req.db.execute(`UPDATE classes SET ${fields.join(', ')} WHERE class_id = ?`, params);
  res.json({ updated: true });
});

// LEARNING AREAS + SUB-AREAS CRUD
// POST /admin/api/schools/:id/learning-areas { level_name, area_name }
router.post('/schools/:id/learning-areas', async (req, res) => {
  const { level_name, area_name } = req.body;
  if (!area_name) return res.status(400).json({ error: 'area_name required' });
  const [r] = await req.db.execute('INSERT INTO learning_areas (school_id, level_name, area_name) VALUES (?, ?, ?)', [req.params.id, level_name || null, area_name]);
  res.json({ area_id: r.insertId, level_name: level_name || null, area_name });
});

router.put('/learning-areas/:id', async (req, res) => {
  const { level_name, area_name } = req.body;
  const fields = [];
  const params = [];
  if (area_name) { fields.push('area_name = ?'); params.push(area_name); }
  if (level_name !== undefined) { fields.push('level_name = ?'); params.push(level_name); }
  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
  params.push(req.params.id);
  await req.db.execute(`UPDATE learning_areas SET ${fields.join(', ')} WHERE area_id = ?`, params);
  res.json({ updated: true });
});

router.delete('/learning-areas/:id', async (req, res) => {
  const conn = await req.db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM sub_strands WHERE strand_id IN (SELECT strand_id FROM strands WHERE area_id = ?)', [req.params.id]);
    await conn.execute('DELETE FROM strands WHERE area_id = ?', [req.params.id]);
    await conn.execute('DELETE FROM sub_learning_areas WHERE area_id = ?', [req.params.id]);
    await conn.execute('DELETE FROM learning_areas WHERE area_id = ?', [req.params.id]);
    await conn.commit();
    res.json({ deleted: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// POST /admin/api/sub-learning-areas { area_id, sub_area_name }
router.post('/sub-learning-areas', async (req, res) => {
  const { area_id, sub_area_name } = req.body;
  if (!area_id || !sub_area_name) return res.status(400).json({ error: 'area_id, sub_area_name required' });
  const [count] = await req.db.execute('SELECT COUNT(*) AS c FROM sub_learning_areas WHERE area_id = ?', [area_id]);
  const [r] = await req.db.execute('INSERT INTO sub_learning_areas (area_id, sub_area_name, display_order) VALUES (?, ?, ?)', [area_id, sub_area_name, (count[0]?.c || 0) + 1]);
  res.json({ sub_area_id: r.insertId, sub_area_name });
});

router.put('/sub-learning-areas/:id', async (req, res) => {
  const { sub_area_name, display_order } = req.body;
  const fields = [];
  const params = [];
  if (sub_area_name) { fields.push('sub_area_name = ?'); params.push(sub_area_name); }
  if (display_order !== undefined) { fields.push('display_order = ?'); params.push(parseInt(display_order)); }
  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
  params.push(req.params.id);
  await req.db.execute(`UPDATE sub_learning_areas SET ${fields.join(', ')} WHERE sub_area_id = ?`, params);
  res.json({ updated: true });
});

router.delete('/sub-learning-areas/:id', async (req, res) => {
  await req.db.execute('DELETE FROM sub_learning_areas WHERE sub_area_id = ?', [req.params.id]);
  res.json({ deleted: true });
});

// STUDENTS
router.get('/students', async (req, res) => {
  const { class_id, school_id } = req.query;
  let sql = 'SELECT st.*, c.class_name, s.school_name FROM students st JOIN classes c ON st.class_id = c.class_id JOIN schools s ON st.school_id = s.school_id';
  const params = [];
  const wheres = [];
  if (class_id) { wheres.push('st.class_id = ?'); params.push(class_id); }
  if (school_id) { wheres.push('st.school_id = ?'); params.push(school_id); }
  if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ');
  sql += ' ORDER BY st.full_name';
  const [rows] = await req.db.execute(sql, params);
  res.json({ students: rows });
});

router.post('/students', async (req, res) => {
  // Creating students must be performed by the school's headteacher via the teacher interface.
  // Admin UI no longer allows creating students to ensure correct enrollment handling.
  return res.status(403).json({ error: 'Creating students is disallowed via admin UI. Headteachers must add students via the teacher interface.' });
});

router.delete('/students/:id', async (req, res) => {
  await req.db.execute('DELETE FROM attendance_logs WHERE student_id = ?', [req.params.id]);
  await req.db.execute('DELETE FROM assessment_results WHERE student_id = ?', [req.params.id]);
  await req.db.execute('DELETE FROM student_parent_map WHERE student_id = ?', [req.params.id]);
  await req.db.execute('DELETE FROM students WHERE student_id = ?', [req.params.id]);
  res.json({ deleted: true });
});

router.post('/students/import', async (req, res) => {
  // Importing students via admin UI is disallowed. Headteachers should import/add students from the teacher interface.
  return res.status(403).json({ error: 'Importing students is disallowed via admin UI. Headteachers must import students via the teacher interface.' });
});

// TEACHERS
router.get('/teachers', async (req, res) => {
  const { school_id } = req.query;
  const limit = parseInt(req.query.limit) || 0;
  let sql = 'SELECT t.*, s.school_name FROM teachers t JOIN schools s ON t.school_id = s.school_id';
  const params = [];
  if (school_id) { sql += ' WHERE t.school_id = ?'; params.push(school_id); }
  sql += ' ORDER BY s.school_name, t.full_name';
  if (limit > 0) sql += ' LIMIT ' + limit;
  const [rows] = await req.db.execute(sql, params);
  res.json({ teachers: rows });
});

router.post('/teachers', async (req, res) => {
  const { school_id, full_name, phone, role, email } = req.body;
  if (!school_id || !full_name || !phone) return res.status(400).json({ error: 'school_id, full_name, phone required' });
  if (role && !['teacher', 'head'].includes(role)) return res.status(400).json({ error: 'Invalid role. Must be teacher or head.' });
  const [existing] = await req.db.execute('SELECT teacher_id FROM teachers WHERE phone = ?', [phone]);
  if (existing.length > 0) return res.status(409).json({ error: 'Phone already registered' });
  const teacherId = 'TCH' + String(Math.floor(100000 + Math.random() * 900000));
  await req.db.execute('INSERT INTO teachers (teacher_id, full_name, phone, email, school_id, role) VALUES (?, ?, ?, ?, ?, ?)', [teacherId, full_name, phone, email || null, school_id, role || 'teacher']);
  res.json({ teacher_id: teacherId, full_name });
});

router.put('/teachers/:id', async (req, res) => {
  const { full_name, phone, email, role } = req.body;
  if (role && !['teacher', 'head'].includes(role)) return res.status(400).json({ error: 'Invalid role. Must be teacher or head.' });
  const fields = [];
  const params = [];
  if (full_name) { fields.push('full_name = ?'); params.push(full_name); }
  if (phone) { fields.push('phone = ?'); params.push(phone); }
  if (email !== undefined) { fields.push('email = ?'); params.push(email); }
  if (role) { fields.push('role = ?'); params.push(role); }
  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
  params.push(req.params.id);
  await req.db.execute(`UPDATE teachers SET ${fields.join(', ')} WHERE teacher_id = ?`, params);
  res.json({ updated: true });
});

router.delete('/teachers/:id', async (req, res) => {
  await req.db.execute('DELETE FROM sync_log WHERE teacher_id = ?', [req.params.id]);
  await req.db.execute('DELETE FROM attendance_logs WHERE teacher_id = ?', [req.params.id]);
  await req.db.execute('DELETE FROM teachers WHERE teacher_id = ?', [req.params.id]);
  res.json({ deleted: true });
});

// Sales reps management (admin only)
router.get('/sales-reps', async (req, res) => {
  const [rows] = await req.db.execute(
    `SELECT sr.rep_id, sr.full_name, sr.phone, sr.email, sr.commission_type, sr.commission_value,
            sr.created_at, COUNT(sc.school_id) AS schools_count
     FROM sales_reps sr
     LEFT JOIN schools sc ON sc.sales_rep_id = sr.rep_id
     GROUP BY sr.rep_id, sr.full_name, sr.phone, sr.email, sr.commission_type, sr.commission_value, sr.created_at
     ORDER BY sr.full_name`);
  res.json({ sales_reps: rows });
});

router.post('/sales-reps', async (req, res) => {
  const { full_name, phone, email, commission_type, commission_value } = req.body;
  if (!full_name) return res.status(400).json({ error: 'full_name required' });
  const type = commission_type === 'flat' ? 'flat' : 'percent';
  const value = Math.max(0, parseFloat(commission_value) || 0);
  const repId = 'REP' + String(Math.floor(100000 + Math.random() * 900000));
  await req.db.execute(
    'INSERT INTO sales_reps (rep_id, full_name, phone, email, commission_type, commission_value) VALUES (?, ?, ?, ?, ?, ?)',
    [repId, full_name, phone || null, email || null, type, value]);
  res.json({ rep_id: repId, full_name, commission_type: type, commission_value: value });
});

router.put('/sales-reps/:repId', async (req, res) => {
  const { full_name, phone, email, commission_type, commission_value } = req.body;
  const type = commission_type === 'flat' ? 'flat' : 'percent';
  const value = Math.max(0, parseFloat(commission_value) || 0);
  await req.db.execute(
    'UPDATE sales_reps SET full_name = COALESCE(?, full_name), phone = COALESCE(?, phone), email = COALESCE(?, email), commission_type = ?, commission_value = ? WHERE rep_id = ?',
    [full_name || null, phone || null, email || null, type, value, req.params.repId]);
  res.json({ updated: true, rep_id: req.params.repId });
});

router.delete('/sales-reps/:repId', async (req, res) => {
  const [used] = await req.db.execute('SELECT COUNT(*) AS c FROM schools WHERE sales_rep_id = ?', [req.params.repId]);
  if (used[0]?.c > 0) {
    return res.status(409).json({ error: `Rep is assigned to ${used[0].c} school(s). Reassign or delete those schools first.` });
  }
  await req.db.execute('DELETE FROM sales_reps WHERE rep_id = ?', [req.params.repId]);
  res.json({ deleted: true });
});

// FEES
router.get('/fees', async (req, res) => {
  const { school_id } = req.query;
  let sql = 'SELECT f.*, s.school_name FROM fee_structures f JOIN schools s ON f.school_id = s.school_id';
  const params = [];
  if (school_id) { sql += ' WHERE f.school_id = ?'; params.push(school_id); }
  sql += ' ORDER BY s.school_name, f.fee_name';
  const [rows] = await req.db.execute(sql, params);
  res.json({ fees: rows });
});

router.post('/fees', async (req, res) => {
  const { school_id, fee_name, amount, term, academic_year, is_optional } = req.body;
  if (!school_id || !fee_name || !amount || !term || !academic_year) return res.status(400).json({ error: 'school_id, fee_name, amount, term, academic_year required' });
  const [r] = await req.db.execute('INSERT INTO fee_structures (school_id, fee_name, amount, term, academic_year, is_optional) VALUES (?, ?, ?, ?, ?, ?)', [school_id, fee_name, amount, term, academic_year, is_optional || false]);
  res.json({ fee_id: r.insertId, fee_name });
});

router.delete('/fees/:id', async (req, res) => {
  await req.db.execute('DELETE FROM fee_assignments WHERE fee_id = ?', [req.params.id]);
  await req.db.execute('DELETE FROM fee_structures WHERE fee_id = ?', [req.params.id]);
  res.json({ deleted: true });
});

// REPORT SETTINGS PER SCHOOL
router.get('/report-settings', async (req, res) => {
  const { school_id } = req.query;
  if (!school_id) return res.status(400).json({ error: 'school_id required' });

  const [rows] = await req.db.execute(
    'SELECT school_id, template_name, show_teacher_name, show_teacher_signature, show_final_remarks, show_recommendation, teacher_name, teacher_signature, final_remarks, recommendation_text, layout_json, created_at, updated_at FROM school_report_settings WHERE school_id = ?',
    [school_id]
  );

  const settings = rows[0] || {
    school_id,
    template_name: 'Default Report',
    show_teacher_name: true,
    show_teacher_signature: true,
    show_final_remarks: true,
    show_recommendation: true,
    teacher_name: null,
    teacher_signature: null,
    final_remarks: null,
    recommendation_text: null,
    layout_json: null
  };

  res.json({ settings });
});

router.post('/report-settings', async (req, res) => {
  const {
    school_id,
    template_name,
    show_teacher_name,
    show_teacher_signature,
    show_final_remarks,
    show_recommendation,
    teacher_name,
    teacher_signature,
    final_remarks,
    recommendation_text,
    layout_json
  } = req.body;

  if (!school_id) return res.status(400).json({ error: 'school_id required' });

  const payload = {
    school_id,
    template_name: template_name || 'Default Report',
    show_teacher_name: show_teacher_name !== false,
    show_teacher_signature: show_teacher_signature !== false,
    show_final_remarks: show_final_remarks !== false,
    show_recommendation: show_recommendation !== false,
    teacher_name: teacher_name || null,
    teacher_signature: teacher_signature || null,
    final_remarks: final_remarks || null,
    recommendation_text: recommendation_text || null,
    layout_json: layout_json ? JSON.stringify(layout_json) : null
  };

  await req.db.execute(
    `INSERT INTO school_report_settings (
      school_id,
      template_name,
      show_teacher_name,
      show_teacher_signature,
      show_final_remarks,
      show_recommendation,
      teacher_name,
      teacher_signature,
      final_remarks,
      recommendation_text,
      layout_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      template_name = VALUES(template_name),
      show_teacher_name = VALUES(show_teacher_name),
      show_teacher_signature = VALUES(show_teacher_signature),
      show_final_remarks = VALUES(show_final_remarks),
      show_recommendation = VALUES(show_recommendation),
      teacher_name = VALUES(teacher_name),
      teacher_signature = VALUES(teacher_signature),
      final_remarks = VALUES(final_remarks),
      recommendation_text = VALUES(recommendation_text),
      layout_json = VALUES(layout_json)`,
    [
      payload.school_id,
      payload.template_name,
      payload.show_teacher_name,
      payload.show_teacher_signature,
      payload.show_final_remarks,
      payload.show_recommendation,
      payload.teacher_name,
      payload.teacher_signature,
      payload.final_remarks,
      payload.recommendation_text,
      payload.layout_json
    ]
  );

  res.json({ saved: true, school_id });
});

// SETTINGS
router.get('/settings', async (req, res) => {
  const [rows] = await req.db.execute('SELECT setting_key, setting_value FROM app_settings ORDER BY setting_key');
  const settings = {};
  for (const r of rows) settings[r.setting_key] = r.setting_value;
  res.json({ settings });
});

router.post('/settings', async (req, res) => {
  const { settings } = req.body;
  if (!settings || typeof settings !== 'object') return res.status(400).json({ error: 'settings object required' });
  for (const [key, value] of Object.entries(settings)) {
    await req.db.execute(
      'INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
      [key, String(value), String(value)]
    );
  }
  res.json({ updated: true });
});

// REVENUE — premium subscription revenue only (admin revenue, NOT school fees)
router.get('/revenue', async (req, res) => {
  const [totals] = await req.db.execute(
    "SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM premium_subscriptions WHERE payment_status = 'paid'"
  );
  const [monthly] = await req.db.execute(
    "SELECT DATE_FORMAT(COALESCE(activated_at, created_at), '%Y-%m') AS month, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM premium_subscriptions WHERE payment_status = 'paid' GROUP BY month ORDER BY month DESC LIMIT 12"
  );
  const [byModel] = await req.db.execute(
    "SELECT payment_model, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM premium_subscriptions WHERE payment_status = 'paid' GROUP BY payment_model"
  );
  const [premium] = await req.db.execute(
    "SELECT COUNT(*) AS count FROM parent_profiles WHERE is_premium = TRUE AND (premium_expires_at IS NULL OR premium_expires_at > NOW())"
  );
  res.json({
    totals: { amount: totals[0]?.total || 0, transactions: totals[0]?.count || 0 },
    monthly: monthly || [],
    byModel: byModel || [],
    premiumParents: premium[0]?.count || 0
  });
});

// REVENUE BY SALES REP — premium subscriptions per sales rep
router.get('/revenue/sales-reps', async (req, res) => {
  const [rows] = await req.db.execute(
    `SELECT sr.rep_id, sr.full_name, sr.phone, sr.email,
            COALESCE(SUM(ps.amount), 0) AS revenue,
            COUNT(ps.subscription_id) AS transactions,
            COUNT(DISTINCT sc.school_id) AS schools_count
     FROM sales_reps sr
     LEFT JOIN schools sc ON sc.sales_rep_id = sr.rep_id
     LEFT JOIN premium_subscriptions ps ON ps.school_id = sc.school_id AND ps.payment_status = 'paid'
     GROUP BY sr.rep_id, sr.full_name, sr.phone, sr.email
     ORDER BY revenue DESC`
  );
  res.json({ sales_rep_revenue: rows });
});

// PREMIUM REVENUE BY SALES REP AND SCHOOL
router.get('/revenue/premium-by-sales-rep', async (req, res) => {
  try {
    const [rows] = await req.db.execute(
      `SELECT sr.rep_id,
              sr.full_name AS rep_name,
              sc.school_id,
              sc.school_name,
              COALESCE(SUM(ps.amount), 0) AS revenue,
              COUNT(ps.subscription_id) AS transactions
       FROM sales_reps sr
       JOIN schools sc ON sc.sales_rep_id = sr.rep_id
       LEFT JOIN premium_subscriptions ps ON ps.school_id = sc.school_id AND ps.payment_status = 'paid'
       GROUP BY sr.rep_id, sr.full_name, sc.school_id, sc.school_name
       ORDER BY sr.full_name, sc.school_name`
    );

    // Transform into nested structure: [{ rep_id, rep_name, schools: [{school_id, school_name, revenue, transactions}, ...] }, ...]
    const map = {};
    for (const r of rows) {
      if (!map[r.rep_id]) {
        map[r.rep_id] = { rep_id: r.rep_id, rep_name: r.rep_name, schools: [] };
      }
      map[r.rep_id].schools.push({ school_id: r.school_id, school_name: r.school_name, revenue: Number(r.revenue), transactions: r.transactions });
    }
    const result = Object.values(map);
    res.json({ premium_revenue_by_rep: result });
  } catch (err) {
    console.error('premium-by-sales-rep error:', err.message);
    res.status(500).json({ error: 'Failed to compute premium revenue' });
  }
});

// Stats (for dashboard) — revenue figures are premium subscription revenue, not school fees
router.get('/_stats', async (req, res) => {
  async function cnt(table) { try { const [[r]] = await req.db.execute(`SELECT COUNT(*) AS c FROM \`${table}\``); return r.c; } catch { return '—'; } }
  const [revenue] = await req.db.execute("SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM premium_subscriptions WHERE payment_status = 'paid'");
  const [premium] = await req.db.execute(
    "SELECT COUNT(*) AS count FROM parent_profiles WHERE is_premium = TRUE AND (premium_expires_at IS NULL OR premium_expires_at > NOW())"
  );
  res.json({
    schools: await cnt('schools'),
    teachers: await cnt('teachers'),
    students: await cnt('students'),
    parents: await cnt('parent_profiles'),
    attendance: await cnt('attendance_logs'),
    premium_subscriptions: revenue[0]?.count || 0,
    assessments: await cnt('assessments'),
    campaigns: await cnt('marketplace_campaigns'),
    premium_parents: premium[0]?.count || 0,
    revenue: revenue[0]?.total || 0
  });
});

// PROMOTION: preview and commit promotions/graduations
// POST /admin/api/promote
// Body: { student_ids: ["STU001","STU002"], performed_by: "TCH123", preview: true }
router.post('/promote', async (req, res) => {
  const { student_ids, performed_by, preview } = req.body;
  if (!Array.isArray(student_ids) || student_ids.length === 0) return res.status(400).json({ error: 'student_ids array required' });

  // Fetch students and their class info
  const placeholders = student_ids.map(() => '?').join(',');
  const [students] = await req.db.execute(
    `SELECT s.student_id, s.full_name, s.class_id, c.class_name, c.class_rank, c.school_id
     FROM students s JOIN classes c ON s.class_id = c.class_id
     WHERE s.student_id IN (${placeholders})`,
    student_ids
  );

  const foundIds = new Set(students.map(s => s.student_id));
  const missing = student_ids.filter(id => !foundIds.has(id));

  // Build preview rows (determine next class per student)
  const previewRows = [];
  for (const s of students) {
    const nextRank = (s.class_rank === null || s.class_rank === undefined) ? null : s.class_rank + 1;
    let next = null;
    if (nextRank !== null) {
      const [nextRows] = await req.db.execute('SELECT class_id, class_name, class_rank FROM classes WHERE school_id = ? AND class_rank = ?', [s.school_id, nextRank]);
      next = nextRows[0] || null;
    }
    previewRows.push({
      student_id: s.student_id,
      full_name: s.full_name,
      from_class_id: s.class_id,
      from_class_name: s.class_name,
      from_rank: s.class_rank,
      to_class_id: next ? next.class_id : null,
      to_class_name: next ? next.class_name : null,
      action: next ? 'Promote' : 'Graduate'
    });
  }

  if (preview) return res.json({ preview: previewRows, missing });

  // Perform transactional promotion/graduation
  const conn = await req.db.getConnection();
  try {
    await conn.beginTransaction();

    const promoteList = previewRows.filter(r => r.to_class_id);
    const graduateList = previewRows.filter(r => !r.to_class_id);

    // Insert promotion_history for those promoted
    if (promoteList.length > 0) {
      const valuePlaceholders = promoteList.map(() => '(?, ?, ?, ?, ?)').join(',');
      const params = [];
      promoteList.forEach(p => {
        params.push(p.student_id, p.from_class_id, p.to_class_id, 'Promoted', performed_by || null);
      });
      await conn.execute(`INSERT INTO promotion_history (student_id, from_class_id, to_class_id, action, performed_by) VALUES ${valuePlaceholders}`, params);

      // Update students.class_id using CASE so each student can get a different target class
      let caseSql = 'CASE student_id';
      const caseParams = [];
      promoteList.forEach(p => {
        caseSql += ' WHEN ? THEN ?';
        caseParams.push(p.student_id, p.to_class_id);
      });
      caseSql += ' END';
      const wherePlaceholders = promoteList.map(() => '?').join(',');
      const updateSql = `UPDATE students SET class_id = ${caseSql} WHERE student_id IN (${wherePlaceholders})`;
      await conn.execute(updateSql, [...caseParams, ...promoteList.map(p => p.student_id)]);
    }

    // Insert promotion_history for graduates (to_class_id = NULL)
    if (graduateList.length > 0) {
      const valuePlaceholders = graduateList.map(() => '(?, ?, ?, ?, ?)').join(',');
      const params = [];
      graduateList.forEach(g => {
        params.push(g.student_id, g.from_class_id, null, 'Graduated', performed_by || null);
      });
      await conn.execute(`INSERT INTO promotion_history (student_id, from_class_id, to_class_id, action, performed_by) VALUES ${valuePlaceholders}`, params);
    }

    await conn.commit();
    return res.json({ promoted: promoteList.length, graduated: graduateList.length, missing, details: previewRows });
  } catch (err) {
    await conn.rollback();
    return res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
