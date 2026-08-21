const express = require('express');
const router = express.Router();
const { verifyToken } = require('../lib/auth');

// requireHead using OTP sessions (session_id as bearer token). Verifies session exists and is verified.
async function requireHead(req, res) {
  const auth = (req.headers.authorization || '').trim();
  if (!auth || !auth.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing or invalid Authorization header' }); return null; }
  const sessionId = auth.split(' ')[1];
  // Look up otp_sessions to validate the session token
  const [srows] = await req.db.execute('SELECT phone, verified, expires_at FROM otp_sessions WHERE session_id = ?', [sessionId]);
  if (srows.length === 0) { res.status(401).json({ error: 'Invalid session' }); return null; }
  const sess = srows[0];
  if (!sess.verified || !sess.expires_at || new Date(sess.expires_at) <= new Date()) { res.status(401).json({ error: 'Session not verified or expired' }); return null; }
  // Resolve teacher by phone; if phone is empty (email-only login) resolve by email
  let trows;
  if (sess.phone) {
    [trows] = await req.db.execute('SELECT teacher_id, role, school_id FROM teachers WHERE phone = ?', [sess.phone]);
  }
  if (!trows || trows.length === 0) {
    const [sessRows] = await req.db.execute('SELECT email FROM otp_sessions WHERE session_id = ?', [sessionId]);
    const email = (sessRows[0] && sessRows[0].email) || null;
    if (email) {
      [trows] = await req.db.execute('SELECT teacher_id, role, school_id FROM teachers WHERE email = ?', [email]);
    }
  }
  if (!trows || trows.length === 0) { res.status(404).json({ error: 'Teacher not found' }); return null; }
  const teacher = trows[0];
  if (teacher.role !== 'head' || teacher.school_id !== req.params.schoolId) { res.status(403).json({ error: 'Only the school head may perform this action' }); return null; }
  return { teacher_id: teacher.teacher_id, role: teacher.role, school_id: teacher.school_id };
}

// List teachers for the school (public-ish)
router.get('/:schoolId/teachers', async (req, res) => {
  const [rows] = await req.db.execute(
    'SELECT teacher_id, full_name, phone, email, role FROM teachers WHERE school_id = ? ORDER BY full_name',
    [req.params.schoolId]
  );
  res.json({ teachers: rows });
});

// List classes for the school
router.get('/:schoolId/classes', async (req, res) => {
  const [rows] = await req.db.execute(
    'SELECT class_id, class_name, stream, level_name, academic_year FROM classes WHERE school_id = ? ORDER BY class_rank, class_name',
    [req.params.schoolId]
  );
  res.json({ classes: rows });
});

// List students for the school (optional ?class_id= filter)
router.get('/:schoolId/students', async (req, res) => {
  const { class_id } = req.query;
  let sql = 'SELECT st.*, c.class_name FROM students st JOIN classes c ON st.class_id = c.class_id WHERE st.school_id = ?';
  const params = [req.params.schoolId];
  if (class_id) { sql += ' AND st.class_id = ?'; params.push(class_id); }
  sql += ' ORDER BY c.class_name, st.full_name';
  const [rows] = await req.db.execute(sql, params);
  res.json({ students: rows });
});

// Create a teacher or bursar (only headteacher). Creating headteachers is restricted to admin only.
router.post('/:schoolId/teachers', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return; // response already sent

  const { full_name, phone, email, role } = req.body;
  const cleanRole = (role || 'teacher').toLowerCase();
  if (cleanRole === 'head') return res.status(403).json({ error: 'Creating headteachers is restricted to admin only.' });
  if (cleanRole !== 'teacher' && cleanRole !== 'bursar') return res.status(400).json({ error: 'Invalid role. Must be teacher or bursar.' });
  if (!full_name || !phone) return res.status(400).json({ error: 'Name and phone required' });

  const teacherId = 'TCH' + String(Math.floor(100000 + Math.random() * 900000));
  const [existing] = await req.db.execute('SELECT teacher_id FROM teachers WHERE phone = ?', [phone]);
  if (existing.length > 0) return res.status(409).json({ error: 'Phone already registered' });
  if (email) {
    const [emailExisting] = await req.db.execute('SELECT teacher_id FROM teachers WHERE email = ?', [email]);
    if (emailExisting.length > 0) return res.status(409).json({ error: 'Email already registered' });
  }

  await req.db.execute(
    'INSERT INTO teachers (teacher_id, full_name, phone, email, school_id, role) VALUES (?, ?, ?, ?, ?, ?)',
    [teacherId, full_name, phone, email || null, req.params.schoolId, cleanRole]
  );

  res.json({ teacher_id: teacherId, full_name, phone, email: email || null, role: cleanRole });
});

// Delete a teacher (only headteacher)
router.delete('/:schoolId/teachers/:teacherId', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return;

  const [t] = await req.db.execute('SELECT role FROM teachers WHERE teacher_id = ? AND school_id = ?', [req.params.teacherId, req.params.schoolId]);
  if (t.length === 0) return res.status(404).json({ error: 'Teacher not found' });
  if (t[0].role === 'head') return res.status(403).json({ error: 'Cannot remove school head' });

  await req.db.execute('DELETE FROM teachers WHERE teacher_id = ?', [req.params.teacherId]);
  res.json({ deleted: true });
});

