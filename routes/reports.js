const express = require('express');
const router = express.Router();

// ---- Staff auth: resolves teacher from Bearer session (OTP) ----
async function requireStaff(req, res) {
  const auth = (req.headers.authorization || '').trim();
  if (!auth || !auth.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing or invalid Authorization header' }); return null; }
  const sessionId = auth.split(' ')[1];
  const [srows] = await req.db.execute('SELECT phone, email, verified, expires_at FROM otp_sessions WHERE session_id = ?', [sessionId]);
  if (srows.length === 0) { res.status(401).json({ error: 'Invalid session' }); return null; }
  const sess = srows[0];
  if (!sess.verified || !sess.expires_at || new Date(sess.expires_at) <= new Date()) { res.status(401).json({ error: 'Session not verified or expired' }); return null; }

  let trows;
  if (sess.teacher_id) [trows] = await req.db.execute('SELECT teacher_id, role, school_id FROM teachers WHERE teacher_id = ?', [sess.teacher_id]);
  if ((!trows || trows.length === 0) && sess.phone) [trows] = await req.db.execute('SELECT teacher_id, role, school_id FROM teachers WHERE phone = ? LIMIT 1', [sess.phone]);
  if (!trows || trows.length === 0) {
    if (sess.email) [trows] = await req.db.execute('SELECT teacher_id, role, school_id FROM teachers WHERE email = ? LIMIT 1', [sess.email]);
  }
  if (!trows || trows.length === 0) { res.status(404).json({ error: 'Teacher not found' }); return null; }
  const me = trows[0];
  return { teacher_id: me.teacher_id, role: me.role, school_id: me.school_id };
}

// ---- Self-heal assignments table (idempotent) ----
async function ensureAssignmentsTable(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS teacher_class_assignments (
    assignment_id INT PRIMARY KEY AUTO_INCREMENT,
    teacher_id    CHAR(9) NOT NULL,
    class_id      INT     NOT NULL,
    assigned_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_teacher_class (teacher_id, class_id),
    FOREIGN KEY (teacher_id) REFERENCES teachers(teacher_id),
    FOREIGN KEY (class_id)  REFERENCES classes(class_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

// ---- Scope helper: returns class_ids the staff may access ----
async function getScopedClassIds(db, staff, explicitClassId) {
  if (staff.role === 'head') {
    const [rows] = await db.execute('SELECT class_id FROM classes WHERE school_id = ?', [staff.school_id]);
    const all = rows.map(r => r.class_id);
    if (explicitClassId && !all.includes(Number(explicitClassId))) return []; // head can't peek another school
    return explicitClassId ? [Number(explicitClassId)] : all;
  }
  // Teacher: only classes explicitly assigned to them in this school
  await ensureAssignmentsTable(db);
  const [rows] = await db.execute(
    'SELECT class_id FROM teacher_class_assignments WHERE teacher_id = ?',
    [staff.teacher_id]
  );
  const assigned = rows.map(r => r.class_id);
  if (explicitClassId) return assigned.includes(Number(explicitClassId)) ? [Number(explicitClassId)] : [];
  return assigned;
}

// ============================================================
// 1. LEVEL DISTRIBUTION — school-wide or per-class
// GET /api/reports/level-distribution?term=Term%201&year=2026&class_id=123
// ============================================================
router.get('/level-distribution', async (req, res) => {
  const staff = await requireStaff(req, res);
  if (!staff) return;

  const term = req.query.term;
  const year = parseInt(req.query.year) || new Date().getFullYear();
  if (!term) return res.status(400).json({ error: 'term required' });

  try {
    const classIds = await getScopedClassIds(req.db, staff, req.query.class_id);
    if (classIds.length === 0) return res.status(403).json({ error: 'No access to that class' });

    // Build placeholders for IN clause
    const ph = classIds.map(() => '?').join(',');

    // 1) Active students per class
    const [stuRows] = await req.db.execute(
      `SELECT student_id, class_id, full_name FROM students WHERE class_id IN (${ph}) AND enrollment_status = 'Active' ORDER BY full_name`,
      [...classIds]
    );

    // 2) Results: exam_results → exam_sessions filtered by class + term + year.
    // CBC reports levels, never averages: collect each result's recorded
    // level (falling back to a threshold mapping of its own percentage).
    const [scoreRows] = await req.db.execute(
      `SELECT er.student_id, es.class_id, la.area_id, er.score, er.out_of, er.performance_level
       FROM exam_results er
       JOIN exam_sessions es ON er.session_id = es.session_id
       JOIN sub_learning_areas sla ON er.sub_area_id = sla.sub_area_id
       JOIN learning_areas la ON sla.area_id = la.area_id
       WHERE es.class_id IN (${ph}) AND es.term = ? AND es.academic_year = ?`,
      [...classIds, term, year]
    );

    // Accumulate recorded levels per student per area
    const levelOrder = { EE: 4, ME: 3, AE: 2, BE: 1 };
    const dominantLevel = (levels) => {
      if (!levels || levels.length === 0) return null;
      return levels.reduce((best, l) => (levelOrder[l] || 0) > (levelOrder[best] || 0) ? l : best);
    };
    const levelOfDefault = pct => pct >= 80 ? 'EE' : pct >= 60 ? 'ME' : pct >= 40 ? 'AE' : 'BE';
    // Overall = majority of constituent levels; ties resolve to the higher level
    const majorityLevel = (levels) => {
      const present = (levels || []).filter(Boolean);
      if (present.length === 0) return null;
      const counts = {};
      for (const l of present) counts[l] = (counts[l] || 0) + 1;
      return Object.keys(counts).sort((a, b) => (counts[b] - counts[a]) || (levelOrder[b] - levelOrder[a]))[0];
    };
    const levelsByStudentArea = {}; // levelsByStudentArea[student_id][area_id] = { levels[], pcts[] }
    for (const r of scoreRows) {
      if (!levelsByStudentArea[r.student_id]) levelsByStudentArea[r.student_id] = {};
      if (!levelsByStudentArea[r.student_id][r.area_id]) levelsByStudentArea[r.student_id][r.area_id] = { levels: [], pcts: [] };
      const e = levelsByStudentArea[r.student_id][r.area_id];
      if (r.performance_level) e.levels.push(r.performance_level);
      if (r.score != null && Number(r.out_of) > 0) e.pcts.push((Number(r.score) / Number(r.out_of)) * 100);
    }

    // Learning areas present in these classes (by class's level_name)
    const [clsAreas] = await req.db.execute(
      `SELECT DISTINCT c.class_id, la.area_id, la.area_name, c.level_name
       FROM classes c
       JOIN learning_areas la ON la.school_id = c.school_id
       WHERE c.class_id IN (${ph})`,
      [...classIds]
    );

    // Normalize level key for matching
    const norm = v => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const classAreaMap = {};
    for (const r of clsAreas) {
      if (!classAreaMap[r.class_id]) classAreaMap[r.class_id] = [];
      let k = norm(r.level_name);
      if (k === 'preprimary') k = 'pp2';
      // Include area if its level_name matches class's normalized level key
      const laNorm = norm(r.area_name); // wait — learning_areas.level_name
      // Actually we need to filter by learning_areas.level_name matching class's level
      // Let's just pull areas per class level properly
    }

    // Simpler: for each class, find its level, then get areas for that level
    // We'll do it in JS after fetching
    const [allAreas] = await req.db.execute(
      'SELECT area_id, area_name, level_name FROM learning_areas WHERE school_id = ?',
      [staff.school_id]
    );

    // Class metadata
    const [classMeta] = await req.db.execute(
      'SELECT class_id, class_name, level_name FROM classes WHERE class_id IN (${ph})'.replace('${ph}', ph),
      [...classIds]
    );

    // Map class -> areas (match by normalized level)
    const classToAreas = {};
    for (const c of classMeta) {
      let lk = norm(c.level_name);
      if (lk === 'preprimary') lk = 'pp2';
      classToAreas[c.class_id] = allAreas.filter(a => {
        let ak = norm(a.level_name);
        if (ak === 'preprimary') ak = 'pp2';
        return ak === lk;
      });
    }

    // Per-student aggregates (levels only — CBC has no averages, positions or ranks)
    const studentsByClass = {};
    for (const s of stuRows) studentsByClass[s.class_id] = studentsByClass[s.class_id] || [];

    const studentDetails = [];
    for (const s of stuRows) {
      const areas = classToAreas[s.class_id] || [];
      const areaDetails = areas.map(a => {
        const acc = levelsByStudentArea[s.student_id]?.[a.area_id];
        const level = dominantLevel(acc?.levels) || dominantLevel((acc?.pcts || []).map(levelOfDefault));
        return { area_id: a.area_id, area_name: a.area_name, level };
      });
      const overall = majorityLevel(areaDetails.map(x => x.level));
      studentDetails.push({
        student_id: s.student_id,
        class_id: s.class_id,
        full_name: s.full_name,
        areas: areaDetails,
        overall_level: overall,
        level: overall
      });
    }

    // Build per-class output + school rollup
    const classOutput = classMeta.map(c => {
      const clsStudents = studentDetails.filter(s => s.class_id === c.class_id);
      const assessed = clsStudents.filter(s => s.overall_level !== null);
      const levelCounts = { EE: 0, ME: 0, AE: 0, BE: 0 };
      assessed.forEach(s => { levelCounts[s.level]++; });
      const total = clsStudents.length;

      return {
        class_id: c.class_id,
        class_name: c.class_name,
        total_students: total,
        assessed_students: assessed.length,
        overall_level: majorityLevel(assessed.map(s => s.overall_level)),
        level_counts: levelCounts,
        level_percentages: Object.fromEntries(
          Object.entries(levelCounts).map(([k, v]) => [k, total ? Math.round(v / total * 100) : 0])
        )
      };
    });

    // School rollup
    const allAssessed = studentDetails.filter(s => s.overall_level !== null);
    const schoolLevelCounts = { EE: 0, ME: 0, AE: 0, BE: 0 };
    allAssessed.forEach(s => { schoolLevelCounts[s.level]++; });
    const schoolTotal = studentDetails.length;

    res.json({
      term,
      year,
      classes: classOutput,
      school: {
        total_students: schoolTotal,
        assessed_students: allAssessed.length,
        overall_level: majorityLevel(allAssessed.map(s => s.overall_level)),
        level_counts: schoolLevelCounts,
        level_percentages: Object.fromEntries(
          Object.entries(schoolLevelCounts).map(([k, v]) => [k, schoolTotal ? Math.round(v / schoolTotal * 100) : 0])
        )
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// 2. STRAND / SUB-STRAND PERFORMANCE — strictly assessments
// GET /api/reports/strand-performance?class_id=123&term=Term%201&year=2026
// ============================================================
router.get('/strand-performance', async (req, res) => {
  const staff = await requireStaff(req, res);
  if (!staff) return;

  const classId = parseInt(req.query.class_id);
  const term = req.query.term;
  const year = parseInt(req.query.year) || new Date().getFullYear();
  if (!classId || !term) return res.status(400).json({ error: 'class_id and term required' });

  try {
    const classIds = await getScopedClassIds(req.db, staff, classId);
    if (classIds.length === 0) return res.status(403).json({ error: 'No access to that class' });

    // Verify the class belongs to staff's school
    const [c] = await req.db.execute('SELECT class_id, class_name, school_id FROM classes WHERE class_id = ?', [classId]);
    if (c.length === 0) return res.status(404).json({ error: 'Class not found' });
    if (c[0].school_id !== staff.school_id) return res.status(403).json({ error: 'Class not in your school' });

    // Assessment results with recorded levels (CBC reports levels, never averages)
    const [rows] = await req.db.execute(
      `SELECT ar.student_id, ar.score, ar.performance_level, a.max_score, la.area_id, la.area_name,
              st.strand_id, st.strand_name,
              ss.sub_strand_id, ss.sub_strand_name
       FROM assessment_results ar
       JOIN assessments a ON ar.assessment_id = a.assessment_id
       JOIN sub_strands ss ON a.sub_strand_id = ss.sub_strand_id
       JOIN strands st ON ss.strand_id = st.strand_id
       JOIN learning_areas la ON st.area_id = la.area_id
       WHERE a.class_id = ? AND st.term = ? AND YEAR(a.date) = ?`,
      [classId, term, year]
    );

    const levelOrder = { EE: 4, ME: 3, AE: 2, BE: 1 };
    const dominantLevel = (levels) => {
      if (!levels || levels.length === 0) return null;
      return levels.reduce((best, l) => (levelOrder[l] || 0) > (levelOrder[best] || 0) ? l : best);
    };
    const levelOfDefault = pct => pct >= 80 ? 'EE' : pct >= 60 ? 'ME' : pct >= 40 ? 'AE' : 'BE';
    const emptyCounts = () => ({ EE: 0, ME: 0, AE: 0, BE: 0, total: 0 });

    // Accumulate recorded levels per student per sub-strand
    const acc = {}; // acc[student_id][sub_strand_id] = { levels[] }
    for (const r of rows) {
      if (!acc[r.student_id]) acc[r.student_id] = {};
      if (!acc[r.student_id][r.sub_strand_id]) acc[r.student_id][r.sub_strand_id] = { levels: [] };
      if (r.performance_level) acc[r.student_id][r.sub_strand_id].levels.push(r.performance_level);
      else if (r.score != null && Number(r.max_score) > 0) {
        acc[r.student_id][r.sub_strand_id].levels.push(levelOfDefault((Number(r.score) / Number(r.max_score)) * 100));
      }
    }

    // Group into area → strand → sub_strand structure
    const areaMap = {};
    for (const r of rows) {
      if (!areaMap[r.area_id]) areaMap[r.area_id] = { area_id: r.area_id, area_name: r.area_name, strands: {} };
      if (!areaMap[r.area_id].strands[r.strand_id]) {
        areaMap[r.area_id].strands[r.strand_id] = {
          strand_id: r.strand_id,
          strand_name: r.strand_name,
          sub_strands: {}
        };
      }
      if (!areaMap[r.area_id].strands[r.strand_id].sub_strands[r.sub_strand_id]) {
        areaMap[r.area_id].strands[r.strand_id].sub_strands[r.sub_strand_id] = {
          sub_strand_id: r.sub_strand_id,
          sub_strand_name: r.sub_strand_name,
          students: {}
        };
      }
    }

    // Per-student per-sub-strand level (dominant of recorded levels)
    for (const [sid, subs] of Object.entries(acc)) {
      for (const [ssid, vals] of Object.entries(subs)) {
        // find which area/strand this sub_strand belongs to
        for (const area of Object.values(areaMap)) {
          for (const strand of Object.values(area.strands)) {
            if (strand.sub_strands[ssid]) {
              strand.sub_strands[ssid].students[sid] = { level: dominantLevel(vals.levels) };
            }
          }
        }
      }
    }

    const levelOf = pct => pct >= 80 ? 'EE' : pct >= 60 ? 'ME' : pct >= 40 ? 'AE' : 'BE';

    // Build response hierarchy with level aggregates (counts only, no averages)
    const countInto = (counts, level) => { if (level) { counts[level]++; counts.total++; } };
    // Dominant level of a counts object (ties resolve to the higher level)
    const topLevel = (counts) => {
      let best = null;
      for (const l of ['EE', 'ME', 'AE', 'BE']) {
        if (counts[l] > 0 && (!best || counts[l] > counts[best])) best = l;
      }
      return best;
    };
    const areasOut = [];
    for (const area of Object.values(areaMap)) {
      const strandsOut = [];
      const areaCounts = emptyCounts();
      for (const strand of Object.values(area.strands)) {
        const subsOut = [];
        const strandCounts = emptyCounts();
        for (const sub of Object.values(strand.sub_strands)) {
          const assessed = Object.entries(sub.students).filter(([, v]) => v.level);
          const subCounts = emptyCounts();
          assessed.forEach(([, v]) => countInto(subCounts, v.level));
          subsOut.push({
            sub_strand_id: sub.sub_strand_id,
            sub_strand_name: sub.sub_strand_name,
            level: dominantLevel(assessed.map(([, v]) => v.level)),
            counts: subCounts,
            student_count: assessed.length
          });
          for (const k of ['EE', 'ME', 'AE', 'BE']) strandCounts[k] += subCounts[k];
          strandCounts.total += subCounts.total;
        }
        strandsOut.push({
          strand_id: strand.strand_id,
          strand_name: strand.strand_name,
          level: topLevel(strandCounts),
          counts: strandCounts,
          sub_strands: subsOut
        });
        for (const k of ['EE', 'ME', 'AE', 'BE']) areaCounts[k] += strandCounts[k];
        areaCounts.total += strandCounts.total;
      }
      areasOut.push({
        area_id: area.area_id,
        area_name: area.area_name,
        level: topLevel(areaCounts),
        counts: areaCounts,
        strands: strandsOut
      });
    }

    res.json({
      class_id: classId,
      class_name: c[0].class_name,
      term,
      year,
      areas: areasOut
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;