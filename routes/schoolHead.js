const express = require('express');
const router = express.Router();
const { verifyToken } = require('../lib/auth');

async function requireHead(req, res) {
  const auth = (req.headers.authorization || '').trim();
  if (!auth || !auth.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing or invalid Authorization header' }); return null; }
  const sessionId = auth.split(' ')[1];
  const [srows] = await req.db.execute('SELECT phone, verified, expires_at FROM otp_sessions WHERE session_id = ?', [sessionId]);
  if (srows.length === 0) { res.status(401).json({ error: 'Invalid session' }); return null; }
  const sess = srows[0];
  if (!sess.verified || !sess.expires_at || new Date(sess.expires_at) <= new Date()) { res.status(401).json({ error: 'Session not verified or expired' }); return null; }
  const [trows] = await req.db.execute('SELECT teacher_id, role, school_id FROM teachers WHERE phone = ?', [sess.phone]);
  if (trows.length === 0) { res.status(404).json({ error: 'Teacher not found' }); return null; }
  const teacher = trows[0];
  if (teacher.role !== 'head' || teacher.school_id !== req.params.schoolId) { res.status(403).json({ error: 'Only the school head may perform this action' }); return null; }
  return { teacher_id: teacher.teacher_id, role: teacher.role, school_id: teacher.school_id, phone: sess.phone };
}

async function autoGenerateStudentId(db, schoolId) {
  const [seq] = await db.execute('SELECT next_id, prefix FROM student_id_sequences WHERE school_id = ?', [schoolId]);
  if (seq.length === 0) {
    await db.execute('INSERT INTO student_id_sequences (school_id) VALUES (?)', [schoolId]);
    return 'STU001';
  }
  const next = seq[0].next_id;
  const prefix = seq[0].prefix || 'STU';
  const id = prefix + String(next).padStart(3, '0');
  await db.execute('UPDATE student_id_sequences SET next_id = next_id + 1 WHERE school_id = ?', [schoolId]);
  return id;
}

router.get('/:schoolId/teachers', async (req, res) => {
  const [rows] = await req.db.execute('SELECT teacher_id, full_name, phone, role FROM teachers WHERE school_id = ? ORDER BY full_name', [req.params.schoolId]);
  res.json({ teachers: rows });
});

router.post('/:schoolId/teachers', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return;
  const { full_name, phone, role } = req.body;
  if (role && role.toLowerCase() === 'head') return res.status(403).json({ error: 'Creating headteachers is restricted to admin only.' });
  if (!full_name || !phone) return res.status(400).json({ error: 'Name and phone required' });
  const teacherId = 'TCH' + Date.now().toString(36).toUpperCase();
  const [existing] = await req.db.execute('SELECT teacher_id FROM teachers WHERE phone = ?', [phone]);
  if (existing.length > 0) return res.status(409).json({ error: 'Phone already registered' });
  await req.db.execute('INSERT INTO teachers (teacher_id, full_name, phone, school_id, role) VALUES (?, ?, ?, ?, ?)', [teacherId, full_name, phone, req.params.schoolId, 'teacher']);
  res.json({ teacher_id: teacherId, full_name, phone, role: 'teacher' });
});

router.delete('/:schoolId/teachers/:teacherId', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return;
  const [t] = await req.db.execute('SELECT role FROM teachers WHERE teacher_id = ? AND school_id = ?', [req.params.teacherId, req.params.schoolId]);
  if (t.length === 0) return res.status(404).json({ error: 'Teacher not found' });
  if (t[0].role === 'head') return res.status(403).json({ error: 'Cannot remove school head' });
  await req.db.execute('DELETE FROM teachers WHERE teacher_id = ?', [req.params.teacherId]);
  res.json({ deleted: true });
});

// ─── Streams ─────────────────────────────────────────────────────

router.get('/:schoolId/streams', async (req, res) => {
  const [rows] = await req.db.execute('SELECT stream_id, stream_name, display_order FROM school_streams WHERE school_id = ? ORDER BY display_order', [req.params.schoolId]);
  res.json({ streams: rows });
});