// Create a class — only headteacher of the school may create classes
router.post('/:schoolId/classes', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return;

  const { class_name, academic_year, stream, level_name } = req.body;
  const year = academic_year || new Date().getFullYear();
  // Compose name from level/stream when the UI sends a placeholder
  let name = (class_name && class_name !== 'auto') ? class_name : null;
  if (!name && level_name) name = stream ? `${level_name} - ${stream}` : level_name;
  if (!name) return res.status(400).json({ error: 'class_name or level_name required' });

  const [r] = await req.db.execute(
    'INSERT INTO classes (school_id, class_name, stream, level_name, academic_year) VALUES (?, ?, ?, ?, ?)',
    [req.params.schoolId, name, stream || null, level_name || null, year]
  );
  res.json({ class_id: r.insertId, class_name: name });
});

// Update a class — only headteacher
router.put('/:schoolId/classes/:classId', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return;

  const { class_name, stream, level_name, academic_year } = req.body;
  const fields = [];
  const params = [];
  if (stream !== undefined) { fields.push('stream = ?'); params.push(stream || null); }
  if (level_name !== undefined) {
    fields.push('level_name = ?'); params.push(level_name || null);
    // Keep the display name in sync with level/stream unless explicitly overridden
    if (!class_name && level_name) {
      fields.push('class_name = ?');
      params.push(stream ? `${level_name} - ${stream}` : level_name);
    }
  }
  if (class_name) { fields.push('class_name = ?'); params.push(class_name); }
  if (academic_year) { fields.push('academic_year = ?'); params.push(academic_year); }
  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
  params.push(req.params.classId, req.params.schoolId);
  await req.db.execute(`UPDATE classes SET ${fields.join(', ')} WHERE class_id = ? AND school_id = ?`, params);
  const [saved] = await req.db.execute('SELECT class_id, class_name, stream, level_name, academic_year FROM classes WHERE class_id = ?', [req.params.classId]);
  res.json(saved[0]);
});

// Delete a class — only headteacher
router.delete('/:schoolId/classes/:classId', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return;
  await req.db.execute('DELETE FROM classes WHERE class_id = ? AND school_id = ?', [req.params.classId, req.params.schoolId]);
  res.json({ deleted: true });
});

// List streams for the school
router.get('/:schoolId/streams', async (req, res) => {
  const [rows] = await req.db.execute(
    'SELECT stream_id, stream_name, display_order FROM school_streams WHERE school_id = ? ORDER BY display_order, stream_name',
    [req.params.schoolId]
  );
  res.json({ streams: rows });
});

// Add a stream — only headteacher
router.post('/:schoolId/streams', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return;
  const { stream_name } = req.body;
  if (!stream_name) return res.status(400).json({ error: 'stream_name required' });
  try {
    const [r] = await req.db.execute('INSERT INTO school_streams (school_id, stream_name) VALUES (?, ?)', [req.params.schoolId, stream_name]);
    res.json({ stream_id: r.insertId, stream_name });
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Stream already exists' });
    throw err;
  }
});

// Delete a stream — only headteacher
router.delete('/:schoolId/streams/:streamId', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return;
  await req.db.execute('DELETE FROM school_streams WHERE stream_id = ? AND school_id = ?', [req.params.streamId, req.params.schoolId]);
  res.json({ deleted: true });
});

// Create a single student — only headteacher. Optional parent_phone/parent_name links the parent.
router.post('/:schoolId/students', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return;

  const { student_id, full_name, class_id, parent_phone, parent_name } = req.body;
  if (!student_id || !full_name || !class_id) return res.status(400).json({ error: 'student_id, full_name, class_id required' });

  // Verify class belongs to this school
  const [c] = await req.db.execute('SELECT class_id FROM classes WHERE class_id = ? AND school_id = ?', [class_id, req.params.schoolId]);
  if (c.length === 0) return res.status(400).json({ error: 'Class not found for this school' });

  try {
    await req.db.execute('INSERT INTO students (student_id, full_name, class_id, school_id) VALUES (?, ?, ?, ?)', [student_id, full_name, class_id, req.params.schoolId]);
    if (parent_phone) {
      await req.db.execute('INSERT INTO parent_profiles (parent_phone, full_name, is_premium) VALUES (?, ?, FALSE) ON DUPLICATE KEY UPDATE full_name = COALESCE(NULLIF(?, \'\'), full_name)', [parent_phone, parent_name || null, parent_name || null]);
      await req.db.execute('INSERT IGNORE INTO student_parent_map (student_id, parent_phone) VALUES (?, ?)', [student_id, parent_phone]);
    }
    res.json({ student_id, full_name, parent_phone: parent_phone || null });
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Student ID already exists' });
    res.status(500).json({ error: err.message });
  }
});

