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
router.post('/:id/contact', async (req, res, next) => {
  try {
    const schoolId = req.params.id;
    const auth = (req.headers.authorization || '').trim();
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
    const sessionId = auth.slice(7).trim();
    const [sessions] = await req.db.execute(
      'SELECT teacher_id, school_id, verified, expires_at FROM otp_sessions WHERE session_id = ? LIMIT 1',
      [sessionId]
    );
    const session = sessions[0];
    if (!session || !session.verified || !session.expires_at || new Date(session.expires_at) <= new Date()) {
      return res.status(401).json({ error: 'Session expired or not verified' });
    }
    if (!session.teacher_id || session.school_id !== schoolId) {
      return res.status(403).json({ error: 'This session cannot manage another school' });
    }

    const [teachers] = await req.db.execute(
      'SELECT teacher_id, role, school_id, active FROM teachers WHERE teacher_id = ? AND school_id = ? LIMIT 1',
      [session.teacher_id, schoolId]
    );
    const teacher = teachers[0];
    if (!teacher || teacher.active === 0) return res.status(403).json({ error: 'Active school staff membership required' });
    if (!['head', 'school_admin'].includes(teacher.role)) {
      return res.status(403).json({ error: 'Only the headteacher or school administrator can set school contact details' });
    }

    const { contact_name, contact_phone, contact_email, contact_address, contact_website } = req.body;
    if (!contact_name && !contact_phone && !contact_email && !contact_address && !contact_website) {
      return res.status(400).json({ error: 'At least one contact field required' });
    }

    await req.db.execute(
      `UPDATE schools
       SET contact_name = ?, contact_phone = ?, contact_email = ?, contact_address = ?, contact_website = ?
       WHERE school_id = ?`,
      [contact_name || null, contact_phone || null, contact_email || null, contact_address || null, contact_website || null, schoolId]
    );

    res.json({ saved: true, school_id: schoolId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
