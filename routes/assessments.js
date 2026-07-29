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

    // Notify premium parents of assessment results
    try {
      const [assessInfo] = await req.db.execute(
        `SELECT a.assessment_name, a.max_score, la.area_name
         FROM assessments a
         JOIN sub_strands ss ON a.sub_strand_id = ss.sub_strand_id
         JOIN strands s ON ss.strand_id = s.strand_id
         JOIN learning_areas la ON s.area_id = la.area_id
         WHERE a.assessment_id = ?`, [assessment_id]
      );
      if (assessInfo.length > 0) {
        const { sendAssessmentAlert } = require('../services/messaging');
        for (const r of results) {
          const [studentInfo] = await req.db.execute('SELECT full_name FROM students WHERE student_id = ?', [r.student_id]);
          const studentName = studentInfo[0]?.full_name || 'Student';
          const [parents] = await req.db.execute(
            `SELECT p.parent_phone FROM student_parent_map m
             JOIN parent_profiles p ON m.parent_phone = p.parent_phone
             WHERE m.student_id = ? AND p.is_premium = TRUE AND (p.premium_expires_at IS NULL OR p.premium_expires_at >= NOW())`,
            [r.student_id]
          );
          for (const parent of parents) {
            const pct = r.score / (r.max_score || assessInfo[0].max_score || 100);
            let level = 'BE';
            if (pct >= 0.8) level = 'EE';
            else if (pct >= 0.6) level = 'ME';
            else if (pct >= 0.4) level = 'AE';
            sendAssessmentAlert(parent.parent_phone, studentName, assessInfo[0].area_name, r.score.toString(), level).catch(e => console.error('[WA] Assessment alert failed:', e.message));
          }
        }
      }
    } catch (e) {
      console.error('[NOTIFY] Assessment results alert error:', e.message);
    }

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
  const { year } = req.query;
  const reportYear = parseInt(year) || new Date().getFullYear();

  const [student] = await req.db.execute(
    `SELECT s.student_id, s.full_name, c.class_name, s.school_id
     FROM students s JOIN classes c ON s.class_id = c.class_id WHERE s.student_id = ?`,
    [student_id]
  );
  if (student.length === 0) return res.status(404).json({ error: 'Student not found' });

  // Strand-based assessment results (formative)
  const [strandAreas] = await req.db.execute(
    `SELECT la.area_id, la.area_name,
            ROUND(AVG(r.score/a.max_score)*100, 1) AS avg_pct,
            GROUP_CONCAT(DISTINCT CONCAT(s.strand_name, ':', r.performance_level) SEPARATOR ', ') AS strand_summary
     FROM learning_areas la
     JOIN strands s ON la.area_id = s.area_id AND s.term = ?
     JOIN sub_strands ss ON s.strand_id = ss.strand_id
     JOIN assessments a ON ss.sub_strand_id = a.sub_strand_id
     JOIN assessment_results r ON a.assessment_id = r.assessment_id AND r.student_id = ?
     WHERE YEAR(a.date) = ?
     GROUP BY la.area_id, la.area_name
     ORDER BY la.area_name`,
    [term, student_id, reportYear]
  );

  // Exam session results (CAT / End Term)
  const [examAreas] = await req.db.execute(
    `SELECT la.area_id, la.area_name,
            ROUND(AVG(er.score / er.out_of) * 100, 1) AS avg_pct,
            GROUP_CONCAT(DISTINCT CONCAT(es.exam_type, ':', er.performance_level) SEPARATOR ', ') AS strand_summary
     FROM exam_results er
     JOIN exam_sessions es ON er.session_id = es.session_id
     JOIN sub_learning_areas sla ON er.sub_area_id = sla.sub_area_id
     JOIN learning_areas la ON sla.area_id = la.area_id
     WHERE er.student_id = ? AND es.term = ? AND es.academic_year = ?
     GROUP BY la.area_id, la.area_name
     ORDER BY la.area_name`,
    [student_id, term, reportYear]
  );

  // Merge both sources — exam results take priority if both exist for same area
  const areaMap = new Map();
  for (const a of strandAreas) {
    areaMap.set(a.area_id, { ...a, source: 'assessment' });
  }
  for (const a of examAreas) {
    if (areaMap.has(a.area_id)) {
      // average both sources
      const existing = areaMap.get(a.area_id);
      areaMap.set(a.area_id, {
        ...existing,
        avg_pct: Math.round(((parseFloat(existing.avg_pct) || 0) + (parseFloat(a.avg_pct) || 0)) / 2 * 10) / 10,
        strand_summary: [existing.strand_summary, a.strand_summary].filter(Boolean).join(', '),
        source: 'both'
      });
    } else {
      areaMap.set(a.area_id, { ...a, source: 'exam' });
    }
  }
  const areas = Array.from(areaMap.values()).sort((a, b) => a.area_name.localeCompare(b.area_name));

  const [attendance] = await req.db.execute(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) AS present
     FROM attendance_logs WHERE student_id = ?`,
    [student_id]
  );

  const [reportSettings] = await req.db.execute(
    `SELECT template_name, show_teacher_name, show_teacher_signature, show_final_remarks, show_recommendation,
            teacher_name, teacher_signature, final_remarks, recommendation_text, layout_json
     FROM school_report_settings WHERE school_id = ?`,
    [student[0].school_id]
  );

  const settings = reportSettings[0] || {
    template_name: 'Default Report',
    show_teacher_name: true,
    show_teacher_signature: true,
    show_final_remarks: true,
    show_recommendation: true,
    teacher_name: null,
    teacher_signature: null,
    final_remarks: null,
    recommendation_text: null,
    layout_json: null
  };

  const [schoolInfo] = await req.db.execute(
    'SELECT school_id, school_name, contact_name, contact_phone, contact_email, contact_address, contact_website FROM schools WHERE school_id = ?',
    [student[0].school_id]
  );

  res.json({
    student: student[0],
    term,
    year: reportYear,
    areas,
    attendance: attendance[0],
    report_settings: settings,
    school_contact: schoolInfo[0] || null
  });
});

// POST /api/assessments/areas — create a learning area (headteacher only)
router.post('/areas', async (req, res) => {
  const { school_id, level_name, area_name, teacher_id } = req.body;
  if (!school_id || !area_name || !teacher_id) return res.status(400).json({ error: 'school_id, area_name and teacher_id required' });

  // Verify teacher is head of the school
  const [t] = await req.db.execute('SELECT teacher_id, role, school_id FROM teachers WHERE teacher_id = ?', [teacher_id]);
  if (t.length === 0) return res.status(404).json({ error: 'Teacher not found' });
  if (t[0].role !== 'head' || t[0].school_id !== school_id) return res.status(403).json({ error: 'Only the school head may create learning areas for this school' });

  const [r] = await req.db.execute('INSERT INTO learning_areas (school_id, level_name, area_name) VALUES (?, ?, ?)', [school_id, level_name || null, area_name]);
  res.json({ area_id: r.insertId, school_id, area_name });
});

// POST /api/assessments/strands — create a strand under a learning area (headteacher only)
router.post('/strands', async (req, res) => {
  const { area_id, strand_name, term, teacher_id } = req.body;
  if (!area_id || !strand_name || !teacher_id) return res.status(400).json({ error: 'area_id, strand_name and teacher_id required' });

  // Verify area exists and belongs to a school
  const [areas] = await req.db.execute('SELECT area_id, school_id FROM learning_areas WHERE area_id = ?', [area_id]);
  if (areas.length === 0) return res.status(404).json({ error: 'Learning area not found' });
  const school_id = areas[0].school_id;

  // Verify teacher is head of the school
  const [t] = await req.db.execute('SELECT teacher_id, role, school_id FROM teachers WHERE teacher_id = ?', [teacher_id]);
  if (t.length === 0) return res.status(404).json({ error: 'Teacher not found' });
  if (t[0].role !== 'head' || t[0].school_id !== school_id) return res.status(403).json({ error: 'Only the school head may create strands for this school' });

  // Validate term
  const allowedTerms = ['Term 1', 'Term 2', 'Term 3'];
  const termVal = term && allowedTerms.includes(term) ? term : null;

  const [r] = await req.db.execute('INSERT INTO strands (area_id, strand_name, term) VALUES (?, ?, ?)', [area_id, strand_name, termVal]);
  res.json({ strand_id: r.insertId, area_id, strand_name, term: termVal });
});

// POST /api/assessments/sub-strands — create a sub-strand under a strand (headteacher only)
router.post('/sub-strands', async (req, res) => {
  const { strand_id, sub_strand_name, teacher_id } = req.body;
  if (!strand_id || !sub_strand_name || !teacher_id) return res.status(400).json({ error: 'strand_id, sub_strand_name and teacher_id required' });

  // Verify strand exists and determine its school via area
  const [srows] = await req.db.execute(
    'SELECT s.strand_id, s.area_id, la.school_id FROM strands s JOIN learning_areas la ON s.area_id = la.area_id WHERE s.strand_id = ?',
    [strand_id]
  );
  if (srows.length === 0) return res.status(404).json({ error: 'Strand not found' });
  const school_id = srows[0].school_id;

  // Verify teacher is head of the school
  const [t] = await req.db.execute('SELECT teacher_id, role, school_id FROM teachers WHERE teacher_id = ?', [teacher_id]);
  if (t.length === 0) return res.status(404).json({ error: 'Teacher not found' });
  if (t[0].role !== 'head' || t[0].school_id !== school_id) return res.status(403).json({ error: 'Only the school head may create sub-strands for this school' });

  const [r] = await req.db.execute('INSERT INTO sub_strands (strand_id, sub_strand_name) VALUES (?, ?)', [strand_id, sub_strand_name]);
  res.json({ sub_strand_id: r.insertId, strand_id, sub_strand_name });
});

module.exports = router;
