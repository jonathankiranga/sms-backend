const express = require('express');
const router = express.Router();

// GET /api/schools/search?q=searchterm
router.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json({ schools: [] });
  const [rows] = await req.db.execute(
    `SELECT school_id, school_name, region FROM schools WHERE school_name LIKE ? ORDER BY school_name LIMIT 10`,
    [`%${q}%`]
  );
  res.json({ schools: rows });
});

// POST /api/schools/:id/contact
// Allows only the headteacher of the school to set contact details.
router.post('/:id/contact', async (req, res) => {
  const schoolId = req.params.id;
  const { teacher_id, contact_name, contact_phone, contact_email, contact_address, contact_website } = req.body;
  if (!teacher_id) return res.status(400).json({ error: 'teacher_id required' });

  // Verify teacher exists, is head, and belongs to this school
  const [t] = await req.db.execute('SELECT teacher_id, full_name, role, school_id FROM teachers WHERE teacher_id = ?', [teacher_id]);
  if (t.length === 0) return res.status(404).json({ error: 'Teacher not found' });
  const teacher = t[0];
  if (teacher.role !== 'head') return res.status(403).json({ error: 'Only headteacher can set contact details' });
  if (teacher.school_id !== schoolId) return res.status(403).json({ error: 'Teacher does not belong to this school' });

  if (!contact_name && !contact_phone && !contact_email && !contact_address && !contact_website) {
    return res.status(400).json({ error: 'At least one contact field required' });
  }

  await req.db.execute(
    `UPDATE schools SET contact_name = ?, contact_phone = ?, contact_email = ?, contact_address = ?, contact_website = ? WHERE school_id = ?`,
    [contact_name || null, contact_phone || null, contact_email || null, contact_address || null, contact_website || null, schoolId]
  );

  res.json({ saved: true, school_id: schoolId });
});

module.exports = router;
