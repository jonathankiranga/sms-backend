/**
 * CBC Kenya curriculum seed data.
 *
 * Covers PP1–PP2 (Pre-Primary), Grade 1–6 (Lower Primary),
 * and Grade 7–9 (Junior Secondary), with subjects and
 * sub-learning areas for each level.
 *
 * Every entry has at least 3 subjects and each subject has
 * at least 3 sub-areas so the CAT score-entry grid is always
 * useful out of the box.
 */

const CBC_LEVEL_DATA = {
  // ─── PRE-PRIMARY ────────────────────────────────────────────────
  'PP1': {
    areas: [
      'Language Activities',
      'Mathematical Activities',
      'Environmental Activities',
      'Psychomotor and Creative Activities',
      'Religious Education',
    ],
    subs: {
      'Language Activities':                ['Listening', 'Speaking', 'Reading'],
      'Mathematical Activities':            ['Number Work', 'Measurement', 'Geometry'],
      'Environmental Activities':           ['Our Environment', 'Living Things', 'Plants and Animals'],
      'Psychomotor and Creative Activities':['Creative Arts', 'Physical Activities', 'Music and Movement'],
      'Religious Education':                ['Bible Stories', 'Values', 'Prayer'],
    },
  },

  'PP2': {
    areas: [
      'Language Activities',
      'Mathematical Activities',
      'Environmental Activities',
      'Psychomotor and Creative Activities',
      'Religious Education',
    ],
    subs: {
      'Language Activities':                ['Listening', 'Speaking', 'Reading', 'Writing'],
      'Mathematical Activities':            ['Number Work', 'Measurement', 'Geometry'],
      'Environmental Activities':           ['Our Environment', 'Living Things', 'Weather and Seasons'],
      'Psychomotor and Creative Activities':['Creative Arts', 'Physical Activities', 'Music and Movement'],
      'Religious Education':                ['Bible Stories', 'Values', 'Prayer'],
    },
  },

  // ─── LOWER PRIMARY (Grades 1–3) ─────────────────────────────────
  'Grade 1': {
    areas: [
      'English',
      'Mathematics',
      'Environmental Activities',
      'Kiswahili',
      'Creative Arts',
      'Religious Education',
    ],
    subs: {
      'English':               ['Listening and Speaking', 'Reading', 'Writing'],
      'Mathematics':           ['Numbers', 'Measurement', 'Geometry'],
      'Environmental Activities': ['Our Environment', 'Living Things', 'Community Helpers'],
      'Kiswahili':             ['Kusikiliza', 'Kusoma', 'Kuandika'],
      'Creative Arts':         ['Creative Arts', 'Physical Education', 'Music'],
      'Religious Education':   ['Stories', 'Values', 'Prayer'],
    },
  },

  'Grade 2': {
    areas: [
      'English',
      'Mathematics',
      'Environmental Activities',
      'Kiswahili',
      'Creative Arts',
      'Religious Education',
    ],
    subs: {
      'English':               ['Listening and Speaking', 'Reading', 'Writing'],
      'Mathematics':           ['Numbers', 'Measurement', 'Geometry'],
      'Environmental Activities': ['Our Environment', 'Living Things', 'Weather and Time'],
      'Kiswahili':             ['Kusikiliza', 'Kusoma', 'Kuandika'],
      'Creative Arts':         ['Creative Arts', 'Physical Education', 'Music'],
      'Religious Education':   ['Stories', 'Values', 'Prayer'],
    },
  },

  'Grade 3': {
    areas: [
      'English',
      'Mathematics',
      'Science and Technology',
      'Kiswahili',
      'Social Studies',
      'Creative Arts',
      'Religious Education',
    ],
    subs: {
      'English':               ['Listening and Speaking', 'Reading', 'Writing'],
      'Mathematics':           ['Numbers', 'Measurement', 'Geometry'],
      'Science and Technology':['Science', 'Technology', 'Environment'],
      'Kiswahili':             ['Kusikiliza', 'Kusoma', 'Kuandika'],
      'Social Studies':        ['Our Environment', 'Our Nation', 'People and Communities'],
      'Creative Arts':         ['Creative Arts', 'Physical Education', 'Music'],
      'Religious Education':   ['Stories', 'Values', 'Prayer'],
    },
  },

  // ─── UPPER PRIMARY (Grades 4–6) ─────────────────────────────────
  'Grade 4': {
    areas: [
      'English',
      'Mathematics',
      'Science and Technology',
      'Kiswahili',
      'Social Studies',
      'Creative Arts',
      'Religious Education',
    ],
    subs: {
      'English':               ['Listening and Speaking', 'Reading', 'Writing', 'Grammar'],
      'Mathematics':           ['Numbers', 'Measurement', 'Geometry', 'Algebra'],
      'Science and Technology':['Science', 'Technology', 'Environment'],
      'Kiswahili':             ['Kusikiliza', 'Kusoma', 'Kuandika', 'Sarufi'],
      'Social Studies':        ['Our Environment', 'Our Nation', 'Our County'],
      'Creative Arts':         ['Creative Arts', 'Physical Education', 'Music'],
      'Religious Education':   ['Stories', 'Values', 'Scripture'],
    },
  },

  'Grade 5': {
    areas: [
      'English',
      'Mathematics',
      'Science and Technology',
      'Kiswahili',
      'Social Studies',
      'Creative Arts',
      'Religious Education',
    ],
    subs: {
      'English':               ['Listening and Speaking', 'Reading', 'Writing', 'Grammar'],
      'Mathematics':           ['Numbers', 'Measurement', 'Geometry', 'Algebra'],
      'Science and Technology':['Science', 'Technology', 'Digital Literacy'],
      'Kiswahili':             ['Kusikiliza', 'Kusoma', 'Kuandika', 'Sarufi'],
      'Social Studies':        ['Our Environment', 'Our Nation', 'Our County'],
      'Creative Arts':         ['Creative Arts', 'Physical Education', 'Music'],
      'Religious Education':   ['Stories', 'Values', 'Scripture'],
    },
  },

  'Grade 6': {
    areas: [
      'English',
      'Mathematics',
      'Science and Technology',
      'Kiswahili',
      'Social Studies',
      'Creative Arts',
      'Religious Education',
    ],
    subs: {
      'English':               ['Listening and Speaking', 'Reading', 'Writing', 'Grammar'],
      'Mathematics':           ['Numbers', 'Measurement', 'Geometry', 'Algebra'],
      'Science and Technology':['Science', 'Technology', 'Digital Literacy'],
      'Kiswahili':             ['Kusikiliza', 'Kusoma', 'Kuandika', 'Sarufi'],
      'Social Studies':        ['Our Environment', 'Our Nation', 'Citizenship'],
      'Creative Arts':         ['Creative Arts', 'Physical Education', 'Music'],
      'Religious Education':   ['Stories', 'Values', 'Scripture'],
    },
  },

  // ─── JUNIOR SECONDARY (Grades 7–9) ─────────────────────────────
  'Grade 7': {
    areas: [
      'English',
      'Kiswahili',
      'Mathematics',
      'Integrated Science',
      'Pre-Technical Studies',
      'Social Studies',
      'Religious Education',
      'Business Studies',
      'Agriculture',
      'Creative Arts and Sports',
    ],
    subs: {
      'English':                 ['Listening and Speaking', 'Reading', 'Writing', 'Grammar in Use'],
      'Kiswahili':               ['Kusikiliza na Kuzungumza', 'Kusoma', 'Kuandika', 'Sarufi'],
      'Mathematics':             ['Numbers', 'Algebra', 'Measurements', 'Geometry', 'Data Handling'],
      'Integrated Science':      ['Scientific Investigation', 'Mixtures and Separation', 'Living Things and Their Environment', 'Force and Energy'],
      'Pre-Technical Studies':   ['Safety and Injury Prevention', 'Materials for Production', 'Technical Drawing', 'ICT and Digital Devices'],
      'Social Studies':          ['Natural and Historical Built Environments', 'People, Population and Social Organizations', 'Resources and Economic Activities', 'Political Developments and Governance'],
      'Religious Education':     ['Creation', 'The Bible', "Faith and God's Promises", 'Christian Values'],
      'Business Studies':        ['Business and Money Management Skills', 'Ethical Practices in Business', 'Record Keeping', 'Markets'],
      'Agriculture':             ['Introduction to Agriculture', 'Crop Production', 'Livestock Production', 'Agribusiness'],
      'Creative Arts and Sports':['Visual Arts', 'Performing Arts', 'Physical Fitness', 'Ball Games'],
    },
  },

  'Grade 8': {
    areas: [
      'English',
      'Kiswahili',
      'Mathematics',
      'Integrated Science',
      'Pre-Technical Studies',
      'Social Studies',
      'Religious Education',
      'Business Studies',
      'Agriculture',
      'Creative Arts and Sports',
    ],
    subs: {
      'English':                 ['Listening and Speaking', 'Reading', 'Writing', 'Grammar in Use'],
      'Kiswahili':               ['Kusikiliza na Kuzungumza', 'Kusoma', 'Kuandika', 'Sarufi'],
      'Mathematics':             ['Numbers', 'Algebra', 'Measurements', 'Geometry', 'Data Handling'],
      'Integrated Science':      ['Scientific Investigation', 'Matter and Its Properties', 'Living Things and Their Environment', 'Force and Energy'],
      'Pre-Technical Studies':   ['Safety and Injury Prevention', 'Materials for Production', 'Technical Drawing', 'Entrepreneurship and ICT'],
      'Social Studies':          ['Natural and Historical Built Environments', 'People, Population and Social Organizations', 'Resources and Economic Activities', 'Political Developments and Governance'],
      'Religious Education':     ['Creation', 'The Bible', "Faith and God's Promises", 'Christian Values'],
      'Business Studies':        ['Business and Money Management Skills', 'Ethical Practices in Business', 'Record Keeping', 'Markets'],
      'Agriculture':             ['Introduction to Agriculture', 'Crop Production', 'Livestock Production', 'Agribusiness'],
      'Creative Arts and Sports':['Visual Arts', 'Performing Arts', 'Physical Fitness', 'Ball Games'],
    },
  },

  'Grade 9': {
    areas: [
      'English',
      'Kiswahili',
      'Mathematics',
      'Integrated Science',
      'Pre-Technical Studies',
      'Social Studies',
      'Religious Education',
      'Business Studies',
      'Agriculture',
      'Creative Arts and Sports',
    ],
    subs: {
      'English':                 ['Listening and Speaking', 'Reading', 'Writing', 'Grammar in Use'],
      'Kiswahili':               ['Kusikiliza na Kuzungumza', 'Kusoma', 'Kuandika', 'Sarufi'],
      'Mathematics':             ['Numbers', 'Algebra', 'Measurements', 'Geometry', 'Data Handling'],
      'Integrated Science':      ['Scientific Investigation', "Matter and Its Interactions", 'Living Things and Their Environment', 'Force and Energy'],
      'Pre-Technical Studies':   ['Safety and Career Opportunities', 'Materials for Production', 'Technical Drawing', 'Entrepreneurship and ICT'],
      'Social Studies':          ['Natural and Historical Built Environments', 'People, Population and Social Organizations', 'Resources and Economic Activities', 'Political Developments and Governance'],
      'Religious Education':     ['Creation', 'The Bible', "Faith and God's Promises", 'Christian Values'],
      'Business Studies':        ['Business and Money Management Skills', 'Ethical Practices in Business', 'Record Keeping', 'Markets'],
      'Agriculture':             ['Introduction to Agriculture', 'Crop Production', 'Livestock Production', 'Agribusiness'],
      'Creative Arts and Sports':['Visual Arts', 'Performing Arts', 'Physical Fitness', 'Ball Games'],
    },
  },
};