router.post('/:schoolId/streams', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return;
  const { stream_name } = req.body;
  if (!stream_name) return res.status(400).json({ error: 'stream_name required' });
  try {
    const [r] = await req.db.execute('INSERT INTO school_streams (school_id, stream_name) VALUES (?, ?)', [req.params.schoolId, stream_name]);
    res.json({ stream_id: r.insertId, stream_name });
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Stream name already exists' });
    console.error('[SCHOOLHEAD]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:schoolId/streams/:streamId', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return;
  await req.db.execute('DELETE FROM school_streams WHERE stream_id = ? AND school_id = ?', [req.params.streamId, req.params.schoolId]);
  res.json({ deleted: true });
});

// ─── Classes ─────────────────────────────────────────────────────

router.get('/:schoolId/classes', async (req, res) => {
  const [rows] = await req.db.execute('SELECT class_id, class_name, stream, level_name, academic_year FROM classes WHERE school_id = ? ORDER BY level_name, stream, class_name', [req.params.schoolId]);
  res.json({ classes: rows });
});

router.post('/:schoolId/classes', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return;
  const { class_name, academic_year, stream, level_name } = req.body;
  if (!class_name || !academic_year) return res.status(400).json({ error: 'class_name and academic_year required' });
  const displayName = stream ? `${class_name} ${stream}` : class_name;
  const [r] = await req.db.execute('INSERT INTO classes (school_id, class_name, academic_year, stream, level_name) VALUES (?, ?, ?, ?, ?)', [req.params.schoolId, displayName, academic_year, stream || null, level_name || null]);
  res.json({ class_id: r.insertId, class_name: displayName, stream: stream || null, level_name: level_name || null });
});

router.put('/:schoolId/classes/:classId', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return;
  const { class_name, stream, level_name, academic_year } = req.body;
  const displayName = class_name && stream ? `${class_name} ${stream}` : (class_name || undefined);
  await req.db.execute('UPDATE classes SET class_name = COALESCE(?, class_name), stream = COALESCE(?, stream), level_name = COALESCE(?, level_name), academic_year = COALESCE(?, academic_year) WHERE class_id = ? AND school_id = ?', [displayName || null, stream || null, level_name || null, academic_year || null, req.params.classId, req.params.schoolId]);
  res.json({ updated: true });
});

// ─── Students ────────────────────────────────────────────────────

router.get('/:schoolId/students', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return;
  const { class_id } = req.query;
  let sql = `SELECT s.student_id, s.full_name, s.class_id, c.class_name, s.date_of_birth, s.gender, s.admission_number, s.admission_date, s.guardian_name, s.guardian_phone, s.guardian_relationship, s.address, s.religion, s.nationality, s.medical_notes, s.special_needs, s.previous_school, s.enrollment_status FROM students s JOIN classes c ON s.class_id = c.class_id WHERE s.school_id = ?`;
  const params = [req.params.schoolId];
  if (class_id) { sql += ' AND s.class_id = ?'; params.push(class_id); }
  sql += ' ORDER BY s.full_name';
  const [rows] = await req.db.execute(sql, params);
  res.json({ students: rows });
});

router.get('/:schoolId/students/:studentId', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return;
  const [rows] = await req.db.execute('SELECT s.*, c.class_name, c.stream, c.level_name FROM students s JOIN classes c ON s.class_id = c.class_id WHERE s.student_id = ? AND s.school_id = ?', [req.params.studentId, req.params.schoolId]);
  if (rows.length === 0) return res.status(404).json({ error: 'Student not found' });
  res.json({ student: rows[0] });
});

