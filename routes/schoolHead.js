const express = require('express');
const crypto = require('crypto');
const router = express.Router();

router.get('/:schoolId/teachers', async (req, res) => {
  const [rows] = await req.db.execute(
    'SELECT teacher_id, full_name, phone, role FROM teachers WHERE school_id = ? ORDER BY full_name',
    [req.params.schoolId]
  );
  res.json({ teachers: rows });
});

router.post('/:schoolId/teachers', async (req, res) => {
  const { full_name, phone } = req.body;
  if (!full_name || !phone) return res.status(400).json({ error: 'Name and phone required' });

  const teacherId = 'TCH' + Date.now().toString(36).toUpperCase();

  const [existing] = await req.db.execute('SELECT teacher_id FROM teachers WHERE phone = ?', [phone]);
  if (existing.length > 0) return res.status(409).json({ error: 'Phone already registered' });

  await req.db.execute(
    'INSERT INTO teachers (teacher_id, full_name, phone, school_id, role) VALUES (?, ?, ?, ?, ?)',
    [teacherId, full_name, phone, req.params.schoolId, 'teacher']
  );

  res.json({ teacher_id: teacherId, full_name, phone, role: 'teacher' });
});

router.delete('/:schoolId/teachers/:teacherId', async (req, res) => {
  const [t] = await req.db.execute(
    'SELECT role FROM teachers WHERE teacher_id = ? AND school_id = ?',
    [req.params.teacherId, req.params.schoolId]
  );
  if (t.length === 0) return res.status(404).json({ error: 'Teacher not found' });
  if (t[0].role === 'head') return res.status(403).json({ error: 'Cannot remove school head' });

  await req.db.execute('DELETE FROM teachers WHERE teacher_id = ?', [req.params.teacherId]);
  res.json({ deleted: true });
});

// CSV Import Students — school head can bulk-import into a class
router.post('/:schoolId/students/import', async (req, res) => {
  const { class_id, csv } = req.body;
  if (!class_id || !csv) return res.status(400).json({ error: 'class_id and csv required' });
  const lines = csv.trim().split('\n');
  let imported = 0, errors = 0;
  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length < 2) { errors++; continue; }
    const student_id = parts[0].trim();
    const full_name = parts.slice(1).join(',').trim();
    if (!student_id || !full_name) { errors++; continue; }
    try {
      await req.db.execute('INSERT INTO students (student_id, full_name, class_id, school_id) VALUES (?, ?, ?, ?)',
        [student_id, full_name, class_id, req.params.schoolId]);
      imported++;
    } catch { errors++; }
  }
  res.json({ imported, errors });
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

module.exports = router;
