require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mysql = require('mysql2/promise');

const poolConfig = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '4000'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'false' ? false : (
    process.env.DB_SSL_CA
      ? { ca: process.env.DB_SSL_CA }
      : { minVersion: 'TLSv1.2' }
  ),
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0
};

const pool = mysql.createPool(poolConfig);

const DEMO_SCHOOL_ID = 'DEM000001';
const DEMO_YEAR = 2026;
const TEST_EMAIL = 'jonathankiranga@gmail.com';
const TEST_PHONE = '2547XXXXXXXX';  // <-- REPLACE with your real phone for parent/bazar OTP

const log = [];

async function seed() {
  const db = pool;

  // Validate phone
  if (TEST_PHONE.includes('XXXXXXXX')) {
    console.error('\n❌ PLEASE UPDATE TEST_PHONE in this script');
    console.error('Replace 2547XXXXXXXX with your real phone number for parent/bazar portal OTP\n');
    process.exit(1);
  }

  try {
    // ============================================================
    // 1. SCHOOL
    // ============================================================
    await db.execute(`INSERT IGNORE INTO schools
      (school_id, school_name, region, contact_name, contact_phone, contact_email)
      VALUES (?, 'Greenfield Academy', 'Nairobi', 'Jonathan Kiranga', ?, ?)`,
      [DEMO_SCHOOL_ID, TEST_PHONE, TEST_EMAIL]);
    log.push(`✓ School: Greenfield Academy (contact: ${TEST_EMAIL} / ${TEST_PHONE})`);

    // ============================================================
    // 2. TEACHERS (use EMAIL for OTP)
    // ============================================================
    // Headteacher - uses YOUR email for OTP
    await db.execute(`INSERT IGNORE INTO teachers
      (teacher_id, full_name, phone, email, role, school_id, active)
      VALUES ('TCHWX001', 'Jonathan Kiranga', '', ?, 'head', ?, 1)`,
      [TEST_EMAIL, DEMO_SCHOOL_ID]);
    log.push(`✓ Headteacher: ${TEST_EMAIL} (OTP via email)`);

    // Class teacher - uses YOUR email for OTP (same email works for both)
    await db.execute(`INSERT IGNORE INTO teachers
      (teacher_id, full_name, phone, email, role, school_id, active)
      VALUES ('TCHWX002', 'Mary Wanjiku', '', ?, 'teacher', ?, 1)`,
      [TEST_EMAIL, DEMO_SCHOOL_ID]);
    log.push(`✓ Teacher: ${TEST_EMAIL} (OTP via email)`);

    // ============================================================
    // 3. CLASSES
    // ============================================================
    const classes = [
      ['Grade 1', 1], ['Grade 2', 2], ['Grade 3', 3],
      ['Grade 4', 4], ['Grade 5', 5], ['Grade 6', 6]
    ];
    for (const [name, rank] of classes) {
      await db.execute(`INSERT IGNORE INTO classes (school_id, class_name, level_name, academic_year, class_rank)
        VALUES (?, ?, ?, ?, ?)`, [DEMO_SCHOOL_ID, name, name, DEMO_YEAR, rank]);
    }
    const [classRows] = await db.execute('SELECT class_id, class_name FROM classes WHERE school_id = ?', [DEMO_SCHOOL_ID]);
    const classIds = {};
    classRows.forEach(c => { classIds[c.class_name] = c.class_id; });
    const grade6Id = classIds['Grade 6'];
    log.push('✓ Classes: Grade 1–6');

    // ============================================================
    // 4. STUDENTS (distributed across Grade 1-6)
    // ============================================================
    const students = [
      ['STU000001', 'Amina Hassan', 'Female', 'Grade 1'],
      ['STU000002', 'Brian Ochieng', 'Male', 'Grade 1'],
      ['STU000003', 'Cynthia Mwangi', 'Female', 'Grade 2'],
      ['STU000004', 'David Kamau', 'Male', 'Grade 2'],
      ['STU000005', 'Esther Njeri', 'Female', 'Grade 3'],
      ['STU000006', 'Francis Otieno', 'Male', 'Grade 3'],
      ['STU000007', 'Grace Akinyi', 'Female', 'Grade 4'],
      ['STU000008', 'Hassan Abdi', 'Male', 'Grade 4'],
      ['STU000009', 'Irene Waithera', 'Female', 'Grade 5'],
      ['STU000010', 'James Kariuki', 'Male', 'Grade 5'],
    ];
    for (const [id, name, gender, gradeName] of students) {
      await db.execute(`INSERT IGNORE INTO students
        (student_id, full_name, class_id, school_id, gender, enrollment_status)
        VALUES (?, ?, ?, ?, ?, 'Active')`, [id, name, classIds[gradeName], DEMO_SCHOOL_ID, gender]);
    }
    log.push(`✓ Students: ${students.length} distributed across Grade 1-5`);

    // Add 2 students in Grade 6 for the teacher portal demo
    const grade6Students = [
      ['STU000011', 'Kevin Mwangi', 'Male', 'Grade 6'],
      ['STU000012', 'Lydia Wanjiru', 'Female', 'Grade 6'],
    ];
    for (const [id, name, gender, gradeName] of grade6Students) {
      await db.execute(`INSERT IGNORE INTO students
        (student_id, full_name, class_id, school_id, gender, enrollment_status)
        VALUES (?, ?, ?, ?, ?, 'Active')`, [id, name, classIds[gradeName], DEMO_SCHOOL_ID, gender]);
    }
    log.push(`✓ Students: ${grade6Students.length} in Grade 6 (teacher's class)`);

    // ============================================================
    // 5. PARENT PROFILE (uses PHONE for OTP - you receive SMS/WhatsApp)
    // ============================================================
    await db.execute(`INSERT IGNORE INTO parent_profiles
      (parent_phone, full_name, is_premium, premium_expires_at)
      VALUES (?, 'Jonathan Kiranga', TRUE, DATE_ADD(NOW(), INTERVAL 6 MONTH))`, [TEST_PHONE]);
    await db.execute(`INSERT IGNORE INTO student_parent_map
      (student_id, parent_phone, relationship) VALUES ('STU000001', ?, 'Parent')`, [TEST_PHONE]);
    log.push(`✓ Parent: ${TEST_PHONE} (premium, OTP via SMS/WhatsApp, linked to Amina Hassan - Grade 1)`);

    // ============================================================
    // 6. LEARNING AREAS & SUB-AREAS (CBC) - for ALL grades
    // ============================================================
    const grades = ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6'];
    const areas = ['English', 'Mathematics', 'Science', 'Social Studies', 'Kiswahili', 'Creative Arts'];
    for (const gradeName of grades) {
      for (const name of areas) {
        await db.execute(`INSERT IGNORE INTO learning_areas (school_id, level_name, area_name)
          VALUES (?, ?, ?)`, [DEMO_SCHOOL_ID, gradeName, name]);
      }
    }
    const [areaRows] = await db.execute('SELECT area_id, area_name FROM learning_areas WHERE school_id = ?', [DEMO_SCHOOL_ID]);
    const areaIds = {};
    areaRows.forEach(a => { areaIds[a.area_name] = a.area_id; });
    log.push('✓ Learning areas: ' + areas.join(', '));

    const subDefs = {
      'English':     [['Language', 1], ['Composition', 2], ['Reading', 3]],
      'Mathematics': [['Numbers', 1], ['Algebra', 2], ['Geometry', 3], ['Measurement', 4]],
      'Science':     [['Scientific Investigation', 1], ['Living Things', 2], ['Matter & Energy', 3]],
    };
    for (const [aName, subs] of Object.entries(subDefs)) {
      if (!areaIds[aName]) continue;
      for (const [sName, order] of subs) {
        await db.execute(`INSERT IGNORE INTO sub_learning_areas (area_id, sub_area_name, display_order)
          VALUES (?, ?, ?)`, [areaIds[aName], sName, order]);
      }
    }
    const [subRows] = await db.execute(
      `SELECT sla.sub_area_id, sla.sub_area_name, la.area_name
       FROM sub_learning_areas sla JOIN learning_areas la ON sla.area_id = la.area_id
       WHERE la.school_id = ?`, [DEMO_SCHOOL_ID]);
    const subAreaIds = {};
    subRows.forEach(s => {
      if (!subAreaIds[s.area_name]) subAreaIds[s.area_name] = {};
      subAreaIds[s.area_name][s.sub_area_name] = s.sub_area_id;
    });
    log.push('✓ Sub-learning areas seeded');

    // ============================================================
    // 7. EXAM SESSION & RESULTS (Grade 6 - teacher's class)
    // ============================================================
    await db.execute(`INSERT IGNORE INTO exam_sessions
      (school_id, class_id, term, academic_year, exam_name, exam_type, status, created_by)
      VALUES (?, ?, 'Term 1', ?, 'End Term 1 2026', 'End Term', 'Closed', 'TCHWX001')`,
      [DEMO_SCHOOL_ID, grade6Id, DEMO_YEAR]);
    const [[sessionRow]] = await db.execute(
      `SELECT session_id FROM exam_sessions WHERE school_id = ? AND exam_name = 'End Term 1 2026' LIMIT 1`,
      [DEMO_SCHOOL_ID]);
    const sessionId = sessionRow?.session_id;
    log.push('✓ Exam session: End Term 1 2026');

    const scores = {
      // CBC: Each sub-strand assessed individually with raw scores (not percentages)
      // English: Language (20), Composition (20), Reading (20) = Total 60
      // Mathematics: Numbers (25), Algebra (25), Geometry (25), Measurement (25) = Total 100
      // Science: Scientific Investigation (20), Living Things (20), Matter & Energy (20) = Total 60
      'STU000011': {
        English:     [16, 14, 17],  // Language, Composition, Reading (out of 20 each)
        Mathematics: [22, 18, 23, 20],  // Numbers, Algebra, Geometry, Measurement (out of 25 each)
        Science:     [15, 16, 14],  // Scientific Investigation, Living Things, Matter & Energy (out of 20 each)
      },
      'STU000012': {
        English:     [18, 17, 19],
        Mathematics: [24, 22, 24, 23],
        Science:     [18, 17, 18],
      },
    };
    const maxScores = {
      English:     [20, 20, 20],
      Mathematics: [25, 25, 25, 25],
      Science:     [20, 20, 20],
    };
    if (sessionId) {
      for (const [studentId, areaScores] of Object.entries(scores)) {
        for (const [aName, scoreList] of Object.entries(areaScores)) {
          const subs = Object.entries(subAreaIds[aName] || {});
          const maxList = maxScores[aName] || [];
          for (let i = 0; i < subs.length && i < scoreList.length; i++) {
            const subId = subs[i][1];
            const score = scoreList[i];
            const outOf = maxList[i] || 20;
            // CBC: Performance level per sub-strand based on rubric percentage
            const pct = (score / outOf) * 100;
            const level = pct >= 80 ? 'EE' : pct >= 60 ? 'ME' : pct >= 40 ? 'AE' : 'BE';
            await db.execute(`INSERT IGNORE INTO exam_results
              (session_id, student_id, sub_area_id, score, out_of, performance_level, entered_by)
              VALUES (?, ?, ?, ?, ?, ?, 'TCHWX002')`,
              [sessionId, studentId, subId, score, outOf, level]);
          }
        }
      }
    }
    log.push('✓ Exam results seeded for Grade 6 students (CBC: raw scores per sub-strand, not averaged)');

    // ============================================================
    // 7b. CBC ASSESSMENTS (Formative/Summative) - using strands/sub_strands
    // ============================================================
    // Create strands for Grade 6
    const strandDefs = {
      'English':     [['Listening & Speaking', 'Term 1'], ['Reading', 'Term 1'], ['Writing', 'Term 1']],
      'Mathematics': [['Numbers & Operations', 'Term 1'], ['Algebra', 'Term 1'], ['Geometry', 'Term 1'], ['Measurement', 'Term 1']],
      'Science':     [['Living Things', 'Term 1'], ['Matter & Energy', 'Term 1'], ['Earth & Space', 'Term 1']],
    };
    const strandIds = {};
    for (const [aName, strands] of Object.entries(strandDefs)) {
      const areaId = areaIds[aName];
      if (!areaId) continue;
      for (const [sName, term] of strands) {
        await db.execute(`INSERT IGNORE INTO strands (area_id, strand_name, term)
          VALUES (?, ?, ?)`, [areaId, sName, term]);
      }
    }
    const [strandRows] = await db.execute(
      `SELECT s.strand_id, s.strand_name, la.area_name
       FROM strands s JOIN learning_areas la ON s.area_id = la.area_id
       WHERE la.school_id = ?`, [DEMO_SCHOOL_ID]);
    strandRows.forEach(s => {
      if (!strandIds[s.area_name]) strandIds[s.area_name] = {};
      strandIds[s.area_name][s.strand_name] = s.strand_id;
    });
    log.push('✓ Strands seeded');

    // Create sub-strands
    const subStrandDefs = {
      'English': {
        'Listening & Speaking': ['Listening Comprehension', 'Oral Expression'],
        'Reading': ['Decoding', 'Reading Comprehension'],
        'Writing': ['Handwriting', 'Creative Writing'],
      },
      'Mathematics': {
        'Numbers & Operations': ['Whole Numbers', 'Fractions', 'Decimals'],
        'Algebra': ['Patterns', 'Simple Equations'],
        'Geometry': ['Shapes', 'Angles', 'Symmetry'],
        'Measurement': ['Length', 'Mass', 'Capacity', 'Time'],
      },
      'Science': {
        'Living Things': ['Plants', 'Animals', 'Human Body'],
        'Matter & Energy': ['States of Matter', 'Energy Forms', 'Forces'],
        'Earth & Space': ['Weather', 'Solar System'],
      },
    };
    const subStrandIds = {};
    for (const [aName, strands] of Object.entries(subStrandDefs)) {
      for (const [sName, subStrands] of Object.entries(strands)) {
        const strandId = strandIds[aName]?.[sName];
        if (!strandId) continue;
        for (const ssName of subStrands) {
          await db.execute(`INSERT IGNORE INTO sub_strands (strand_id, sub_strand_name)
            VALUES (?, ?)`, [strandId, ssName]);
        }
      }
    }
    const [subStrandRows] = await db.execute(
      `SELECT ss.sub_strand_id, ss.sub_strand_name, s.strand_name, la.area_name
       FROM sub_strands ss
       JOIN strands s ON ss.strand_id = s.strand_id
       JOIN learning_areas la ON s.area_id = la.area_id
       WHERE la.school_id = ?`, [DEMO_SCHOOL_ID]);
    subStrandRows.forEach(ss => {
      if (!subStrandIds[ss.area_name]) subStrandIds[ss.area_name] = {};
      if (!subStrandIds[ss.area_name][ss.strand_name]) subStrandIds[ss.area_name][ss.strand_name] = {};
      subStrandIds[ss.area_name][ss.strand_name][ss.sub_strand_name] = ss.sub_strand_id;
    });
    log.push('✓ Sub-strands seeded');

    // Create assessments for Grade 6
    const assessmentDefs = {
      'English': {
        'Listening & Speaking': [
          { name: 'Listening Comprehension Task 1', max: 10, type: 'Formative' },
          { name: 'Oral Presentation', max: 15, type: 'Summative' },
        ],
        'Reading': [
          { name: 'Decoding Assessment', max: 10, type: 'Formative' },
          { name: 'Reading Comprehension Test', max: 20, type: 'Summative' },
        ],
        'Writing': [
          { name: 'Handwriting Practice', max: 5, type: 'Formative' },
          { name: 'Creative Writing Piece', max: 20, type: 'Summative' },
        ],
      },
      'Mathematics': {
        'Numbers & Operations': [
          { name: 'Whole Numbers Quiz', max: 10, type: 'Formative' },
          { name: 'Fractions Test', max: 15, type: 'Summative' },
          { name: 'Decimals Worksheet', max: 10, type: 'Formative' },
        ],
        'Algebra': [
          { name: 'Patterns Exercise', max: 10, type: 'Formative' },
          { name: 'Simple Equations Test', max: 15, type: 'Summative' },
        ],
        'Geometry': [
          { name: 'Shapes Identification', max: 10, type: 'Formative' },
          { name: 'Angles & Symmetry Test', max: 15, type: 'Summative' },
        ],
        'Measurement': [
          { name: 'Length & Mass Practical', max: 10, type: 'Formative' },
          { name: 'Capacity & Time Test', max: 15, type: 'Summative' },
        ],
      },
      'Science': {
        'Living Things': [
          { name: 'Plant Observation', max: 10, type: 'Formative' },
          { name: 'Animal Classification Test', max: 15, type: 'Summative' },
          { name: 'Human Body Quiz', max: 10, type: 'Formative' },
        ],
        'Matter & Energy': [
          { name: 'States of Matter Experiment', max: 10, type: 'Formative' },
          { name: 'Energy Forms Test', max: 15, type: 'Summative' },
          { name: 'Forces Investigation', max: 10, type: 'Formative' },
        ],
        'Earth & Space': [
          { name: 'Weather Chart', max: 10, type: 'Formative' },
          { name: 'Solar System Model', max: 15, type: 'Summative' },
        ],
      },
    };
    const assessmentIds = {};
    for (const [aName, strands] of Object.entries(assessmentDefs)) {
      for (const [sName, assessments] of Object.entries(strands)) {
        const strandId = strandIds[aName]?.[sName];
        if (!strandId) continue;
        for (const assess of assessments) {
          const [result] = await db.execute(`INSERT IGNORE INTO assessments
            (sub_strand_id, assessment_name, max_score, date, type, class_id, teacher_id)
            VALUES (?, ?, ?, '2026-03-15', ?, ?, 'TCHWX002')`,
            [strandId, assess.name, assess.max, assess.type, grade6Id]);
          if (result.insertId) {
            if (!assessmentIds[aName]) assessmentIds[aName] = {};
            if (!assessmentIds[aName][sName]) assessmentIds[aName][sName] = [];
            assessmentIds[aName][sName].push({ id: result.insertId, max: assess.max });
          }
        }
      }
    }
    log.push('✓ Assessments created for Grade 6');

    // Assessment results - CBC: raw scores per sub-strand, SUMMED not averaged
    const assessmentScores = {
      'STU000011': {
        English: {
          'Listening & Speaking': [8, 12],
          'Reading': [7, 16],
          'Writing': [4, 17],
        },
        Mathematics: {
          'Numbers & Operations': [8, 12, 8],
          'Algebra': [7, 11],
          'Geometry': [8, 12],
          'Measurement': [7, 11],
        },
        Science: {
          'Living Things': [8, 12, 7],
          'Matter & Energy': [7, 11, 8],
          'Earth & Space': [8, 12],
        },
      },
      'STU000012': {
        English: {
          'Listening & Speaking': [9, 14],
          'Reading': [9, 18],
          'Writing': [5, 18],
        },
        Mathematics: {
          'Numbers & Operations': [9, 14, 9],
          'Algebra': [9, 13],
          'Geometry': [9, 14],
          'Measurement': [9, 13],
        },
        Science: {
          'Living Things': [9, 13, 8],
          'Matter & Energy': [8, 13, 9],
          'Earth & Space': [9, 14],
        },
      },
    };
    for (const [studentId, areas] of Object.entries(assessmentScores)) {
      for (const [aName, strands] of Object.entries(areas)) {
        for (const [sName, scores] of Object.entries(strands)) {
          const assessments = assessmentIds[aName]?.[sName] || [];
          for (let i = 0; i < assessments.length && i < scores.length; i++) {
            const assess = assessments[i];
            const score = scores[i];
            const pct = (score / assess.max) * 100;
            const level = pct >= 80 ? 'EE' : pct >= 60 ? 'ME' : pct >= 40 ? 'AE' : 'BE';
            await db.execute(`INSERT IGNORE INTO assessment_results
              (assessment_id, student_id, score, performance_level)
              VALUES (?, ?, ?, ?)`,
              [assess.id, studentId, score, level]);
          }
        }
      }
    }
    log.push('✓ Assessment results seeded (CBC: raw scores per sub-strand, SUMMED not averaged)');

    // ============================================================
    // 8. ATTENDANCE (last 5 weekdays)
    // ============================================================
    try {
      await db.execute(`ALTER TABLE attendance_logs ADD COLUMN marked_at DATETIME NULL AFTER status`);
      log.push('✓ Migration: added marked_at column to attendance_logs');
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME' || e.message.includes('Duplicate column')) {
        log.push('✓ marked_at column already exists');
      } else {
        log.push(`⚠ marked_at migration skipped: ${e.message}`);
      }
    }

    const today = new Date();
    // Seed attendance for Grade 6 students (teacher's class)
    const grade6StudentIds = ['STU000011', 'STU000012'];
    for (let d = 4; d >= 0; d--) {
      const date = new Date(today);
      date.setDate(today.getDate() - d);
      if (date.getDay() === 0 || date.getDay() === 6) continue;
      const dateStr = date.toISOString().split('T')[0];
      for (const studentId of grade6StudentIds) {
        const status = Math.random() > 0.15 ? 'Present' : 'Absent';
        const markedAt = new Date(date);
        markedAt.setHours(7, 30 + Math.floor(Math.random() * 30), 0, 0);
        try {
          await db.execute(`INSERT IGNORE INTO attendance_logs
            (student_id, teacher_id, attendance_date, status, marked_at, synced_at)
            VALUES (?, 'TCHWX002', ?, ?, ?, NOW())`,
            [studentId, dateStr, status, markedAt]);
        } catch (e) {
          await db.execute(`INSERT IGNORE INTO attendance_logs
            (student_id, teacher_id, attendance_date, status, synced_at)
            VALUES (?, 'TCHWX002', ?, ?, NOW())`,
            [studentId, dateStr, status]);
        }
      }
    }
    log.push('✓ Attendance seeded for Grade 6 students (last 5 school days)');

    // ============================================================
    // 9. FEES
    // ============================================================
    const fees = [['Tuition Fee', 5000], ['Activity Fee', 500], ['Lunch Fee', 1500]];
    for (const [name, amount] of fees) {
      await db.execute(`INSERT IGNORE INTO fee_structures
        (school_id, fee_name, amount, term, academic_year) VALUES (?, ?, ?, 'Term 1', ?)`,
        [DEMO_SCHOOL_ID, name, amount, DEMO_YEAR]);
    }
    log.push('✓ Fee structures seeded');

    // ============================================================
    // 10. DEMO PAYMENT
    // ============================================================
    await db.execute(`INSERT IGNORE INTO payment_ledger
      (transaction_reference, amount, parent_phone, student_reference, payment_method, school_id, term, academic_year, logged_at)
      VALUES ('DEMO-PAY-001', 5000, ?, 'STU000001', 'M-Pesa', ?, 'Term 1', ?, DATE_SUB(NOW(), INTERVAL 3 DAY))`,
      [TEST_PHONE, DEMO_SCHOOL_ID, DEMO_YEAR]);
    log.push(`✓ Demo payment: KSh 5,000 for Amina Hassan (parent: ${TEST_PHONE})`);

    // ============================================================
    // 11. SCHOOL TERMS
    // ============================================================
    await db.execute(`INSERT IGNORE INTO school_terms (school_id, term_name, start_date, end_date, academic_year)
      VALUES (?, 'Term 1', '2026-01-06', '2026-04-04', ?)`, [DEMO_SCHOOL_ID, DEMO_YEAR]);
    await db.execute(`INSERT IGNORE INTO school_terms (school_id, term_name, start_date, end_date, academic_year)
      VALUES (?, 'Term 2', '2026-05-04', '2026-08-07', ?)`, [DEMO_SCHOOL_ID, DEMO_YEAR]);
    await db.execute(`INSERT IGNORE INTO school_terms (school_id, term_name, start_date, end_date, academic_year)
      VALUES (?, 'Term 3', '2026-09-07', '2026-11-20', ?)`, [DEMO_SCHOOL_ID, DEMO_YEAR]);
    log.push('✓ School terms: Term 1, 2, 3 for 2026');

    // ============================================================
    // 12. RUBRIC CONFIG (CBC)
    // ============================================================
    const rubric = [['EE',80,'Exceeding Expectations','#2E7D32'],['ME',60,'Meeting Expectations','#1565C0'],['AE',40,'Approaching Expectations','#E65100'],['BE',0,'Below Expectations','#C62828']];
    for (const [code, min, label, color] of rubric) {
      await db.execute(`INSERT IGNORE INTO school_rubric_config (school_id, level_code, min_percent, label, color)
        VALUES (?, ?, ?, ?, ?)`, [DEMO_SCHOOL_ID, code, min, label, color]);
    }
    log.push('✓ Rubric config seeded');

    console.log('\n=== SEED COMPLETE ===');
    log.forEach(l => console.log(l));
    console.log('\n=== DEMO CREDENTIALS ===');
    console.log('School: Greenfield Academy');
    console.log('School ID:', DEMO_SCHOOL_ID);
    console.log('');
    console.log('📧 HEADTEACHER PORTAL (teacher.smarternowapps.co.ke):');
    console.log(`   Email: ${TEST_EMAIL}  ← Request OTP here`);
    console.log('   Teacher ID: TCHWX001');
    console.log('   Role: head');
    console.log('');
    console.log('📧 TEACHER PORTAL (teacher.smarternowapps.co.ke):');
    console.log(`   Email: ${TEST_EMAIL}  ← Request OTP here (same email works)`);
    console.log('   Teacher ID: TCHWX002');
    console.log('   Role: teacher');
    console.log('   Class: Grade 6 (students: Kevin Mwangi, Lydia Wanjiru)');
    console.log('');
    console.log('📱 PARENT / BAZAR PORTAL (parent.smarternowapps.co.ke / bazar.smarternowapps.co.ke):');
    console.log(`   Phone: ${TEST_PHONE}  ← Request OTP here (SMS/WhatsApp)`);
    console.log('   Student: Amina Hassan (STU000001) - Grade 1');
    console.log('   Premium: YES (6 months)');
    console.log('');
    console.log('📊 STUDENT DISTRIBUTION:');
    console.log('  Grade 1: Amina Hassan, Brian Ochieng');
    console.log('  Grade 2: Cynthia Mwangi, David Kamau');
    console.log('  Grade 3: Esther Njeri, Francis Otieno');
    console.log('  Grade 4: Grace Akinyi, Hassan Abdi');
    console.log('  Grade 5: Irene Waithera, James Kariuki');
    console.log('  Grade 6: Kevin Mwangi, Lydia Wanjiru (teacher\'s class with exam results & attendance)');
    console.log('');
    console.log('All grades have CBC learning areas. Grade 6 has exam results & attendance data.');

  } catch (err) {
    console.error('[SEED ERROR]', err.message);
    console.error(err.stack);
  } finally {
    await pool.end();
  }
}

seed();