/**
 * Returns the seed definition for a given level_name, or null if the level
 * is not in the map. Unknown levels are skipped by callers rather than
 * silently defaulting to another grade's curriculum.
 */
function getLevelData(levelName) {
  return CBC_LEVEL_DATA[levelName] || null;
}

/**
 * Seed CBC learning areas and sub-areas for a school.
 * Uses the school's existing classes to determine which levels to seed.
 * Safe to re-run — skips areas that already exist (checks area_name + level_name + school_id).
 *
 * @param {object} conn  - DB connection (supports execute)
 * @param {string} schoolId
 * @returns {object} { areas_added, subs_added, skipped }
 */
async function seedLearningAreas(conn, schoolId) {
  // Get all distinct level_names from the school's classes
  const [classRows] = await conn.execute(
    'SELECT DISTINCT level_name FROM classes WHERE school_id = ? AND level_name IS NOT NULL ORDER BY class_rank, level_name',
    [schoolId]
  );

  // Get existing areas to avoid duplicates
  const [existingAreas] = await conn.execute(
    'SELECT area_name, level_name FROM learning_areas WHERE school_id = ?',
    [schoolId]
  );
  const existing = new Set(existingAreas.map(a => `${a.level_name}|${a.area_name}`));

  let areasAdded = 0;
  let subsAdded = 0;
  let skipped = 0;

  for (const { level_name } of classRows) {
    const def = getLevelData(level_name);
    if (!def) {
      console.warn('[seedLearningAreas] unknown level_name, skipping: ', level_name);
      skipped++;
      continue;
    }
    for (const areaName of def.areas) {
      const key = `${level_name}|${areaName}`;
      if (existing.has(key)) { skipped++; continue; }

      const [result] = await conn.execute(
        'INSERT INTO learning_areas (school_id, level_name, area_name) VALUES (?, ?, ?)',
        [schoolId, level_name, areaName]
      );
      areasAdded++;

      const subList = def.subs[areaName] || [];
      for (let i = 0; i < subList.length; i++) {
        await conn.execute(
          'INSERT INTO sub_learning_areas (area_id, sub_area_name, display_order) VALUES (?, ?, ?)',
          [result.insertId, subList[i], i + 1]
        );
        subsAdded++;
      }
    }
  }

  return { areas_added: areasAdded, subs_added: subsAdded, skipped };
}

