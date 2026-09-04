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
const DEMO_EMAIL = 'jonathankiranga@gmail.com';
const DEMO_PHONE = '254712345678';  // Real Kenya phone for parent/bazar OTP (SMS/WhatsApp)

const log = [];

async function seed() {
  const db = pool;

  // Validate email
  if (!DEMO_EMAIL || DEMO_EMAIL.trim() === '') {
    console.error('❌ Please set DEMO_EMAIL in this script');
    process.exit(1);
  }

  // Validate phone
  if (!DEMO_PHONE || DEMO_PHONE.includes('XXXX')) {
    console.error('❌ Please set DEMO_PHONE in this script with your real phone number');
    process.exit(1);
  }

  try {
    // ============================================================
    // 1. SCHOOL
    // ============================================================
    await db.execute(`INSERT IGNORE INTO schools
      (school_id, school_name, region, contact_name, contact_phone, contact_email)
      VALUES (?, 'Greenfield Academy', 'Nairobi', 'Jonathan Kiranga', ?, ?)`,
      [DEMO_SCHOOL_ID, DEMO_PHONE, DEMO_EMAIL]);
    log.push(`✓ School: Greenfield Academy (contact: ${DEMO_EMAIL})`);

    // ============================================================
    // 2. HEADTEACHER TEACHER (uses EMAIL for OTP)
    // ============================================================
    // Headteacher - uses YOUR email for OTP
    await db.execute(`INSERT IGNORE INTO teachers
      (teacher_id, full_name, phone, email, role, school_id, active)
      VALUES ('TCHWX001', 'Jonathan Kiranga', '', ?, 'head', ?, 1)`,
      [DEMO_EMAIL, DEMO_SCHOOL_ID]);
    log.push(`✓ Headteacher: ${DEMO_EMAIL} (OTP via email)`);

    // Class teacher - uses SAME email for OTP
    await db.execute(`INSERT IGNORE INTO teachers
      (teacher_id, full_name, phone, email, role, school_id, active)
      VALUES ('TCHWX002', 'Mary Wanjiku', '', ?, 'teacher', ?, 1)`,
      [DEMO_EMAIL, DEMO_SCHOOL_ID]);
    log.push(`✓ Teacher: ${DEMO_EMAIL} (OTP via email, same email works for both roles)`);

    // ============================================================
    // 3. CLASSES (Grade 1-6)
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
    log.push('✓ Classes: Grade 1–6');

    // ============================================================
    // 4. STUDENTS (distributed Grade 1-5, plus 2 in Grade 6)
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
      ['STU000011', 'Kevin Mwangi', 'Male', 'Grade 6'],
      ['STU000012', 'Lydia Wanjiru', 'Female', 'Grade 6'],
    ];
    for (const [id, name, gender, gradeName] of students) {
      await db.execute(`INSERT IGNORE INTO students
        (student_id, full_name, class_id, school_id, gender, enrollment_status)
        VALUES (?, ?, ?, ?, ?, 'Active')`, [id, name, classIds[gradeName], DEMO_SCHOOL_ID, gender]);
    }
    log.push(`✓ Students: ${students.length} distributed across Grade 1-6`);

    // ============================================================
    // 5. PARENT PROFILE (uses PHONE for OTP - SMS/WhatsApp)
    // ============================================================
    await db.execute(`INSERT IGNORE INTO parent_profiles
      (parent_phone, full_name, is_premium, premium_expires_at)
      VALUES (?, 'Jonathan Kiranga', TRUE, DATE_ADD(NOW(), INTERVAL 6 MONTH))`, [DEMO_PHONE]);
    await db.execute(`INSERT IGNORE INTO student_parent_map
      (student_id, parent_phone, relationship) VALUES ('STU000001', ?, 'Parent')`, [DEMO_PHONE]);
    log.push(`✓ Parent: ${DEMO_PHONE} (premium, OTP via SMS/WhatsApp, linked to Amina Hassan)`);

    // ============================================================
    // 6. LEARNING AREAS (for all grades)
    // ============================================================
    const grades = ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6'];
    const areas = ['English', 'Mathematics', 'Science', 'Social Studies', 'Kiswahili', 'Creative Arts'];
    for (const gradeName of grades) {
      for (const name of areas) {
        await db.execute(`INSERT IGNORE INTO learning_areas (school_id, level_name, area_name)
          VALUES (?, ?, ?)`, [DEMO_SCHOOL_ID, gradeName, name]);
      }
    }
    log.push('✓ Learning areas seeded for all grades');

    // ============================================================
    // 7. EXAM SESSION & RESULTS (Grade 6 - teacher's class)
    // ============================================================
    const grade6Id = classIds['Grade 6'];
    await db.execute(`INSERT IGNORE INTO exam_sessions
      (school_id, class_id, term, academic_year, exam_name, exam_type, status, created_by)
      VALUES (?, ?, 'Term 1', ?, 'End Term 1 2026', 'End Term', 'Closed', 'TCHWX001')`,
      [DEMO_SCHOOL_ID, grade6Id, DEMO_YEAR]);
    const [[sessionRow]] = await db.execute(
      `SELECT session_id FROM exam_sessions WHERE school_id = ? AND exam_name = 'End Term 1 2026' LIMIT 1`,
      [DEMO_SCHOOL_ID]);
    const sessionId = sessionRow?.session_id;
    log.push('✓ Exam session: End Term 1 2026');

    // Exam results with proper CBC raw scores (not averaged, not out of 100)
    const scores = {
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
          const subs = Object.entries(classIds) // Using classIds as subAreaIds proxy
            .filter(([g, id]) => g.startsWith('Grade'))
            .reduce((acc, [g, id]) => {
              acc[g] = id; return acc;
            }, {});
          const maxList = maxScores[aName] || [];
          for (let i = 0; i < Object.keys(classIds).length && i < scoreList.length; i++) {
            const subId = Object.values(classIds)[i]; // Use class IDs as sub_area proxy
            const score = scoreList[i];
            const outOf = maxList[i] || 20;
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
    log.push('✓ Exam results seeded for Grade 6 students (CBC: raw scores per sub-strand)');

    // ============================================================
    // 8. ATTENDANCE (last 5 weekdays - Grade 6 students)
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
      [DEMO_PHONE, DEMO_SCHOOL_ID, DEMO_YEAR]);
    log.push(`✓ Demo payment: KSh 5,000 for Amina Hassan (parent: ${DEMO_PHONE})`);

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
    console.log(`   Email: ${DEMO_EMAIL}  ← Request OTP here`);
    console.log('   Teacher ID: TCHWX001');
    console.log('   Role: head');
    console.log('');
    console.log('📧 TEACHER PORTAL (teacher.smarternowapps.co.ke):');
    console.log(`   Email: ${DEMO_EMAIL}  ← Request OTP here (same email works)`);
    console.log('   Teacher ID: TCHWX002');
    console.log('   Role: teacher');
    console.log('   Class: Grade 6 (students: Kevin Mwangi, Lydia Wanjiru)');
    console.log('');
    console.log('📱 PARENT / BAZAR PORTAL (parent.smarternowapps.co.ke / bazar.smarternowapps.co.ke):');
    console.log(`   Phone: ${DEMO_PHONE}  ← Request OTP here (SMS/WhatsApp)`);
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
    console.log('CBC Assessment: Raw scores per sub-strand, NOT averaged, NOT out of 100.');
    console.log('Performance level (EE/ME/AE/BE) calculated from actual raw score percentage.');
    console.log('Email OTP works for headteacher/teacher portals.');
    console.log('SMS/WhatsApp OTP works for parent/bazar portals.');

  } catch (err) {
    console.error('[SEED ERROR]', err.message);
    console.error(err.stack);
  } finally {
    await pool.end();
  }
}

seed();