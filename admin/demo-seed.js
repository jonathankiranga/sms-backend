/**
 * Demo Seed Script — creates a full demo school with students, teachers,
 * classes, attendance, exam results, fees, and a linked parent.
 *
 * Usage: node admin/demo-seed.js
 *
 * This will NOT run in production unless ALLOW_SEED=true is set.
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

const DEMO_SCHOOL_ID = 'DEM000001';
const DEMO_YEAR = 2026;

async function getConn() {
  if (process.env.DATABASE_URL) {
    const u = new URL(process.env.DATABASE_URL);
    return mysql.createConnection({
      host: u.hostname, port: parseInt(u.port) || 4000,
      user: u.username, password: u.password,
      database: u.pathname.replace('/', ''),
      ssl: { minVersion: 'TLSv1.2' }
    });
  }
  return mysql.createConnection({
    host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT) || 4000,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { minVersion: 'TLSv1.2' }
  });
}

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SEED !== 'true') {
    console.error('Set ALLOW_SEED=true to run demo seed in production');
    process.exit(1);
  }

  const conn = await getConn();
  console.log('Connected to database');

  // ── SCHOOL ──────────────────────────────────────────────────
  await conn.execute(`INSERT IGNORE INTO schools
    (school_id, school_name, region, contact_name, contact_phone, contact_email)
    VALUES (?, 'Greenfield Academy', 'Nairobi', 'Jonathan Kiranga', '254712345678', 'jonathankiranga@gmail.com')`,
    [DEMO_SCHOOL_ID]);
  console.log('✓ School created');

  // ── HEADTEACHER (you) ────────────────────────────────────────
  await conn.execute(`INSERT IGNORE INTO teachers
    (teacher_id, full_name, phone, email, role, school_id)
    VALUES ('TCHWX001', 'Jonathan Kiranga', '254712345678', 'jonathankiranga@gmail.com', 'head', ?)`,
    [DEMO_SCHOOL_ID]);
  console.log('✓ Headteacher created — login with jonathankiranga@gmail.com');

  // ── TEACHER ──────────────────────────────────────────────────
  await conn.execute(`INSERT IGNORE INTO teachers
    (teacher_id, full_name, phone, email, role, school_id)
    VALUES ('TCHWX002', 'Mary Wanjiku', '254722000001', 'mary.wanjiku@demo.com', 'teacher', ?)`,
    [DEMO_SCHOOL_ID]);
  console.log('✓ Class teacher created');

  // ── CLASSES ──────────────────────────────────────────────────
  const classes = [
    ['Grade 1', 1], ['Grade 2', 2], ['Grade 3', 3],
    ['Grade 4', 4], ['Grade 5', 5], ['Grade 6', 6]
  ];
  const classIds = {};
  for (const [name, rank] of classes) {
    const [r] = await conn.execute(`INSERT IGNORE INTO classes
      (school_id, class_name, level_name, academic_year, class_rank)
      VALUES (?, ?, ?, ?, ?)`,
      [DEMO_SCHOOL_ID, name, name, DEMO_YEAR, rank]);
    if (r.insertId) classIds[name] = r.insertId;
  }
  // fetch class IDs if already existed
  const [existingClasses] = await conn.execute(
    'SELECT class_id, class_name FROM classes WHERE school_id = ?', [DEMO_SCHOOL_ID]);
  existingClasses.forEach(c => { classIds[c.class_name] = c.class_id; });
  console.log('✓ Classes created:', Object.keys(classIds).join(', '));

  // ── STUDENTS — Grade 4 ───────────────────────────────────────
  const grade4Id = classIds['Grade 4'];
  const students = [
    ['STU000001', 'Amina Hassan', 'Female'],
    ['STU000002', 'Brian Ochieng', 'Male'],
    ['STU000003', 'Cynthia Mwangi', 'Female'],
    ['STU000004', 'David Kamau', 'Male'],
    ['STU000005', 'Esther Njeri', 'Female'],
    ['STU000006', 'Francis Otieno', 'Male'],
    ['STU000007', 'Grace Akinyi', 'Female'],
    ['STU000008', 'Hassan Abdi', 'Male'],
    ['STU000009', 'Irene Waithera', 'Female'],
    ['STU000010', 'James Kariuki', 'Male'],
  ];
  for (const [id, name, gender] of students) {
    await conn.execute(`INSERT IGNORE INTO students
      (student_id, full_name, class_id, school_id, gender, enrollment_status)
      VALUES (?, ?, ?, ?, ?, 'Active')`,
      [id, name, grade4Id, DEMO_SCHOOL_ID, gender]);
  }
  console.log(`✓ ${students.length} students created in Grade 4`);

  // ── PARENTS ──────────────────────────────────────────────────
  // Demo parent linked to Amina Hassan — use your phone for demo
  await conn.execute(`INSERT IGNORE INTO parent_profiles
    (parent_phone, full_name, is_premium, premium_expires_at)
    VALUES ('254712345678', 'Jonathan Kiranga', TRUE, DATE_ADD(NOW(), INTERVAL 6 MONTH))`);
  await conn.execute(`INSERT IGNORE INTO student_parent_map
    (student_id, parent_phone, relationship) VALUES ('STU000001', '254712345678', 'Parent')`);
  console.log('✓ Demo parent linked to Amina Hassan (phone: 254712345678)');

  // ── LEARNING AREAS ───────────────────────────────────────────
  const areas = ['English', 'Mathematics', 'Science', 'Social Studies', 'Kiswahili', 'Creative Arts'];
  const areaIds = {};
  for (const name of areas) {
    const [r] = await conn.execute(`INSERT IGNORE INTO learning_areas
      (school_id, level_name, area_name) VALUES (?, 'Grade 4', ?)`,
      [DEMO_SCHOOL_ID, name]);
    if (r.insertId) areaIds[name] = r.insertId;
  }
  const [existingAreas] = await conn.execute(
    'SELECT area_id, area_name FROM learning_areas WHERE school_id = ?', [DEMO_SCHOOL_ID]);
  existingAreas.forEach(a => { areaIds[a.area_name] = a.area_id; });
  console.log('✓ Learning areas created');

  // ── SUB-LEARNING AREAS ───────────────────────────────────────
  const subAreas = {
    'English':      [['Language', 1], ['Composition', 2], ['Reading', 3]],
    'Mathematics':  [['Numbers', 1], ['Algebra', 2], ['Geometry', 3], ['Measurement', 4]],
    'Science':      [['Scientific Investigation', 1], ['Living Things', 2], ['Matter & Energy', 3]],
  };
  const subAreaIds = {};
  for (const [areaName, subs] of Object.entries(subAreas)) {
    if (!areaIds[areaName]) continue;
    subAreaIds[areaName] = {};
    for (const [subName, order] of subs) {
      const [r] = await conn.execute(`INSERT IGNORE INTO sub_learning_areas
        (area_id, sub_area_name, display_order) VALUES (?, ?, ?)`,
        [areaIds[areaName], subName, order]);
      if (r.insertId) subAreaIds[areaName][subName] = r.insertId;
    }
  }
  // fetch existing sub areas
  const [existingSubs] = await conn.execute(
    `SELECT sla.sub_area_id, sla.sub_area_name, la.area_name
     FROM sub_learning_areas sla JOIN learning_areas la ON sla.area_id = la.area_id
     WHERE la.school_id = ?`, [DEMO_SCHOOL_ID]);
  existingSubs.forEach(s => {
    if (!subAreaIds[s.area_name]) subAreaIds[s.area_name] = {};
    subAreaIds[s.area_name][s.sub_area_name] = s.sub_area_id;
  });
  console.log('✓ Sub-learning areas created');

  // ── EXAM SESSION ─────────────────────────────────────────────
  const [sessionResult] = await conn.execute(`INSERT IGNORE INTO exam_sessions
    (school_id, class_id, term, academic_year, exam_name, exam_type, status, created_by)
    VALUES (?, ?, 'Term 1', ?, 'End Term 1 2026', 'End Term', 'Closed', 'TCHWX001')`,
    [DEMO_SCHOOL_ID, grade4Id, DEMO_YEAR]);
  let sessionId = sessionResult.insertId;
  if (!sessionId) {
    const [s] = await conn.execute(
      `SELECT session_id FROM exam_sessions WHERE school_id = ? AND exam_name = 'End Term 1 2026' LIMIT 1`,
      [DEMO_SCHOOL_ID]);
    sessionId = s[0]?.session_id;
  }
  console.log('✓ Exam session created, session_id:', sessionId);

  // ── EXAM RESULTS ─────────────────────────────────────────────
  const scores = {
    'STU000001': { English: [72, 65, 78], Mathematics: [85, 70, 88, 75], Science: [68, 72, 65] },
    'STU000002': { English: [55, 60, 52], Mathematics: [45, 50, 48, 55], Science: [58, 45, 62] },
    'STU000003': { English: [90, 85, 92], Mathematics: [95, 88, 92, 90], Science: [88, 85, 90] },
    'STU000004': { English: [63, 70, 68], Mathematics: [72, 65, 75, 68], Science: [70, 68, 72] },
    'STU000005': { English: [82, 78, 85], Mathematics: [80, 75, 82, 78], Science: [85, 80, 88] },
    'STU000006': { English: [48, 52, 45], Mathematics: [55, 48, 52, 60], Science: [50, 55, 48] },
    'STU000007': { English: [76, 72, 80], Mathematics: [68, 72, 75, 70], Science: [75, 70, 78] },
    'STU000008': { English: [60, 65, 58], Mathematics: [62, 58, 65, 60], Science: [65, 60, 68] },
    'STU000009': { English: [88, 82, 90], Mathematics: [85, 82, 88, 85], Science: [80, 85, 82] },
    'STU000010': { English: [70, 68, 72], Mathematics: [75, 70, 78, 72], Science: [72, 68, 75] },
  };

  for (const [studentId, areaScores] of Object.entries(scores)) {
    for (const [areaName, scoreList] of Object.entries(areaScores)) {
      const subs = Object.entries(subAreaIds[areaName] || {});
      for (let i = 0; i < subs.length && i < scoreList.length; i++) {
        const [, subId] = subs[i];
        const score = scoreList[i];
        const outOf = 100;
        const pct = score / outOf;
        const level = pct >= 0.8 ? 'EE' : pct >= 0.6 ? 'ME' : pct >= 0.4 ? 'AE' : 'BE';
        if (sessionId) {
          await conn.execute(`INSERT IGNORE INTO exam_results
            (session_id, student_id, sub_area_id, score, out_of, performance_level, entered_by)
            VALUES (?, ?, ?, ?, ?, ?, 'TCHWX002')`,
            [sessionId, studentId, subId, score, outOf, level]);
        }
      }
    }
  }
  console.log('✓ Exam results seeded');

  // ── ATTENDANCE (last 5 days) ──────────────────────────────────
  const today = new Date();
  for (let d = 4; d >= 0; d--) {
    const date = new Date(today);
    date.setDate(today.getDate() - d);
    const dateStr = date.toISOString().split('T')[0];
    // Skip weekends
    if (date.getDay() === 0 || date.getDay() === 6) continue;

    for (const [studentId] of students) {
      // 85% attendance rate
      const status = Math.random() > 0.15 ? 'Present' : 'Absent';
      const markedAt = new Date(date);
      markedAt.setHours(7, 30 + Math.floor(Math.random() * 30), 0, 0);
      await conn.execute(`INSERT IGNORE INTO attendance_logs
        (student_id, teacher_id, attendance_date, status, marked_at, synced_at)
        VALUES (?, 'TCHWX002', ?, ?, ?, NOW())`,
        [studentId, dateStr, status, markedAt]);
    }
  }
  console.log('✓ Attendance records seeded for last 5 school days');

  // ── FEE STRUCTURES ────────────────────────────────────────────
  const fees = [
    ['Tuition Fee', 5000, 'Term 1'],
    ['Activity Fee', 500, 'Term 1'],
    ['Lunch Fee', 1500, 'Term 1'],
  ];
  const feeIds = [];
  for (const [name, amount, term] of fees) {
    const [r] = await conn.execute(`INSERT IGNORE INTO fee_structures
      (school_id, fee_name, amount, term, academic_year) VALUES (?, ?, ?, ?, ?)`,
      [DEMO_SCHOOL_ID, name, amount, term, DEMO_YEAR]);
    if (r.insertId) feeIds.push({ id: r.insertId, amount });
  }
  console.log('✓ Fee structures created');

  // ── PAYMENT (demo — Amina Hassan's parent paid) ───────────────
  await conn.execute(`INSERT IGNORE INTO payment_ledger
    (transaction_reference, amount, parent_phone, student_reference, payment_method, school_id, term, academic_year, logged_at)
    VALUES ('DEMO-PAY-001', 5000, '254712345678', 'STU000001', 'M-Pesa', ?, 'Term 1', ?, DATE_SUB(NOW(), INTERVAL 3 DAY))`,
    [DEMO_SCHOOL_ID, DEMO_YEAR]);
  console.log('✓ Demo fee payment recorded');

  // ── SCHOOL TERMS ─────────────────────────────────────────────
  await conn.execute(`INSERT IGNORE INTO school_terms
    (school_id, term_name, start_date, end_date, academic_year)
    VALUES (?, 'Term 1', '2026-01-06', '2026-04-04', ?)`,
    [DEMO_SCHOOL_ID, DEMO_YEAR]);
  await conn.execute(`INSERT IGNORE INTO school_terms
    (school_id, term_name, start_date, end_date, academic_year)
    VALUES (?, 'Term 2', '2026-05-04', '2026-08-07', ?)`,
    [DEMO_SCHOOL_ID, DEMO_YEAR]);
  await conn.execute(`INSERT IGNORE INTO school_terms
    (school_id, term_name, start_date, end_date, academic_year)
    VALUES (?, 'Term 3', '2026-09-07', '2026-11-20', ?)`,
    [DEMO_SCHOOL_ID, DEMO_YEAR]);
  console.log('✓ School terms seeded');

  // ── RUBRIC CONFIG ────────────────────────────────────────────
  const rubric = [
    ['EE', 80.0, 'Exceeding Expectations', '#2E7D32'],
    ['ME', 60.0, 'Meeting Expectations',   '#1565C0'],
    ['AE', 40.0, 'Approaching Expectations','#E65100'],
    ['BE',  0.0, 'Below Expectations',      '#C62828'],
  ];
  for (const [code, min, label, color] of rubric) {
    await conn.execute(`INSERT IGNORE INTO school_rubric_config
      (school_id, level_code, min_percent, label, color) VALUES (?, ?, ?, ?, ?)`,
      [DEMO_SCHOOL_ID, code, min, label, color]);
  }
  console.log('✓ Rubric config seeded');

  await conn.end();

  console.log('\n════════════════════════════════════════════');
  console.log('  DEMO SCHOOL READY');
  console.log('════════════════════════════════════════════');
  console.log('  School:      Greenfield Academy');
  console.log('  School ID:   DEM000001');
  console.log('  Headteacher: jonathankiranga@gmail.com');
  console.log('  Phone:       254712345678');
  console.log('  Class:       Grade 4 — 10 students');
  console.log('  Parent:      254712345678 (premium, linked to Amina Hassan)');
  console.log('════════════════════════════════════════════\n');
}

main().catch(e => { console.error('Seed failed:', e.message); process.exit(1); });