/**
 * Seed school terms for a given year.
 * Skips if terms for that year already exist.
 */
async function seedTerms(conn, schoolId, year) {
  const [existing] = await conn.execute(
    'SELECT COUNT(*) AS cnt FROM school_terms WHERE school_id = ? AND academic_year = ?',
    [schoolId, year]
  );
  if (existing[0].cnt > 0) return { terms_added: 0, skipped: 3 };

  const termDefs = [
    ['Term 1', `${year}-01-06`, `${year}-04-04`],
    ['Term 2', `${year}-05-04`, `${year}-08-07`],
    ['Term 3', `${year}-09-07`, `${year}-11-20`],
  ];
  for (const [name, start, end] of termDefs) {
    await conn.execute(
      'INSERT INTO school_terms (school_id, term_name, start_date, end_date, academic_year) VALUES (?, ?, ?, ?, ?)',
      [schoolId, name, start, end, year]
    );
  }
  return { terms_added: 3, skipped: 0 };
}

/**
 * Seed rubric config.
 * Skips if rubric already exists.
 */
async function seedRubric(conn, schoolId) {
  const [existing] = await conn.execute(
    'SELECT COUNT(*) AS cnt FROM school_rubric_config WHERE school_id = ?',
    [schoolId]
  );
  if (existing[0].cnt > 0) return { rubric_added: 0, skipped: 4 };

  const rubric = [
    ['EE', 80, 'Exceeding Expectations',   '#2E7D32'],
    ['ME', 60, 'Meeting Expectations',      '#1565C0'],
    ['AE', 40, 'Approaching Expectations',  '#E65100'],
    ['BE',  0, 'Below Expectations',        '#C62828'],
  ];
  for (const [code, min, label, color] of rubric) {
    await conn.execute(
      'INSERT INTO school_rubric_config (school_id, level_code, min_percent, label, color) VALUES (?, ?, ?, ?, ?)',
      [schoolId, code, min, label, color]
    );
  }
  return { rubric_added: 4, skipped: 0 };
}

