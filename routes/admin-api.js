const express = require('express');
const router = express.Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

function requireAuth(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (key !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

router.use(requireAuth);

// SCHOOLS
router.get('/schools', async (req, res) => {
  const limit = parseInt(req.query.limit) || 0;
  let sql = 'SELECT school_id, school_name, region, created_at FROM schools ORDER BY school_name';
  if (limit > 0) sql += ' LIMIT ' + limit;
  const [rows] = await req.db.execute(sql);
  res.json({ schools: rows });
});

router.post('/schools', async (req, res) => {
  const { school_id, school_name, region } = req.body;
  if (!school_id || !school_name) return res.status(400).json({ error: 'school_id and school_name required' });
  await req.db.execute('INSERT INTO schools (school_id, school_name, region) VALUES (?, ?, ?)', [school_id, school_name, region || null]);
  res.json({ school_id, school_name });
});

router.delete('/schools/:id', async (req, res) => {
  await req.db.execute('DELETE FROM attendance_logs WHERE student_id IN (SELECT student_id FROM students WHERE school_id = ?)', [req.params.id]);
  await req.db.execute('DELETE FROM assessment_results WHERE assessment_id IN (SELECT assessment_id FROM assessments WHERE class_id IN (SELECT class_id FROM classes WHERE school_id = ?))', [req.params.id]);
  await req.db.execute('DELETE FROM assessments WHERE class_id IN (SELECT class_id FROM classes WHERE school_id = ?)', [req.params.id]);
  await req.db.execute('DELETE FROM sub_strands WHERE strand_id IN (SELECT strand_id FROM strands WHERE area_id IN (SELECT area_id FROM learning_areas WHERE school_id = ?))', [req.params.id]);
  await req.db.execute('DELETE FROM strands WHERE area_id IN (SELECT area_id FROM learning_areas WHERE school_id = ?)', [req.params.id]);
  await req.db.execute('DELETE FROM learning_areas WHERE school_id = ?', [req.params.id]);
  await req.db.execute('DELETE FROM fee_assignments WHERE fee_id IN (SELECT fee_id FROM fee_structures WHERE school_id = ?)', [req.params.id]);
  await req.db.execute('DELETE FROM fee_structures WHERE school_id = ?', [req.params.id]);
  await req.db.execute('DELETE FROM marketplace_campaigns WHERE target_school_id = ?', [req.params.id]);
  await req.db.execute('DELETE FROM student_parent_map WHERE student_id IN (SELECT student_id FROM students WHERE school_id = ?)', [req.params.id]);
  await req.db.execute('DELETE FROM students WHERE school_id = ?', [req.params.id]);
  await req.db.execute('DELETE FROM teachers WHERE school_id = ?', [req.params.id]);
  await req.db.execute('DELETE FROM classes WHERE school_id = ?', [req.params.id]);
  await req.db.execute('DELETE FROM schools WHERE school_id = ?', [req.params.id]);
  res.json({ deleted: true });
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
  const { school_id, class_name, academic_year } = req.body;
  if (!school_id || !class_name || !academic_year) return res.status(400).json({ error: 'school_id, class_name, academic_year required' });
  const [r] = await req.db.execute('INSERT INTO classes (school_id, class_name, academic_year) VALUES (?, ?, ?)', [school_id, class_name, academic_year]);
  res.json({ class_id: r.insertId, class_name });
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
  const { student_id, full_name, class_id, school_id } = req.body;
  if (!student_id || !full_name || !class_id || !school_id) return res.status(400).json({ error: 'student_id, full_name, class_id, school_id required' });
  await req.db.execute('INSERT INTO students (student_id, full_name, class_id, school_id) VALUES (?, ?, ?, ?)', [student_id, full_name, class_id, school_id]);
  res.json({ student_id, full_name });
});

router.delete('/students/:id', async (req, res) => {
  await req.db.execute('DELETE FROM attendance_logs WHERE student_id = ?', [req.params.id]);
  await req.db.execute('DELETE FROM assessment_results WHERE student_id = ?', [req.params.id]);
  await req.db.execute('DELETE FROM student_parent_map WHERE student_id = ?', [req.params.id]);
  await req.db.execute('DELETE FROM students WHERE student_id = ?', [req.params.id]);
  res.json({ deleted: true });
});

router.post('/students/import', async (req, res) => {
  const { school_id, class_id, csv } = req.body;
  if (!school_id || !class_id || !csv) return res.status(400).json({ error: 'school_id, class_id, csv required' });
  const lines = csv.trim().split('\n');
  let imported = 0, errors = 0;
  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length < 2) { errors++; continue; }
    const student_id = parts[0].trim();
    const full_name = parts.slice(1).join(',').trim();
    if (!student_id || !full_name) { errors++; continue; }
    try {
      await req.db.execute('INSERT INTO students (student_id, full_name, class_id, school_id) VALUES (?, ?, ?, ?)', [student_id, full_name, class_id, school_id]);
      imported++;
    } catch { errors++; }
  }
  res.json({ imported, errors });
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
  const { school_id, full_name, phone, role } = req.body;
  if (!school_id || !full_name || !phone) return res.status(400).json({ error: 'school_id, full_name, phone required' });
  const [existing] = await req.db.execute('SELECT teacher_id FROM teachers WHERE phone = ?', [phone]);
  if (existing.length > 0) return res.status(409).json({ error: 'Phone already registered' });
  const teacherId = 'TCH' + Date.now().toString(36).toUpperCase();
  await req.db.execute('INSERT INTO teachers (teacher_id, full_name, phone, school_id, role) VALUES (?, ?, ?, ?, ?)', [teacherId, full_name, phone, school_id, role || 'teacher']);
  res.json({ teacher_id: teacherId, full_name });
});

router.delete('/teachers/:id', async (req, res) => {
  await req.db.execute('DELETE FROM sync_log WHERE teacher_id = ?', [req.params.id]);
  await req.db.execute('DELETE FROM attendance_logs WHERE teacher_id = ?', [req.params.id]);
  await req.db.execute('DELETE FROM teachers WHERE teacher_id = ?', [req.params.id]);
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

// Stats (for dashboard)
router.get('/_stats', async (req, res) => {
  async function cnt(table) { try { const [[r]] = await req.db.execute(`SELECT COUNT(*) AS c FROM \`${table}\``); return r.c; } catch { return '—'; } }
  res.json({
    schools: await cnt('schools'),
    teachers: await cnt('teachers'),
    students: await cnt('students'),
    parents: await cnt('parent_profiles'),
    attendance: await cnt('attendance_logs'),
    payments: await cnt('payment_ledger'),
    assessments: await cnt('assessments'),
    campaigns: await cnt('marketplace_campaigns')
  });
});

module.exports = router;