router.post('/:schoolId/students', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return;
  const { full_name, class_id, student_id: manualId, date_of_birth, gender, admission_number, admission_date, guardian_name, guardian_phone, guardian_relationship, address, religion, nationality, medical_notes, special_needs, previous_school } = req.body;
  if (!full_name || !class_id) return res.status(400).json({ error: 'full_name and class_id required' });
  const [c] = await req.db.execute('SELECT class_id FROM classes WHERE class_id = ? AND school_id = ?', [class_id, req.params.schoolId]);
  if (c.length === 0) return res.status(400).json({ error: 'Class not found for this school' });
  const studentId = manualId || await autoGenerateStudentId(req.db, req.params.schoolId);
  try {
    await req.db.execute('INSERT INTO students (student_id, full_name, class_id, school_id, date_of_birth, gender, admission_number, admission_date, guardian_name, guardian_phone, guardian_relationship, address, religion, nationality, medical_notes, special_needs, previous_school) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [studentId, full_name, class_id, req.params.schoolId, date_of_birth || null, gender || null, admission_number || null, admission_date || null, guardian_name || null, guardian_phone || null, guardian_relationship || null, address || null, religion || null, nationality || null, medical_notes || null, special_needs || null, previous_school || null]);
    res.json({ student_id: studentId, full_name });
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Student ID already exists' });
    console.error('[SCHOOLHEAD]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:schoolId/students/:studentId', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return;
  const { full_name, class_id, date_of_birth, gender, admission_number, admission_date, guardian_name, guardian_phone, guardian_relationship, address, religion, nationality, medical_notes, special_needs, previous_school, enrollment_status } = req.body;
  await req.db.execute('UPDATE students SET full_name = COALESCE(?, full_name), class_id = COALESCE(?, class_id), date_of_birth = COALESCE(?, date_of_birth), gender = COALESCE(?, gender), admission_number = COALESCE(?, admission_number), admission_date = COALESCE(?, admission_date), guardian_name = COALESCE(?, guardian_name), guardian_phone = COALESCE(?, guardian_phone), guardian_relationship = COALESCE(?, guardian_relationship), address = COALESCE(?, address), religion = COALESCE(?, religion), nationality = COALESCE(?, nationality), medical_notes = COALESCE(?, medical_notes), special_needs = COALESCE(?, special_needs), previous_school = COALESCE(?, previous_school), enrollment_status = COALESCE(?, enrollment_status) WHERE student_id = ? AND school_id = ?', [full_name || null, class_id || null, date_of_birth || null, gender || null, admission_number || null, admission_date || null, guardian_name || null, guardian_phone || null, guardian_relationship || null, address || null, religion || null, nationality || null, medical_notes || null, special_needs || null, previous_school || null, enrollment_status || null, req.params.studentId, req.params.schoolId]);
  res.json({ updated: true });
});

router.post('/:schoolId/students/import', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return;
  const { class_id, csv } = req.body;
  if (!class_id || !csv) return res.status(400).json({ error: 'class_id and csv required' });
  const lines = csv.trim().split('\n');
  if (lines.length === 0) return res.status(400).json({ error: 'CSV is empty' });
  const header = lines[0].toLowerCase().split(',').map(h => h.trim());
  const dataLines = lines.slice(1).filter(l => l.trim());
  let imported = 0, errors = 0;
  for (const line of dataLines) {
    const parts = line.split(',');
    const row = {};
    header.forEach((h, i) => { row[h] = (parts[i] || '').trim(); });
    if (!row.full_name) { errors++; continue; }
    try {
      const studentId = row.student_id || await autoGenerateStudentId(req.db, req.params.schoolId);
      await req.db.execute('INSERT INTO students (student_id, full_name, class_id, school_id, date_of_birth, gender, admission_number, admission_date, guardian_name, guardian_phone, guardian_relationship, address, religion, nationality, medical_notes, special_needs, previous_school) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [studentId, row.full_name, class_id, req.params.schoolId, row.date_of_birth || null, row.gender || null, row.admission_number || null, row.admission_date || null, row.guardian_name || null, row.guardian_phone || null, row.guardian_relationship || null, row.address || null, row.religion || null, row.nationality || null, row.medical_notes || null, row.special_needs || null, row.previous_school || null]);
      imported++;
    } catch { errors++; }
  }
  res.json({ imported, errors });
});

// ─── Student Operations ──────────────────────────────────────────

router.post('/:schoolId/students/promote', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return;
  const { student_ids, to_class_id } = req.body;
  if (!student_ids?.length || !to_class_id) return res.status(400).json({ error: 'student_ids and to_class_id required' });
  const [c] = await req.db.execute('SELECT class_id FROM classes WHERE class_id = ? AND school_id = ?', [to_class_id, req.params.schoolId]);
  if (c.length === 0) return res.status(400).json({ error: 'Target class not found for this school' });
  const conn = await req.db.getConnection();
  try {
    await conn.beginTransaction();
    for (const sid of student_ids) {
      await conn.execute('UPDATE students SET class_id = ?, enrollment_status = ? WHERE student_id = ? AND school_id = ?', [to_class_id, 'Active', sid, req.params.schoolId]);
      await conn.execute('INSERT INTO promotion_history (student_id, from_class_id, to_class_id, action) SELECT ?, class_id, ?, \'Promoted\' FROM students WHERE student_id = ?', [sid, to_class_id, sid]);
    }
    await conn.commit();
    res.json({ promoted: student_ids.length });
  } catch (err) {
    await conn.rollback();
    console.error('[SCHOOLHEAD]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

router.post('/:schoolId/students/transfer', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return;
  const { student_ids, to_class_id } = req.body;
  if (!student_ids?.length || !to_class_id) return res.status(400).json({ error: 'student_ids and to_class_id required' });
  for (const sid of student_ids) {
    await req.db.execute('UPDATE students SET class_id = ? WHERE student_id = ? AND school_id = ?', [to_class_id, sid, req.params.schoolId]);
  }
  res.json({ transferred: student_ids.length });
});

router.post('/:schoolId/students/graduate', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return;
  const { student_ids } = req.body;
  if (!student_ids?.length) return res.status(400).json({ error: 'student_ids required' });
  for (const sid of student_ids) {
    await req.db.execute("UPDATE students SET enrollment_status = 'Graduated' WHERE student_id = ? AND school_id = ?", [sid, req.params.schoolId]);
  }
  res.json({ graduated: student_ids.length });
});

// ─── Analytics ───────────────────────────────────────────────────

router.get('/:schoolId/analytics/attendance', async (req, res) => {
  const { days } = req.query;
  const period = parseInt(days) || 30;
  const [rows] = await req.db.execute(`SELECT a.attendance_date, a.status, COUNT(*) AS cnt FROM attendance_logs a JOIN students s ON a.student_id = s.student_id WHERE s.school_id = ? AND a.attendance_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY) GROUP BY a.attendance_date, a.status ORDER BY a.attendance_date`, [req.params.schoolId, period]);
  res.json({ analytics: rows });
});

// ─── Broadcast ───────────────────────────────────────────────────

router.post('/:schoolId/broadcast', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  const [parents] = await req.db.execute(`SELECT DISTINCT p.parent_phone, s.school_name FROM parent_profiles p JOIN student_parent_map m ON p.parent_phone = m.parent_phone JOIN students st ON m.student_id = st.student_id JOIN schools s ON st.school_id = s.school_id WHERE st.school_id = ? AND p.is_premium = TRUE AND (p.premium_expires_at IS NULL OR p.premium_expires_at >= NOW())`, [req.params.schoolId]);
  if (parents.length === 0) return res.json({ sent: 0, message: 'No premium parents found' });
  const { sendBroadcast } = require('../services/messaging');
  let sent = 0;
  for (const p of parents) {
    try { await sendBroadcast(p.parent_phone, p.school_name, message); sent++; }
    catch (e) { console.error(`[BROADCAST] Failed to ${p.parent_phone}: ${e.message}`); }
  }
  res.json({ sent, total: parents.length });
});

router.post('/:schoolId/fee-reminder/:studentId', async (req, res) => {
  const [student] = await req.db.execute('SELECT s.full_name FROM students s WHERE s.student_id = ? AND s.school_id = ?', [req.params.studentId, req.params.schoolId]);
  if (student.length === 0) return res.status(404).json({ error: 'Student not found' });
  const [fees] = await req.db.execute('SELECT SUM(f.amount) AS total FROM fee_structures f WHERE f.school_id = ? AND f.term = (SELECT CONCAT(\'Term \', CEIL(MONTH(CURDATE())/4)) FROM DUAL)', [req.params.schoolId]);
  const [paid] = await req.db.execute('SELECT COALESCE(SUM(amount), 0) AS paid FROM payment_ledger WHERE student_reference = ?', [req.params.studentId]);
  const total = fees[0]?.total || 0;
  const balance = total - paid[0].paid;
  const [parentRows] = await req.db.execute('SELECT p.parent_phone FROM student_parent_map m JOIN parent_profiles p ON m.parent_phone = p.parent_phone WHERE m.student_id = ? AND p.is_premium = TRUE', [req.params.studentId]);
  if (parentRows.length > 0) {
    const { sendFeeReminder } = require('../services/messaging');
    for (const p of parentRows) { sendFeeReminder(p.parent_phone, student[0].full_name, total.toString(), Math.max(0, balance).toString()).catch(e => console.error('[WA] Fee reminder failed:', e.message)); }
    res.json({ sent: parentRows.length, student: student[0].full_name, balance: Math.max(0, balance) });
  } else {
    res.json({ sent: 0, message: 'No premium parent linked' });
  }
});

// ─── Premium Bulk Payment (School Pays via M-Pesa) ──────────────

router.post('/:schoolId/premium/pay', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return;
  const { phone } = req.body;
  const payPhone = phone || head.phone;
  const { getCurrentTerm } = require('../lib/config');
  const currentTerm = await getCurrentTerm(req.db, req.params.schoolId);
  const currentYear = new Date().getFullYear();
  const [cnt] = await req.db.execute("SELECT COUNT(*) AS total FROM students WHERE school_id = ? AND enrollment_status = 'Active'", [req.params.schoolId]);
  const totalStudents = cnt[0]?.total || 0;
  if (totalStudents === 0) return res.status(400).json({ error: 'No active students in this school' });
  const [school] = await req.db.execute('SELECT premium_fee_per_term FROM schools WHERE school_id = ?', [req.params.schoolId]);
  const [setting] = await req.db.execute("SELECT setting_value FROM app_settings WHERE setting_key = 'premium_price'");
  const feePerStudent = school[0]?.premium_fee_per_term || parseInt(setting[0]?.setting_value || '100');
  const totalAmount = feePerStudent * totalStudents;
  const [pr] = await req.db.execute('INSERT INTO premium_bulk_payments (school_id, term, year, amount, total_students, payment_status, initiated_by_phone) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.params.schoolId, currentTerm, currentYear, totalAmount, totalStudents, 'pending', payPhone]);
  const paymentId = pr.insertId;
  const reference = `BLK-${paymentId}`;
  const mpesa = require('../services/mpesa');
  const [schoolCreds] = await req.db.execute('SELECT mpesa_consumer_key, mpesa_consumer_secret, mpesa_passkey, mpesa_paybill, mpesa_environment, school_id FROM schools WHERE school_id = ?', [req.params.schoolId]);
  try {
    const result = await mpesa.stkPush(payPhone, totalAmount, reference, `Premium subscription ${currentTerm} ${currentYear}`, schoolCreds[0] || {});
    if (result.CheckoutRequestID) {
      await req.db.execute('UPDATE premium_bulk_payments SET transaction_reference = ? WHERE payment_id = ?', [result.CheckoutRequestID, paymentId]);
    }
    res.json({ payment_id: paymentId, reference, amount: totalAmount, total_students: totalStudents, checkout_request_id: result.CheckoutRequestID || null, response_code: result.ResponseCode, message: result.ResponseCode === '0' ? 'STK push sent. Enter PIN on your phone.' : (result.errorMessage || 'STK push failed') });
  } catch (err) {
    await req.db.execute("UPDATE premium_bulk_payments SET payment_status = 'failed' WHERE payment_id = ?", [paymentId]);
    console.error('[SCHOOLHEAD]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:schoolId/premium/payments', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return;
  const [rows] = await req.db.execute('SELECT * FROM premium_bulk_payments WHERE school_id = ? ORDER BY created_at DESC', [req.params.schoolId]);
  res.json({ payments: rows });
});

// ─── Premium Settings ────────────────────────────────────────────

router.get('/:schoolId/premium-settings', async (req, res) => {
  const [rows] = await req.db.execute('SELECT premium_payment_model, premium_fee_per_term, premium_payment_model_locked FROM schools WHERE school_id = ?', [req.params.schoolId]);
  const [setting] = await req.db.execute("SELECT setting_value FROM app_settings WHERE setting_key = 'premium_price'");
  const globalPrice = parseInt(setting[0]?.setting_value || '100');
  const locked = rows[0]?.premium_payment_model_locked === 1;
  res.json({ premium_payment_model: rows[0]?.premium_payment_model || 'parent', premium_fee_per_term: rows[0]?.premium_fee_per_term || globalPrice, global_price: globalPrice, locked, lock_reason: locked ? 'Payment model was set to school-pays and locked for this term. Contact support to change.' : null });
});

router.put('/:schoolId/premium-settings', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return;
  const { premium_payment_model, premium_fee_per_term } = req.body;
  if (premium_payment_model && !['school', 'parent'].includes(premium_payment_model)) return res.status(400).json({ error: 'Invalid payment model' });
  if (premium_payment_model) {
    const [current] = await req.db.execute('SELECT premium_payment_model, premium_payment_model_locked FROM schools WHERE school_id = ?', [req.params.schoolId]);
    if (current.length > 0 && current[0].premium_payment_model_locked === 1 && premium_payment_model !== 'school') return res.status(403).json({ error: 'LOCKED', message: 'Payment model is locked for this term. It cannot be changed until the term is over.' });
  }
  const lock = premium_payment_model === 'school' ? 1 : 0;
  await req.db.execute('UPDATE schools SET premium_payment_model = COALESCE(?, premium_payment_model), premium_fee_per_term = COALESCE(?, premium_fee_per_term), premium_payment_model_locked = GREATEST(premium_payment_model_locked, ?) WHERE school_id = ?', [premium_payment_model || null, premium_fee_per_term || null, lock, req.params.schoolId]);
  res.json({ saved: true, locked: lock === 1 });
});

router.get('/:schoolId/premium/subscriptions', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return;
  const { term, year } = req.query;
  const { getCurrentTerm } = require('../lib/config');
  const currentTerm = term || await getCurrentTerm(req.db, req.params.schoolId);
  const currentYear = year || new Date().getFullYear();
  const [rows] = await req.db.execute(`SELECT ps.*, pp.is_premium, pp.premium_expires_at, COALESCE(GROUP_CONCAT(DISTINCT CONCAT(s.full_name, ' (', s.student_id, ')') SEPARATOR ', '), '') AS children FROM premium_subscriptions ps JOIN parent_profiles pp ON ps.parent_phone = pp.parent_phone LEFT JOIN student_parent_map spm ON ps.parent_phone = spm.parent_phone LEFT JOIN students s ON spm.student_id = s.student_id AND s.school_id = ps.school_id WHERE ps.school_id = ? AND ps.term = ? AND ps.year = ? GROUP BY ps.subscription_id ORDER BY ps.created_at DESC`, [req.params.schoolId, currentTerm, currentYear]);
  res.json({ subscriptions: rows, term: currentTerm, year: currentYear });
});

router.post('/:schoolId/premium/bulk-activate', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return;
  const { class_id, term, year } = req.body;
  if (!class_id || !term || !year) return res.status(400).json({ error: 'class_id, term, year required' });
  const [parents] = await req.db.execute('SELECT DISTINCT spm.parent_phone FROM student_parent_map spm JOIN students s ON spm.student_id = s.student_id WHERE s.class_id = ? AND s.school_id = ? AND s.enrollment_status = \'Active\'', [class_id, req.params.schoolId]);
  const [school] = await req.db.execute('SELECT premium_fee_per_term FROM schools WHERE school_id = ?', [req.params.schoolId]);
  const [setting] = await req.db.execute("SELECT setting_value FROM app_settings WHERE setting_key = 'premium_price'");
  const fee = school[0]?.premium_fee_per_term || parseInt(setting[0]?.setting_value || '100');
  let activated = 0;
  const { getNextTermStart } = require('../lib/config');
  const expiresAt = await getNextTermStart(req.db, req.params.schoolId);
  for (const p of parents) {
    await req.db.execute('INSERT IGNORE INTO parent_profiles (parent_phone, is_premium) VALUES (?, FALSE)', [p.parent_phone]);
    await req.db.execute('INSERT INTO premium_subscriptions (school_id, parent_phone, term, year, payment_model, payment_status, amount, activated_at, expires_at) VALUES (?, ?, ?, ?, \'school\', \'paid\', ?, NOW(), ?) ON DUPLICATE KEY UPDATE payment_status = \'paid\', activated_at = NOW(), expires_at = VALUES(expires_at)', [req.params.schoolId, p.parent_phone, term, year, fee, expiresAt]);
    await req.db.execute('UPDATE parent_profiles SET is_premium = TRUE, premium_expires_at = ? WHERE parent_phone = ?', [expiresAt, p.parent_phone]);
    activated++;
  }
  res.json({ activated, total: parents.length });
});

// ─── Term Settings ───────────────────────────────────────────────

router.get('/:schoolId/term-settings', async (req, res) => {
  const year = req.query.year || new Date().getFullYear();
  const [rows] = await req.db.execute('SELECT id, term_name, start_date, end_date FROM school_terms WHERE school_id = ? AND academic_year = ? ORDER BY start_date', [req.params.schoolId, year]);
  res.json({ terms: rows, academic_year: parseInt(year) });
});

router.put('/:schoolId/term-settings', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return;
  const { terms, academic_year } = req.body;
  if (!terms?.length || !academic_year) return res.status(400).json({ error: 'terms array and academic_year required' });
  await req.db.execute('DELETE FROM school_terms WHERE school_id = ? AND academic_year = ?', [req.params.schoolId, academic_year]);
  for (const t of terms) {
    if (!t.term_name || !t.start_date || !t.end_date) continue;
    await req.db.execute('INSERT INTO school_terms (school_id, term_name, start_date, end_date, academic_year) VALUES (?, ?, ?, ?, ?)', [req.params.schoolId, t.term_name, t.start_date, t.end_date, academic_year]);
  }
  res.json({ saved: true, academic_year });
});

// ─── Rubric Config ───────────────────────────────────────────────

router.get('/:schoolId/rubric-config', async (req, res) => {
  const { getRubricConfig } = require('../lib/config');
  const config = await getRubricConfig(req.db, req.params.schoolId);
  res.json({ rubric: config });
});

router.put('/:schoolId/rubric-config', async (req, res) => {
  const head = await requireHead(req, res);
  if (!head) return;
  const { rubric } = req.body;
  if (!rubric?.length) return res.status(400).json({ error: 'rubric array required' });
  await req.db.execute('DELETE FROM school_rubric_config WHERE school_id = ?', [req.params.schoolId]);
  for (const r of rubric) {
    if (!r.level_code || r.min_percent === undefined) continue;
    await req.db.execute('INSERT INTO school_rubric_config (school_id, level_code, min_percent, label, color) VALUES (?, ?, ?, ?, ?)', [req.params.schoolId, r.level_code, r.min_percent, r.label || r.level_code, r.color || '#333333']);
  }
  res.json({ saved: true });
});

module.exports = router;