/**
 * Seed default exam sessions for all classes × all terms.
 * Skips any session that already exists (same school_id + class_id + term + exam_type).
 */
async function seedExamSessions(conn, schoolId, year, createdBy) {
  const [classRows] = await conn.execute(
    'SELECT class_id FROM classes WHERE school_id = ? ORDER BY class_rank, class_name',
    [schoolId]
  );

  const sessionDefs = [
    // [term,    exam_type,   exam_name,         open_date,              close_date]
    ['Term 1', 'CAT 1',    'CAT 1 Term 1',    `${year}-02-10`, `${year}-02-28`],
    ['Term 1', 'CAT 2',    'CAT 2 Term 1',    `${year}-03-10`, `${year}-03-28`],
    ['Term 1', 'End Term', 'End Term 1',       `${year}-03-31`, `${year}-04-04`],
    ['Term 2', 'CAT 1',    'CAT 1 Term 2',    `${year}-06-09`, `${year}-06-27`],
    ['Term 2', 'CAT 2',    'CAT 2 Term 2',    `${year}-07-07`, `${year}-07-25`],
    ['Term 2', 'End Term', 'End Term 2',       `${year}-08-04`, `${year}-08-07`],
    ['Term 3', 'CAT 1',    'CAT 1 Term 3',    `${year}-10-06`, `${year}-10-24`],
    ['Term 3', 'CAT 2',    'CAT 2 Term 3',    `${year}-10-27`, `${year}-11-07`],
    ['Term 3', 'End Term', 'End Term 3',       `${year}-11-17`, `${year}-11-20`],
  ];

  // Build a set of existing (class_id, term, exam_type) combos
  const [existingSessions] = await conn.execute(
    'SELECT class_id, term, exam_type FROM exam_sessions WHERE school_id = ? AND academic_year = ?',
    [schoolId, year]
  );
  const existingSet = new Set(
    existingSessions.map(s => `${s.class_id}|${s.term}|${s.exam_type}`)
  );

  let added = 0;
  let skipped = 0;

  for (const cls of classRows) {
    for (const [term, examType, examName, openDate, closeDate] of sessionDefs) {
      const key = `${cls.class_id}|${term}|${examType}`;
      if (existingSet.has(key)) { skipped++; continue; }

      await conn.execute(
        `INSERT INTO exam_sessions
           (school_id, class_id, term, academic_year, exam_name, exam_type, open_date, close_date, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Scheduled', ?)`,
        [schoolId, cls.class_id, term, year, examName, examType, openDate, closeDate, createdBy || null]
      );
      added++;
    }
  }

  return { sessions_added: added, skipped };
}

