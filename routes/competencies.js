const express = require('express');
const router = express.Router();

// GET /api/competencies — list all competencies and values
router.get('/', async (req, res) => {
  const [competencies] = await req.db.execute(
    'SELECT * FROM core_competencies ORDER BY category, competency_id'
  );
  const result = { competencies: [], values: [] };
  competencies.forEach(c => {
    if (c.category === 'competency') result.competencies.push(c);
    else result.values.push(c);
  });
  res.json(result);
});

// GET /api/competencies/ratings/:student_id/:term — get ratings for a student
router.get('/ratings/:student_id/:term', async (req, res) => {
  const [ratings] = await req.db.execute(
    `SELECT sr.*, cc.competency_name, cc.category
     FROM student_competency_ratings sr
     JOIN core_competencies cc ON sr.competency_id = cc.competency_id
     WHERE sr.student_id = ? AND sr.term = ?
     ORDER BY cc.category, cc.competency_id`,
    [req.params.student_id, req.params.term]
  );
  res.json({ ratings });
});

// GET /api/competencies/class-ratings/:class_id/:term — get all ratings for a class
router.get('/class-ratings/:class_id/:term', async (req, res) => {
  const [ratings] = await req.db.execute(
    `SELECT sr.*, cc.competency_name, cc.category, s.full_name, s.student_id
     FROM student_competency_ratings sr
     JOIN core_competencies cc ON sr.competency_id = cc.competency_id
     JOIN students s ON sr.student_id = s.student_id
     WHERE s.class_id = ? AND sr.term = ?
     ORDER BY s.full_name, cc.category, cc.competency_id`,
    [req.params.class_id, req.params.term]
  );
  res.json({ ratings });
});

// POST /api/competencies/ratings — batch save ratings
router.post('/ratings', async (req, res) => {
  const { ratings } = req.body; // array of { student_id, term, competency_id, rating, teacher_id }
  if (!ratings || !Array.isArray(ratings) || ratings.length === 0) {
    return res.status(400).json({ error: 'ratings array required' });
  }
  const conn = await req.db.getConnection();
  try {
    await conn.beginTransaction();
    for (const r of ratings) {
      if (!r.student_id || !r.term || !r.competency_id || !r.rating) {
        throw new Error('Missing required fields: student_id, term, competency_id, rating');
      }
      await conn.execute(
        `INSERT INTO student_competency_ratings (student_id, term, competency_id, rating, teacher_id)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE rating = VALUES(rating), teacher_id = VALUES(teacher_id)`,
        [r.student_id, r.term, r.competency_id, r.rating, r.teacher_id || null]
      );
    }
    await conn.commit();
    res.json({ saved: ratings.length });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
