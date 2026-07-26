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

  // Fetch school contact details to include on the report (contact form displayed on academic reports and fee statements)
  const [schoolInfo] = await req.db.execute('SELECT school_id, school_name, contact_name, contact_phone, contact_email, contact_address, contact_website FROM schools WHERE school_id = ?', [student[0].school_id]);

  res.json({
    student: student[0],
    term,
    areas,
    attendance: attendance[0],
    report_settings: settings,
    school_contact: schoolInfo[0] || null
  });
});

// GET /api/assessments/class-report/:class_id/:term
router.get('/class-report/:class_id/:term', async (req, res) => {
  const { class_id, term } = req.params;

  const [classInfo] = await req.db.execute('SELECT class_id, class_name, school_id FROM classes WHERE class_id = ?', [class_id]);
  if (classInfo.length === 0) return res.status(404).json({ error: 'Class not found' });

  // Get all students in the class
  const [students] = await req.db.execute(
    'SELECT student_id, full_name FROM students WHERE class_id = ? ORDER BY full_name',
    [class_id]
  );

  // Get per-student per-area averages
  const [rows] = await req.db.execute(
    `SELECT r.student_id, st.full_name,
            la.area_id, la.area_name,
            ROUND(AVG(r.score/a.max_score)*100, 1) AS avg_pct
     FROM students st
     JOIN learning_areas la ON st.school_id = la.school_id
     JOIN strands s ON la.area_id = s.area_id AND s.term = ?
     JOIN sub_strands ss ON s.strand_id = ss.strand_id
     JOIN assessments a ON ss.sub_strand_id = a.sub_strand_id
     JOIN assessment_results r ON a.assessment_id = r.assessment_id AND r.student_id = st.student_id
     WHERE st.class_id = ?
     GROUP BY r.student_id, st.full_name, la.area_id, la.area_name
     ORDER BY st.full_name, la.area_name`,
    [term, class_id]
  );

  // Get all learning areas for this school
  const [areaList] = await req.db.execute(
    'SELECT DISTINCT area_id, area_name FROM learning_areas WHERE school_id = ? ORDER BY area_name',
    [classInfo[0].school_id]
  );

  // Build per-student result
  const studentMap = {};
  for (const r of rows) {
    if (!studentMap[r.student_id]) {
      studentMap[r.student_id] = {
        student_id: r.student_id,
        full_name: r.full_name,
        areas: {},
        scores: []
      };
    }
    studentMap[r.student_id].areas[r.area_id] = { area_name: r.area_name, avg_pct: r.avg_pct };
    studentMap[r.student_id].scores.push(r.avg_pct);
  }

  const studentResults = students.map(s => {
    const data = studentMap[s.student_id] || { areas: {}, scores: [] };
    const areaResults = areaList.map(a => ({
      area_id: a.area_id,
      area_name: a.area_name,
      avg_pct: data.areas[a.area_id]?.avg_pct || null
    }));
    const validScores = data.scores.filter(sc => sc !== null);
    const overallAvg = validScores.length > 0
      ? Math.round(validScores.reduce((sum, sc) => sum + sc, 0) / validScores.length * 10) / 10
      : null;
    let level = 'N/A';
    if (overallAvg !== null) {
      if (overallAvg >= 80) level = 'EE';
      else if (overallAvg >= 60) level = 'ME';
      else if (overallAvg >= 40) level = 'AE';
      else level = 'BE';
    }
    return {
      student_id: s.student_id,
      full_name: s.full_name,
      areas: areaResults,
      overall_avg: overallAvg,
      level
    };
  });

  // Sort by overall average descending and assign rank
  studentResults.sort((a, b) => (b.overall_avg || 0) - (a.overall_avg || 0));
  let rank = 1;
  for (let i = 0; i < studentResults.length; i++) {
    studentResults[i].rank = rank;
    if (i < studentResults.length - 1 && studentResults[i].overall_avg !== studentResults[i + 1].overall_avg) {
      rank++;
    }
  }

  // Class aggregates
  const validAvgs = studentResults.filter(s => s.overall_avg !== null).map(s => s.overall_avg);
  const classAvg = validAvgs.length > 0
    ? Math.round(validAvgs.reduce((sum, v) => sum + v, 0) / validAvgs.length * 10) / 10
    : null;
  const levelCounts = { EE: 0, ME: 0, AE: 0, BE: 0 };
  studentResults.forEach(s => { if (levelCounts[s.level] !== undefined) levelCounts[s.level]++; });

  // Per-area class averages
  const areaAverages = areaList.map(a => {
    const scores = studentResults
      .map(s => s.areas.find(ad => String(ad.area_id) === String(a.area_id))?.avg_pct)
      .filter(sc => sc !== null && sc !== undefined);
    const avg = scores.length > 0
      ? Math.round(scores.reduce((sum, v) => sum + v, 0) / scores.length * 10) / 10
      : null;
    return { area_id: a.area_id, area_name: a.area_name, class_avg: avg, student_count: scores.length };
  });

  // Level percentages
  const total = studentResults.length || 1;
  const levelPct = {};
  Object.entries(levelCounts).forEach(([k, v]) => { levelPct[k] = Math.round(v / total * 100); });

  // Top/bottom performers (by overall average — informational only, no ranking in CBC report)
  const ranked = studentResults.filter(s => s.overall_avg !== null).sort((a, b) => b.overall_avg - a.overall_avg);
  const topPerformers = ranked.slice(0, 3);
  const bottomPerformers = ranked.slice(-3).reverse();

  // Core competencies & values for the class
  const [competencyList] = await req.db.execute(
    'SELECT * FROM core_competencies ORDER BY category, competency_id'
  );
  const [competencyRatings] = await req.db.execute(
    `SELECT sr.*, s.full_name
     FROM student_competency_ratings sr
     JOIN students s ON sr.student_id = s.student_id
     WHERE s.class_id = ? AND sr.term = ?
     ORDER BY sr.student_id, sr.competency_id`,
    [class_id, term]
  );
  // Group ratings by student
  const competencyMap = {};
  for (const r of competencyRatings) {
    if (!competencyMap[r.student_id]) competencyMap[r.student_id] = {};
    competencyMap[r.student_id][r.competency_id] = r.rating;
  }

  res.json({
    class: classInfo[0],
    term,
    students: studentResults,
    aggregates: {
      total_students: students.length,
      class_average: classAvg,
      level_counts: levelCounts,
      level_percentages: levelPct,
      area_averages: areaAverages,
      top_performers: topPerformers.map(s => ({ full_name: s.full_name, overall_avg: s.overall_avg })),
      bottom_performers: bottomPerformers.map(s => ({ full_name: s.full_name, overall_avg: s.overall_avg }))
    },
    learning_areas: areaList,
    competencies: {
      list: competencyList,
      student_ratings: competencyMap
    }
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