/**
 * Seed default fee structures (Tuition + Activity Fee across 3 terms).
 * Skips if fee_structures already has rows for this school + year.
 */
async function seedFees(conn, schoolId, year) {
  const [existing] = await conn.execute(
    'SELECT COUNT(*) AS cnt FROM fee_structures WHERE school_id = ? AND academic_year = ?',
    [schoolId, year]
  );
  if (existing[0].cnt > 0) return { fees_added: 0, skipped: 6 };

  const feeDefs = [
    { fee_name: 'Tuition Fee',   amount: 5000, is_optional: false },
    { fee_name: 'Activity Fee',  amount: 500,  is_optional: false },
    { fee_name: 'Lunch Fee',     amount: 1500, is_optional: true  },
  ];
  const terms = ['Term 1', 'Term 2', 'Term 3'];
  let added = 0;
  for (const fee of feeDefs) {
    for (const term of terms) {
      await conn.execute(
        'INSERT INTO fee_structures (school_id, fee_name, amount, term, academic_year, is_optional) VALUES (?, ?, ?, ?, ?, ?)',
        [schoolId, fee.fee_name, fee.amount, term, year, fee.is_optional]
      );
      added++;
    }
  }
  return { fees_added: added, skipped: 0 };
}

module.exports = {
  CBC_LEVEL_DATA,
  getLevelData,
  seedLearningAreas,
  seedTerms,
  seedRubric,
  seedExamSessions,
  seedFees,
};
