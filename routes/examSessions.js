const express = require('express');
const router = express.Router();

// ─── EXAM SESSIONS ───────────────────────────────────────────────

// GET /api/exam-sessions — list sessions
router.get('/', async (req, res) => {
  const { school_id, class_id, term, year } = req.query;
  if (!school_id) return res.status(400).json({ error: 'school_id required' });

  let sql = 'SELECT * FROM exam_sessions WHERE school_id = ?';
  const params = [school_id];
  if (class_id) { sql += ' AND class_id = ?'; params.push(class_id); }
  if (term) { sql += ' AND term = ?'; params.push(term); }
  if (year) { sql += ' AND academic_year = ?'; params.push(year); }
  sql += ' ORDER BY created_at DESC';

  const [rows] = await req.db.execute(sql, params);
  res.json({ sessions: rows });
});

// POST /api/exam-sessions — create a session
router.post('/', async (req, res) => {
  const { school_id, class_id, term, academic_year, exam_name, exam_type, open_date, close_date, created_by } = req.body;
  if (!school_id || !class_id || !term || !academic_year || !exam_name) {
    return res.status(400).json({ error: 'school_id, class_id, term, academic_year, exam_name required' });
  }
  const validTypes = ['CAT 1', 'CAT 2', 'CAT 3', 'Mid Term', 'End Term', 'Other'];
  const type = validTypes.includes(exam_type) ? exam_type : 'CAT 1';

  const [r] = await req.db.execute(
    `INSERT INTO exam_sessions (school_id, class_id, term, academic_year, exam_name, exam_type, open_date, close_date, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [school_id, class_id, term, academic_year, exam_name, type, open_date || null, close_date || null, created_by || null]
  );
  const [saved] = await req.db.execute('SELECT * FROM exam_sessions WHERE session_id = ?', [r.insertId]);
  res.json(saved[0]);
});

// PUT /api/exam-sessions/:id — update a session
router.put('/:id', async (req, res) => {
  const { exam_name, exam_type, open_date, close_date } = req.body;
  const fields = [];
  const params = [];
  if (exam_name) { fields.push('exam_name = ?'); params.push(exam_name); }
  if (exam_type) { fields.push('exam_type = ?'); params.push(exam_type); }
  if (open_date !== undefined) { fields.push('open_date = ?'); params.push(open_date || null); }
  if (close_date !== undefined) { fields.push('close_date = ?'); params.push(close_date || null); }
  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

  params.push(req.params.id);
  await req.db.execute(`UPDATE exam_sessions SET ${fields.join(', ')} WHERE session_id = ?`, params);
  const [saved] = await req.db.execute('SELECT * FROM exam_sessions WHERE session_id = ?', [req.params.id]);
  res.json(saved[0]);
});

// PATCH /api/exam-sessions/:id/status — change status
router.patch('/:id/status', async (req, res) => {
  const { status } = req.body;
  const validStatus = ['Scheduled', 'Open', 'Closed'];
  if (!validStatus.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  await req.db.execute('UPDATE exam_sessions SET status = ? WHERE session_id = ?', [status, req.params.id]);
  const [saved] = await req.db.execute('SELECT * FROM exam_sessions WHERE session_id = ?', [req.params.id]);
  res.json(saved[0]);
});

// DELETE /api/exam-sessions/:id
router.delete('/:id', async (req, res) => {
  await req.db.execute('DELETE FROM exam_sessions WHERE session_id = ?', [req.params.id]);
  res.json({ deleted: true });
});

// ─── KICD STRAND TREE (Learning Area → Strand → Sub-strand) ─────

// GET /api/exam-sessions/strand-tree?area_id=X
//   → { strands: [ { strand_id, strand_name, term, sub_strands: [] } ] }
// GET /api/exam-sessions/strand-tree?school_id=X&class_id=Y[&term=T]
//   → { areas: [ { area_id, area_name, strands: [ { strand_id, strand_name, term, sub_strands: [...] } ] } ] }
//     Areas are scoped to the class's level_name (grade) so only the relevant
//     KICD strands for that class appear. term filters to one term's strands.
router.get('/strand-tree', async (req, res) => {
  const { area_id, school_id, class_id, term } = req.query;

  if (area_id) {
    const sqlTerm = term ? ' AND st.term = ?' : '';
    const params = term ? [area_id, term] : [area_id];
    const [rows] = await req.db.execute(
      `SELECT st.strand_id, st.strand_name, st.term, ss.sub_strand_id, ss.sub_strand_name
       FROM strands st
       LEFT JOIN sub_strands ss ON st.strand_id = ss.strand_id
       WHERE st.area_id = ?${sqlTerm}
       ORDER BY st.strand_name, ss.sub_strand_name`,
      params
    );
    const strandMap = new Map();
    for (const r of rows) {
      if (!strandMap.has(r.strand_id)) {
        strandMap.set(r.strand_id, { strand_id: r.strand_id, strand_name: r.strand_name, term: r.term, sub_strands: [] });
      }
      if (r.sub_strand_id) {
        strandMap.get(r.strand_id).sub_strands.push({ sub_strand_id: r.sub_strand_id, sub_strand_name: r.sub_strand_name });
      }
    }
    return res.json({ strands: Array.from(strandMap.values()).filter(s => s.sub_strands.length > 0) });
  }

  if (school_id) {
    if (!class_id) {
      return res.status(400).json({ error: 'class_id required to filter learning areas by grade' });
    }

    const [classRows] = await req.db.execute('SELECT level_name FROM classes WHERE class_id = ?', [class_id]);
    if (classRows.length === 0) {
      return res.status(404).json({ error: 'Class not found' });
    }
    if (!classRows[0].level_name) {
      return res.status(400).json({ error: 'Class has no grade level assigned (level_name is required)' });
    }

    const sqlTerm = term ? 'AND st.term = ?' : '';
    const params = term ? [school_id, classRows[0].level_name, term] : [school_id, classRows[0].level_name];
    const [rows] = await req.db.execute(
      `SELECT la.area_id, la.area_name,
              st.strand_id, st.strand_name, st.term,
              ss.sub_strand_id, ss.sub_strand_name
       FROM learning_areas la
       JOIN strands st ON la.area_id = st.area_id ${sqlTerm}
       JOIN sub_strands ss ON st.strand_id = ss.strand_id
       WHERE la.school_id = ? AND la.level_name = ?
       ORDER BY la.area_name, st.strand_name, ss.sub_strand_name`,
      params
    );

    const areaMap = new Map();
    for (const r of rows) {
      if (!areaMap.has(r.area_id)) {
        areaMap.set(r.area_id, { area_id: r.area_id, area_name: r.area_name, strands: new Map() });
      }
      const area = areaMap.get(r.area_id);
      if (!area.strands.has(r.strand_id)) {
        area.strands.set(r.strand_id, { strand_id: r.strand_id, strand_name: r.strand_name, term: r.term, sub_strands: [] });
      }
      area.strands.get(r.strand_id).sub_strands.push({ sub_strand_id: r.sub_strand_id, sub_strand_name: r.sub_strand_name });
    }

    const areas = Array.from(areaMap.values()).map(a => ({
      area_id: a.area_id,
      area_name: a.area_name,
      strands: Array.from(a.strands.values())
    }));
    return res.json({ areas });
  }

  res.status(400).json({ error: 'area_id or school_id required' });
});

// Legacy alias — returns the strand tree plus a flat sub_strand list for older clients.
router.get('/sub-learning-areas', async (req, res) => {
  const { area_id, school_id, class_id, term } = req.query;
  if (!area_id && !(school_id && class_id)) {
    return res.status(400).json({ error: 'area_id or school_id required' });
  }
  const tree = await computeStrandTree(req.db, null, { area_id, school_id, class_id, term });
  if (tree.error) return res.status(400).json({ error: tree.error });
  const areas = tree.areas || [];
  const sub_areas = areas.flatMap(a => (a.strands || []).flatMap(s => (s.sub_strands || []).map(ss => ({
    sub_strand_id: ss.sub_strand_id,
    sub_strand_name: ss.sub_strand_name,
    strand_id: s.strand_id,
    strand_name: s.strand_name,
    term: s.term,
    area_id: a.area_id,
    area_name: a.area_name
  }))));
  return res.json({ ...tree, sub_areas });
});

async function computeStrandTree(db, res, { area_id, school_id, class_id, term }) {
  if (area_id) {
    const sqlTerm = term ? ' AND st.term = ?' : '';
    const params = term ? [area_id, term] : [area_id];
    const [rows] = await db.execute(
      `SELECT st.strand_id, st.strand_name, st.term, ss.sub_strand_id, ss.sub_strand_name
       FROM strands st
       LEFT JOIN sub_strands ss ON st.strand_id = ss.strand_id
       WHERE st.area_id = ?${sqlTerm}
       ORDER BY st.strand_name, ss.sub_strand_name`,
      params
    );
    const strandMap = new Map();
    for (const r of rows) {
      if (!strandMap.has(r.strand_id)) {
        strandMap.set(r.strand_id, { strand_id: r.strand_id, strand_name: r.strand_name, term: r.term, sub_strands: [] });
      }
      if (r.sub_strand_id) {
        strandMap.get(r.strand_id).sub_strands.push({ sub_strand_id: r.sub_strand_id, sub_strand_name: r.sub_strand_name });
      }
    }
    return { strands: Array.from(strandMap.values()).filter(s => s.sub_strands.length > 0) };
  }
  if (school_id && class_id) {
    const [classRows] = await db.execute('SELECT level_name FROM classes WHERE class_id = ?', [class_id]);
    if (classRows.length === 0) return { error: 'Class not found' };
    if (!classRows[0].level_name) return { error: 'Class has no grade level assigned (level_name is required)' };

    const sqlTerm = term ? 'AND st.term = ?' : '';
    const params = term ? [school_id, classRows[0].level_name, term] : [school_id, classRows[0].level_name];
    const [rows] = await db.execute(
      `SELECT la.area_id, la.area_name,
              st.strand_id, st.strand_name, st.term,
              ss.sub_strand_id, ss.sub_strand_name
       FROM learning_areas la
       JOIN strands st ON la.area_id = st.area_id ${sqlTerm}
       JOIN sub_strands ss ON st.strand_id = ss.strand_id
       WHERE la.school_id = ? AND la.level_name = ?
       ORDER BY la.area_name, st.strand_name, ss.sub_strand_name`,
      params
    );
    const areaMap = new Map();
    for (const r of rows) {
      if (!areaMap.has(r.area_id)) {
        areaMap.set(r.area_id, { area_id: r.area_id, area_name: r.area_name, strands: new Map() });
      }
      const area = areaMap.get(r.area_id);
      if (!area.strands.has(r.strand_id)) {
        area.strands.set(r.strand_id, { strand_id: r.strand_id, strand_name: r.strand_name, term: r.term, sub_strands: [] });
      }
      area.strands.get(r.strand_id).sub_strands.push({ sub_strand_id: r.sub_strand_id, sub_strand_name: r.sub_strand_name });
    }
    return { areas: Array.from(areaMap.values()).map(a => ({ area_id: a.area_id, area_name: a.area_name, strands: Array.from(a.strands.values()) })) };
  }
  return { error: 'area_id or school_id required' };
}

// ─── EXAM RESULTS ────────────────────────────────────────────────

// GET /api/exam-sessions/:id/results — get all results for a session
router.get('/:id/results', async (req, res) => {
  const [sessionRows] = await req.db.execute('SELECT * FROM exam_sessions WHERE session_id = ?', [req.params.id]);
  if (sessionRows.length === 0) return res.status(404).json({ error: 'Session not found' });

  const [results] = await req.db.execute(
    `SELECT er.*, s.full_name AS student_name,
            ss.sub_strand_name, st.strand_name, st.strand_id, la.area_id, la.area_name
     FROM exam_results er
     JOIN students s ON er.student_id = s.student_id
     JOIN sub_strands ss ON er.sub_strand_id = ss.sub_strand_id
     JOIN strands st ON ss.strand_id = st.strand_id
     JOIN learning_areas la ON st.area_id = la.area_id
     WHERE er.session_id = ?
     ORDER BY s.full_name, la.area_name, st.strand_name, ss.sub_strand_name`,
    [req.params.id]
  );

  res.json({ session: sessionRows[0], results });
});

// POST /api/exam-sessions/:id/results — batch save results (keyed by sub_strand_id)
router.post('/:id/results', async (req, res) => {
  const { results, entered_by } = req.body;
  if (!results?.length) return res.status(400).json({ error: 'results array required' });

  const [sessionRows] = await req.db.execute('SELECT * FROM exam_sessions WHERE session_id = ?', [req.params.id]);
  if (sessionRows.length === 0) return res.status(404).json({ error: 'Session not found' });
  const session = sessionRows[0];
  if (session.status === 'Closed') return res.status(403).json({ error: 'Session is closed — results cannot be modified' });

  // Check premium payment: if school-pays model is locked and unpaid, block exam posting
  const [school] = await req.db.execute(
    'SELECT premium_payment_model, premium_payment_model_locked FROM schools WHERE school_id = ?',
    [session.school_id]
  );
  if (school.length > 0 && school[0].premium_payment_model === 'school' && school[0].premium_payment_model_locked === 1) {
    const [paid] = await req.db.execute(
      "SELECT COUNT(*) AS cnt FROM premium_bulk_payments WHERE school_id = ? AND term = ? AND year = ? AND payment_status = 'completed'",
      [session.school_id, session.term, session.academic_year]
    );
    if (paid[0]?.cnt === 0) {
      return res.status(403).json({
        error: 'EXAM_POSTING_BLOCKED',
        message: 'School premium payment is required before teachers can post exam results. Contact the headteacher to complete payment.'
      });
    }
  }

  const { getRubricConfig, getLevel } = require('../lib/config');
  const rubricConfig = await getRubricConfig(req.db, session.school_id);

  const conn = await req.db.getConnection();
  let savedCount = 0;
  try {
    await conn.beginTransaction();
    for (const r of results) {
      if (!r.student_id || !r.sub_strand_id || r.score === undefined || r.out_of === undefined) continue;
      const pct = r.out_of > 0 ? r.score / r.out_of : 0;
      const matched = getLevel(pct, rubricConfig);
      const level = matched ? matched.level_code : 'BE';

      await conn.execute(
        `INSERT INTO exam_results (session_id, student_id, sub_strand_id, score, out_of, performance_level, entered_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE score = VALUES(score), out_of = VALUES(out_of),
           performance_level = VALUES(performance_level), entered_by = VALUES(entered_by)`,
        [req.params.id, r.student_id, r.sub_strand_id, r.score, r.out_of, level, entered_by || null]
      );
      savedCount++;
    }
    await conn.commit();
    res.json({ saved: savedCount });
  } catch (err) {
    await conn.rollback();
    console.error('[EXAMS]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

// GET /api/exam-sessions/:id/class-report — aggregated class report for this exam
router.get('/:id/class-report', async (req, res) => {
  const [sessionRows] = await req.db.execute('SELECT * FROM exam_sessions WHERE session_id = ?', [req.params.id]);
  if (sessionRows.length === 0) return res.status(404).json({ error: 'Session not found' });
  const session = sessionRows[0];

  const [students] = await req.db.execute(
    'SELECT student_id, full_name FROM students WHERE class_id = ? AND enrollment_status = ? ORDER BY full_name',
    [session.class_id, 'Active']
  );

  // Resolve the class level so KICD strands are scoped to the right grade
  const [clsRows] = await req.db.execute('SELECT level_name FROM classes WHERE class_id = ?', [session.class_id]);
  const levelName = clsRows[0]?.level_name;

  // If the class has no level_name, fall back to all strands in the school
  const scopeWhere = levelName ? 'la.school_id = ? AND la.level_name = ?' : 'la.school_id = ?';
  const scopeParams = levelName ? [session.school_id, levelName] : [session.school_id];

  const [levelAreaRows] = await req.db.execute(
    `SELECT la.area_id, la.area_name, st.strand_id, st.strand_name,
            ss.sub_strand_id, ss.sub_strand_name,
            er.student_id, er.score, er.out_of, er.performance_level
     FROM learning_areas la
     JOIN strands st ON la.area_id = st.area_id AND st.term = ?
     JOIN sub_strands ss ON st.strand_id = ss.strand_id
     LEFT JOIN exam_results er ON ss.sub_strand_id = er.sub_strand_id AND er.session_id = ?
     WHERE ${scopeWhere}
     ORDER BY la.area_name, st.strand_name, ss.sub_strand_name`,
    [session.term, req.params.id, ...scopeParams]
  );

  // Group by learning area → strand → sub-strand
  const areaMap = {};
  for (const row of levelAreaRows) {
    if (!areaMap[row.area_id]) {
      areaMap[row.area_id] = { area_id: row.area_id, area_name: row.area_name, strands: {} };
    }
    if (!areaMap[row.area_id].strands[row.strand_id]) {
      areaMap[row.area_id].strands[row.strand_id] = {
        strand_id: row.strand_id, strand_name: row.strand_name, sub_strands: {}
      };
    }
    const strand = areaMap[row.area_id].strands[row.strand_id];
    if (!strand.sub_strands[row.sub_strand_id]) {
      strand.sub_strands[row.sub_strand_id] = { sub_strand_id: row.sub_strand_id, sub_strand_name: row.sub_strand_name, scores: {} };
    }
    if (row.student_id) {
      strand.sub_strands[row.sub_strand_id].scores[row.student_id] = {
        score: row.score, out_of: row.out_of, performance_level: row.performance_level
      };
    }
  }

  // Build student result rows
  const studentResults = students.map(s => {
    const areas = {};
    let totalScore = 0, totalOutOf = 0;

    for (const [areaId, area] of Object.entries(areaMap)) {
      const strands = [];
      const subAreas = [];
      let areaScore = 0, areaOutOf = 0;
      for (const [strandId, strandEntry] of Object.entries(area.strands)) {
        const strandSubs = [];
        for (const [subId, sub] of Object.entries(strandEntry.sub_strands)) {
          const result = sub.scores[s.student_id];
          const score = result ? parseFloat(result.score) || 0 : null;
          const outOf = result ? parseFloat(result.out_of) || 0 : null;
          const pct = (score !== null && outOf > 0) ? Math.round(score / outOf * 100 * 10) / 10 : null;
          strandSubs.push({
            sub_strand_id: parseInt(subId),
            sub_strand_name: sub.sub_strand_name,
            score, out_of: outOf, pct, level: result?.performance_level || null
          });
          subAreas.push({
            sub_strand_id: parseInt(subId),
            sub_strand_name: sub.sub_strand_name,
            strand_id: parseInt(strandId),
            strand_name: strandEntry.strand_name,
            score, out_of: outOf, pct, level: result?.performance_level || null
          });
          if (score !== null && outOf > 0) { areaScore += score; areaOutOf += outOf; }
        }
        strands.push({ strand_id: parseInt(strandId), strand_name: strandEntry.strand_name, sub_strands: strandSubs });
      }
      const areaPct = areaOutOf > 0 ? Math.round(areaScore / areaOutOf * 100 * 10) / 10 : null;
      let areaLevel = 'N/A';
      if (areaPct !== null) {
        if (areaPct >= 80) areaLevel = 'EE';
        else if (areaPct >= 60) areaLevel = 'ME';
        else if (areaPct >= 40) areaLevel = 'AE';
        else areaLevel = 'BE';
      }
      areas[areaId] = { area_id: parseInt(areaId), area_name: area.area_name, strands, sub_areas: subAreas, total: { score: areaScore, out_of: areaOutOf, pct: areaPct, level: areaLevel } };
      if (areaOutOf > 0) { totalScore += areaScore; totalOutOf += areaOutOf; }
    }

    const overallPct = totalOutOf > 0 ? Math.round(totalScore / totalOutOf * 100 * 10) / 10 : null;
    let overallLevel = 'N/A';
    if (overallPct !== null) {
      if (overallPct >= 80) overallLevel = 'EE';
      else if (overallPct >= 60) overallLevel = 'ME';
      else if (overallPct >= 40) overallLevel = 'AE';
      else overallLevel = 'BE';
    }

    return { student_id: s.student_id, full_name: s.full_name, areas, overall: { pct: overallPct, level: overallLevel } };
  });

  // Rank by overall percentage
  studentResults.sort((a, b) => (b.overall?.pct || 0) - (a.overall?.pct || 0));
  let rank = 1;
  for (let i = 0; i < studentResults.length; i++) {
    studentResults[i].rank = rank;
    if (i < studentResults.length - 1 && studentResults[i].overall?.pct !== studentResults[i + 1]?.overall?.pct) rank++;
  }

  // Class aggregates
  const areaList = Object.values(areaMap).map(a => ({
    area_id: parseInt(a.area_id), area_name: a.area_name,
    strands: Object.values(a.strands).map(st => ({
      strand_id: st.strand_id, strand_name: st.strand_name,
      sub_strands: Object.values(st.sub_strands).map(ss => ({
        sub_strand_id: ss.sub_strand_id, sub_strand_name: ss.sub_strand_name
      }))
    }))
  }));

  res.json({ session, students: studentResults, area_list: areaList });
});

// GET /api/exam-sessions/premium-status — check if school's premium payment blocks exam posting
router.get('/premium-status', async (req, res) => {
  const { school_id, term, year } = req.query;
  if (!school_id) return res.status(400).json({ error: 'school_id required' });
  const currentTerm = term || `Term ${Math.ceil((new Date().getMonth() + 1) / 4)}`;
  const currentYear = year || new Date().getFullYear();

  const [school] = await req.db.execute(
    'SELECT premium_payment_model, premium_payment_model_locked FROM schools WHERE school_id = ?',
    [school_id]
  );
  if (school.length === 0) return res.json({ blocked: false, reason: null });

  const isSchoolPays = school[0].premium_payment_model === 'school' && school[0].premium_payment_model_locked === 1;
  if (!isSchoolPays) return res.json({ blocked: false, reason: null });

  const [paid] = await req.db.execute(
    "SELECT COUNT(*) AS cnt FROM premium_bulk_payments WHERE school_id = ? AND term = ? AND year = ? AND payment_status = 'completed'",
    [school_id, currentTerm, currentYear]
  );
  const blocked = paid[0]?.cnt === 0;
  res.json({
    blocked,
    reason: blocked ? 'School premium payment required for this term. Contact headteacher to complete payment.' : null,
    school_pays: true,
    locked: true
  });
});

module.exports = router;