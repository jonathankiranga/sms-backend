const express = require('express');
const router = express.Router();

// GET /api/lesson-plans — list with optional filters
router.get('/', async (req, res) => {
  const { teacher_id, school_id, class_id, term } = req.query;
  let sql = 'SELECT lp.*, la.area_name, s.strand_name, ss.sub_strand_name, c.class_name, t.full_name AS teacher_name FROM lesson_plans lp JOIN learning_areas la ON lp.area_id = la.area_id LEFT JOIN strands s ON lp.strand_id = s.strand_id LEFT JOIN sub_strands ss ON lp.sub_strand_id = ss.sub_strand_id JOIN classes c ON lp.class_id = c.class_id JOIN teachers t ON lp.teacher_id = t.teacher_id WHERE 1=1';
  const params = [];
  if (teacher_id) { sql += ' AND lp.teacher_id = ?'; params.push(teacher_id); }
  if (school_id) { sql += ' AND lp.school_id = ?'; params.push(school_id); }
  if (class_id) { sql += ' AND lp.class_id = ?'; params.push(class_id); }
  if (term) { sql += ' AND lp.term = ?'; params.push(term); }
  sql += ' ORDER BY lp.week_number, lp.lesson_date';
  const [rows] = await req.db.execute(sql, params);
  res.json({ lesson_plans: rows });
});

// GET /api/lesson-plans/:id
router.get('/:id', async (req, res) => {
  const [rows] = await req.db.execute(
    `SELECT lp.*, la.area_name, s.strand_name, ss.sub_strand_name, c.class_name, t.full_name AS teacher_name
     FROM lesson_plans lp
     JOIN learning_areas la ON lp.area_id = la.area_id
     LEFT JOIN strands s ON lp.strand_id = s.strand_id
     LEFT JOIN sub_strands ss ON lp.sub_strand_id = ss.sub_strand_id
     JOIN classes c ON lp.class_id = c.class_id
     JOIN teachers t ON lp.teacher_id = t.teacher_id
     WHERE lp.plan_id = ?`,
    [req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Lesson plan not found' });
  res.json({ lesson_plan: rows[0] });
});

// POST /api/lesson-plans
router.post('/', async (req, res) => {
  const { teacher_id, school_id, class_id, area_id, strand_id, sub_strand_id, week_number, term, lesson_date, duration_minutes, learning_objectives, resources, introduction_activities, main_activities, assessment_method, remarks } = req.body;
  if (!teacher_id || !school_id || !class_id || !area_id) {
    return res.status(400).json({ error: 'teacher_id, school_id, class_id, area_id required' });
  }
  const [r] = await req.db.execute(
    `INSERT INTO lesson_plans (teacher_id, school_id, class_id, area_id, strand_id, sub_strand_id, week_number, term, lesson_date, duration_minutes, learning_objectives, resources, introduction_activities, main_activities, assessment_method, remarks)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [teacher_id, school_id, class_id, area_id, strand_id || null, sub_strand_id || null, week_number || 1, term || 'Term 1', lesson_date || null, duration_minutes || 40, learning_objectives || null, resources || null, introduction_activities || null, main_activities || null, assessment_method || null, remarks || null]
  );
  res.json({ plan_id: r.insertId });
});

// PUT /api/lesson-plans/:id
router.put('/:id', async (req, res) => {
  const { area_id, strand_id, sub_strand_id, week_number, term, lesson_date, duration_minutes, learning_objectives, resources, introduction_activities, main_activities, assessment_method, remarks } = req.body;
  await req.db.execute(
    `UPDATE lesson_plans SET area_id = ?, strand_id = ?, sub_strand_id = ?, week_number = ?, term = ?, lesson_date = ?, duration_minutes = ?, learning_objectives = ?, resources = ?, introduction_activities = ?, main_activities = ?, assessment_method = ?, remarks = ? WHERE plan_id = ?`,
    [area_id, strand_id || null, sub_strand_id || null, week_number || 1, term || 'Term 1', lesson_date || null, duration_minutes || 40, learning_objectives || null, resources || null, introduction_activities || null, main_activities || null, assessment_method || null, remarks || null, req.params.id]
  );
  res.json({ updated: true });
});

// DELETE /api/lesson-plans/:id
router.delete('/:id', async (req, res) => {
  await req.db.execute('DELETE FROM lesson_plans WHERE plan_id = ?', [req.params.id]);
  res.json({ deleted: true });
});

module.exports = router;
