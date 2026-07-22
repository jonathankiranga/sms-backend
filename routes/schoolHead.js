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

module.exports = router;