// CSV Import Students — school head can bulk-import into a class.
// Format per line: student_id,full_name  OR  student_id,full_name,parent_phone,parent_name
router.post('/:schoolId/students/import', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return;

  const { class_id, csv } = req.body;
  if (!class_id || !csv) return res.status(400).json({ error: 'class_id and csv required' });
  const lines = csv.trim().split('\n');
  let imported = 0, errors = 0, parentsLinked = 0;
  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length < 2) { errors++; continue; }
    const student_id = parts[0].trim();
    const full_name = parts.slice(1).join(',').trim();
    if (!student_id || !full_name) { errors++; continue; }
    const parent_phone = parts.length >= 3 ? parts[2].trim() : '';
    const parent_name = parts.length >= 4 ? parts.slice(3).join(',').trim() : '';
    try {
      await req.db.execute('INSERT INTO students (student_id, full_name, class_id, school_id) VALUES (?, ?, ?, ?)',
        [student_id, full_name, class_id, req.params.schoolId]);
      imported++;
      if (parent_phone) {
        await req.db.execute('INSERT INTO parent_profiles (parent_phone, full_name, is_premium) VALUES (?, ?, FALSE) ON DUPLICATE KEY UPDATE full_name = COALESCE(NULLIF(?, \'\'), full_name)', [parent_phone, parent_name || null, parent_name || null]);
        await req.db.execute('INSERT IGNORE INTO student_parent_map (student_id, parent_phone) VALUES (?, ?)', [student_id, parent_phone]);
        parentsLinked++;
      }
    } catch { errors++; }
  }
  res.json({ imported, errors, parentsLinked });
});

// Analytics — attendance summary per class for school head
router.get('/:schoolId/analytics/attendance', async (req, res) => {
  const { days } = req.query;
  const period = parseInt(days) || 30;
  const [rows] = await req.db.execute(
    `SELECT a.attendance_date, a.status, COUNT(*) AS cnt
     FROM attendance_logs a
     JOIN students s ON a.student_id = s.student_id
     WHERE s.school_id = ? AND a.attendance_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY a.attendance_date, a.status
     ORDER BY a.attendance_date`,
    [req.params.schoolId, period]
  );
  res.json({ analytics: rows });
});

// Broadcast WhatsApp message to all premium parents in the school
router.post('/:schoolId/broadcast', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  const [parents] = await req.db.execute(
    `SELECT DISTINCT p.parent_phone, s.school_name
     FROM parent_profiles p
     JOIN student_parent_map m ON p.parent_phone = m.parent_phone
     JOIN students st ON m.student_id = st.student_id
     JOIN schools s ON st.school_id = s.school_id
     WHERE st.school_id = ? AND p.is_premium = TRUE AND (p.premium_expires_at IS NULL OR p.premium_expires_at >= NOW())`,
    [req.params.schoolId]
  );
  if (parents.length === 0) return res.json({ sent: 0, message: 'No premium parents found' });
  const { sendBroadcast } = require('../services/messaging');
  let sent = 0;
  for (const p of parents) {
    try {
      await sendBroadcast(p.parent_phone, p.school_name, message);
      sent++;
    } catch (e) {
      console.error(`[BROADCAST] Failed to ${p.parent_phone}: ${e.message}`);
    }
  }
  res.json({ sent, total: parents.length });
});

// Fee reminder — trigger WhatsApp fee reminder for a parent
router.post('/:schoolId/fee-reminder/:studentId', async (req, res) => {
  const [student] = await req.db.execute(
    `SELECT s.full_name FROM students s WHERE s.student_id = ? AND s.school_id = ?`,
    [req.params.studentId, req.params.schoolId]
  );
  if (student.length === 0) return res.status(404).json({ error: 'Student not found' });

  // Get total fee for the current term
  const [fees] = await req.db.execute(
    `SELECT SUM(f.amount) AS total FROM fee_structures f
     WHERE f.school_id = ? AND f.term = (SELECT CONCAT('Term ', CEIL(MONTH(CURDATE())/4)) FROM DUAL)`,
    [req.params.schoolId]
  );
  // Get amount paid
  const [paid] = await req.db.execute(
    `SELECT COALESCE(SUM(amount), 0) AS paid FROM payment_ledger WHERE student_reference = ?`,
    [req.params.studentId]
  );
  const total = fees[0]?.total || 0;
  const balance = total - paid[0].paid;

  const [parentRows] = await req.db.execute(
    `SELECT p.parent_phone FROM student_parent_map m
     JOIN parent_profiles p ON m.parent_phone = p.parent_phone
     WHERE m.student_id = ? AND p.is_premium = TRUE`,
    [req.params.studentId]
  );

  if (parentRows.length > 0) {
    const { sendFeeReminder } = require('../services/messaging');
    for (const p of parentRows) {
      sendFeeReminder(p.parent_phone, student[0].full_name, total.toString(), Math.max(0, balance).toString())
        .catch(e => console.error('[WA] Fee reminder failed:', e.message));
    }
    res.json({ sent: parentRows.length, student: student[0].full_name, balance: Math.max(0, balance) });
  } else {
    res.json({ sent: 0, message: 'No premium parent linked' });
  }
});

module.exports = router;
