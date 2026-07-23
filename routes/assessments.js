const express = require('express');
const router = express.Router();

// GET /api/assessments/areas?school_id=X&level=Grade 4
router.get('/areas', async (req, res) => {
  const { school_id, level } = req.query;
  if (!school_id) return res.status(400).json({ error: 'school_id required' });
  const [rows] = await req.db.execute(
    'SELECT area_id, area_name, level_name FROM learning_areas WHERE school_id = ? AND (level_name = ? OR ? IS NULL) ORDER BY area_name',
    [school_id, level || '', level || null]
  );
  res.json({ areas: rows });
});

// GET /api/assessments/strands?area_id=X&term=Term 1
router.get('/strands', async (req, res) => {
  const { area_id, term } = req.query;
  if (!area_id) return res.status(400).json({ error: 'area_id required' });
  const [rows] = await req.db.execute(
    'SELECT strand_id, strand_name, term FROM strands WHERE area_id = ? AND (term = ? OR ? IS NULL) ORDER BY strand_name',
    [area_id, term || '', term || null]
  );
  res.json({ strands: rows });
});

// GET /api/assessments/sub-strands?strand_id=X
router.get('/sub-strands', async (req, res) => {
  const { strand_id } = req.query;
  if (!strand_id) return res.status(400).json({ error: 'strand_id required' });
  const [rows] = await req.db.execute(
    'SELECT sub_strand_id, sub_strand_name FROM sub_strands WHERE strand_id = ? ORDER BY sub_strand_name',
    [strand_id]
  );
  res.json({ sub_strands: rows });
});

// POST /api/assessments — create assessment (and optionally strand/sub_strand)
router.post('/', async (req, res) => {
  const { sub_strand_id, assessment_name, max_score, date, type, class_id, teacher_id } = req.body;
  if (!sub_strand_id || !assessment_name || !class_id || !teacher_id) {
    return res.status(400).json({ error: 'sub_strand_id, assessment_name, class_id, teacher_id required' });
  }
  const [r] = await req.db.execute(
    'INSERT INTO assessments (sub_strand_id, assessment_name, max_score, date, type, class_id, teacher_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [sub_strand_id, assessment_name, max_score || 100, date || null, type || 'Formative', class_id, teacher_id]
  );
  res.json({ assessment_id: r.insertId, assessment_name });
});

// GET /api/assessments?class_id=X&term=Term 1
router.get('/', async (req, res) => {
  const { class_id, term } = req.query;
  if (!class_id) return res.status(400).json({ error: 'class_id required' });
  let sql = `SELECT a.assessment_id, a.assessment_name, a.max_score, a.date, a.type,
                    ss.sub_strand_name, s.strand_name, la.area_name
             FROM assessments a
             JOIN sub_strands ss ON a.sub_strand_id = ss.sub_strand_id
             JOIN strands s ON ss.strand_id = s.strand_id
             JOIN learning_areas la ON s.area_id = la.area_id
             WHERE a.class_id = ?`;
  const params = [class_id];
  if (term) { sql += ' AND s.term = ?'; params.push(term); }
  sql += ' ORDER BY a.date DESC, a.assessment_name';
  const [rows] = await req.db.execute(sql, params);
  res.json({ assessments: rows });
});

// POST /api/assessments/results — batch save scores
router.post('/results', async (req, res) => {
  const { assessment_id, results } = req.body;
  if (!assessment_id || !results?.length) return res.status(400).json({ error: 'assessment_id and results required' });

  const conn = await req.db.getConnection();
  try {
    await conn.beginTransaction();
    for (const r of results) {
      const pct = r.score / (r.max_score || 100);
      let level = 'BE';
      if (pct >= 0.8) level = 'EE';
      else if (pct >= 0.6) level = 'ME';
      else if (pct >= 0.4) level = 'AE';
      await conn.execute(
        `INSERT INTO assessment_results (assessment_id, student_id, score, performance_level)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE score = VALUES(score), performance_level = VALUES(performance_level)`,
        [assessment_id, r.student_id, r.score, level]
      );
    }
    await conn.commit();
    res.json({ saved: results.length });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// GET /api/assessments/results/:assessment_id
router.get('/results/:assessment_id', async (req, res) => {
  const [rows] = await req.db.execute(
    `SELECT r.result_id, r.student_id, s.full_name, r.score, r.performance_level
     FROM assessment_results r
     JOIN students s ON r.student_id = s.student_id
     WHERE r.assessment_id = ?
     ORDER BY s.full_name`,
    [req.params.assessment_id]
  );
  res.json({ results: rows });
});

// GET /api/assessments/report/:student_id/:term
router.get('/report/:student_id/:term', async (req, res) => {
  const { student_id, term } = req.params;
  const [student] = await req.db.execute(
    `SELECT s.student_id, s.full_name, c.class_name, s.school_id
     FROM students s JOIN classes c ON s.class_id = c.class_id WHERE s.student_id = ?`,
    [student_id]
  );
  if (student.length === 0) return res.status(404).json({ error: 'Student not found' });

  const [areas] = await req.db.execute(
    `SELECT la.area_id, la.area_name,
            ROUND(AVG(r.score/a.max_score)*100, 1) AS avg_pct,
            GROUP_CONCAT(DISTINCT CONCAT(s.strand_name, ':', r.performance_level) SEPARATOR ', ') AS strand_summary
     FROM learning_areas la
     JOIN strands s ON la.area_id = s.area_id AND s.term = ?
     JOIN sub_strands ss ON s.strand_id = ss.strand_id
     JOIN assessments a ON ss.sub_strand_id = a.sub_strand_id
     JOIN assessment_results r ON a.assessment_id = r.assessment_id AND r.student_id = ?
     GROUP BY la.area_id, la.area_name
     ORDER BY la.area_name`,
    [term, student_id]
  );

  const [attendance] = await req.db.execute(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) AS present
     FROM attendance_logs WHERE student_id = ?`,
    [student_id]
  );

  res.json({
    student: student[0],
    term,
    areas,
    attendance: attendance[0]
  });
});

module.exports = router;
