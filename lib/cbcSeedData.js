/**
 * CBC Kenya curriculum seed data (KICD-aligned).
 *
 * Covers PP1–PP2 (Pre-Primary), Grade 1–6 (Lower/Upper Primary),
 * and Grade 7–9 (Junior Secondary).
 *
 * Every learning area is broken down into Strands, and each strand
 * into Sub-strands — matching the KICD structure used both for lesson
 * planning and for CAT/exam scoring.
 *
 * The same strand may be taught across terms; here each strand is
 * allocated to one term (rotation) so every term always has strands
 * to select.
 */

const AREA_STRANDS = {
  // ─── English ───────────────────────────────────────────────────
  'English': [
    { name: 'Conventions', term: 'Term 1', subs: ['Punctuation', 'Parts of Speech', 'Sentence Structure'] },
    { name: 'Listening and Speaking', term: 'Term 1', subs: ['Pronunciation', 'Conversation', 'Oral Comprehension'] },
    { name: 'Reading', term: 'Term 2', subs: ['Vocabulary', 'Comprehension', 'Reading Fluency'] },
    { name: 'Writing', term: 'Term 2', subs: ['Handwriting', 'Composition', 'Spelling'] },
    { name: 'Grammar', term: 'Term 3', subs: ['Verb Tenses', 'Agreement', 'Connectors'] },
  ],

  // ─── Kiswahili ─────────────────────────────────────────────────
  'Kiswahili': [
    { name: 'Kusikiliza na Kuzungumza', term: 'Term 1', subs: ['Mazungumzo', 'Matamshi', 'Ufahamu wa Kusikiliza'] },
    { name: 'Kusoma', term: 'Term 2', subs: ['Ufahamu', 'Msamiati', 'Sauti'] },
    { name: 'Kuandika', term: 'Term 2', subs: ['Hati', 'Insha', 'Tahajia'] },
    { name: 'Sarufi', term: 'Term 3', subs: ['Vivumishi', 'Vielezi', 'Ngeli'] },
  ],

  // ─── Mathematics ───────────────────────────────────────────────
  'Mathematics': [
    { name: 'Numbers', term: 'Term 1', subs: ['Whole Numbers', 'Fractions', 'Operations'] },
    { name: 'Measurement', term: 'Term 1', subs: ['Length', 'Mass', 'Capacity', 'Time'] },
    { name: 'Geometry', term: 'Term 2', subs: ['Shapes', 'Angles', 'Position and Direction'] },
    { name: 'Algebra', term: 'Term 3', subs: ['Patterns', 'Equations', 'Inequalities'] },
    { name: 'Data', term: 'Term 3', subs: ['Collecting Data', 'Representing Data', 'Interpreting Data'] },
  ],

  // ─── Science and Technology / Science / Integrated Science ─────
  'Science and Technology': [
    { name: 'Living Things and Their Environment', term: 'Term 1', subs: ['Plants', 'Animals', 'Human Beings'] },
    { name: 'Matter and Its Properties', term: 'Term 1', subs: ['States of Matter', 'Separating Mixtures', 'Changes in Matter'] },
    { name: 'Force and Energy', term: 'Term 2', subs: ['Force', 'Energy', 'Electricity', 'Magnetism'] },
    { name: 'Earth and Space', term: 'Term 2', subs: ['Weather', 'Solar System', 'Natural Resources'] },
    { name: 'Scientific Investigation', term: 'Term 3', subs: ['Observation', 'Experimentation', 'Recording Results'] },
  ],
  'Science': [
    { name: 'Scientific Investigation', term: 'Term 3', subs: ['Observation', 'Experimentation', 'Recording Results'] },
    { name: 'Living Things', term: 'Term 1', subs: ['Plants', 'Animals', 'Human Beings'] },
    { name: 'Matter and Energy', term: 'Term 2', subs: ['States of Matter', 'Force', 'Energy'] },
  ],
  'Integrated Science': [
    { name: 'Scientific Investigation', term: 'Term 3', subs: ['Observation', 'Experimentation', 'Scientific Report'] },
    { name: 'Matter and Its Interactions', term: 'Term 1', subs: ['States of Matter', 'Mixtures', 'Chemical Change'] },
    { name: 'Living Things and Their Environment', term: 'Term 2', subs: ['Cells', 'Nutrition', 'Ecosystems'] },
    { name: 'Force and Energy', term: 'Term 2', subs: ['Forces', 'Work and Energy', 'Electricity'] },
  ],

  // ─── Social Studies ────────────────────────────────────────────
  'Social Studies': [
    { name: 'Our Environment', term: 'Term 1', subs: ['Physical Environment', 'Human Environment', 'Environmental Care'] },
    { name: 'People and Communities', term: 'Term 1', subs: ['Traditional Communities', 'Modern Communities', 'Culture'] },
    { name: 'Our Nation', term: 'Term 2', subs: ['Government', 'National Symbols', 'National Values'] },
    { name: 'Citizenship', term: 'Term 3', subs: ['Rights and Responsibilities', 'Civic Participation'] },
  ],

  // ─── Religious Education ───────────────────────────────────────
  'Religious Education': [
    { name: 'Creation', term: 'Term 1', subs: ["God's Creation", 'Caring for Creation'] },
    { name: 'The Bible', term: 'Term 2', subs: ['Old Testament', 'New Testament'] },
    { name: 'Christian Values', term: 'Term 3', subs: ['Honesty', 'Kindness', 'Responsibility'] },
    { name: 'Prayer and Worship', term: 'Term 3', subs: ['Prayer', 'Worship Practices'] },
  ],

  // ─── Creative Arts / Creative Arts and Sports ──────────────────
  'Creative Arts': [
    { name: 'Creative Activities', term: 'Term 1', subs: ['Drawing', 'Modelling', 'Colouring'] },
    { name: 'Physical Activities', term: 'Term 2', subs: ['Games', 'Movement', 'Fitness'] },
    { name: 'Music and Movement', term: 'Term 3', subs: ['Songs', 'Rhythms', 'Dancing'] },
  ],
  'Creative Arts and Sports': [
    { name: 'Visual Arts', term: 'Term 1', subs: ['Drawing', 'Painting', 'Mosaic'] },
    { name: 'Performing Arts', term: 'Term 2', subs: ['Drama', 'Music', 'Dance'] },
    { name: 'Physical Fitness', term: 'Term 3', subs: ['Endurance', 'Flexibility', 'Strength'] },
    { name: 'Ball Games', term: 'Term 3', subs: ['Handling Skills', 'Team Play', 'Rules'] },
  ],

  // ─── Pre-Primary / Lower Primary ───────────────────────────────
  'Language Activities': [
    { name: 'Listening', term: 'Term 1', subs: ['Attention', 'Oral Comprehension'] },
    { name: 'Speaking', term: 'Term 1', subs: ['Vocabulary', 'Expression'] },
    { name: 'Reading', term: 'Term 2', subs: ['Letter Recognition', 'Word Recognition'] },
    { name: 'Writing', term: 'Term 3', subs: ['Tracing', 'Letter Formation'] },
  ],
  'Mathematical Activities': [
    { name: 'Number Work', term: 'Term 1', subs: ['Counting', 'Sorting', 'Patterns'] },
    { name: 'Measurement', term: 'Term 2', subs: ['Size', 'Length', 'Capacity'] },
    { name: 'Geometry', term: 'Term 3', subs: ['Shapes', 'Position', 'Direction'] },
  ],
  'Environmental Activities': [
    { name: 'Our Environment', term: 'Term 1', subs: ['Home Environment', 'School Environment', 'Weather'] },
    { name: 'Living Things', term: 'Term 2', subs: ['Plants', 'Animals', 'Caring for Living Things'] },
    { name: 'Community', term: 'Term 3', subs: ['Community Helpers', 'Safety', 'Health'] },
  ],
  'Psychomotor and Creative Activities': [
    { name: 'Creative Arts', term: 'Term 1', subs: ['Drawing', 'Modelling', 'Colouring'] },
    { name: 'Physical Activities', term: 'Term 2', subs: ['Games', 'Movement', 'Fitness'] },
    { name: 'Music and Movement', term: 'Term 3', subs: ['Songs', 'Rhythms', 'Dancing'] },
  ],

  // ─── Junior Secondary ──────────────────────────────────────────
  'Pre-Technical Studies': [
    { name: 'Safety and Career', term: 'Term 1', subs: ['Safety at Home and School', 'Introduction to Careers'] },
    { name: 'Materials for Production', term: 'Term 1', subs: ['Woodwork', 'Metalwork', 'Textiles'] },
    { name: 'Technical Drawing', term: 'Term 2', subs: ['Drawing Instruments', 'Geometric Construction'] },
    { name: 'ICT and Digital Devices', term: 'Term 3', subs: ['Computer Basics', 'Digital Literacy', 'Internet Safety'] },
  ],
  'Business Studies': [
    { name: 'Business and Money Management', term: 'Term 1', subs: ['Scarcity and Choice', 'Money and Banking'] },
    { name: 'Ethical Practices in Business', term: 'Term 2', subs: ['Consumer Rights', 'Business Ethics'] },
    { name: 'Record Keeping', term: 'Term 2', subs: ['Ledgers', 'Cash Books'] },
    { name: 'Markets', term: 'Term 3', subs: ['Market Structures', 'Trade'] },
  ],
  'Agriculture': [
    { name: 'Introduction to Agriculture', term: 'Term 1', subs: ['Importance of Agriculture', 'Agriculture in Kenya'] },
    { name: 'Crop Production', term: 'Term 1', subs: ['Land Preparation', 'Planting', 'Crop Care'] },
    { name: 'Livestock Production', term: 'Term 2', subs: ['Animal Breeds', 'Feeding', 'Animal Health'] },
    { name: 'Agribusiness', term: 'Term 3', subs: ['Costs and Profits', 'Marketing Produce'] },
  ],
};

/**
 * Generic fallback for strand names that share the same sub-strand
 * practice across grades (e.g. Kiswahili PP strands map to the
 * Kiswahili catalog; Religious Education sub-strands above).
 */
function getStrandDefs(areaName) {
  return AREA_STRANDS[areaName] || null;
}

const CBC_LEVEL_DATA = {
  'PP1': {
    areas: [
      'Language Activities',
      'Mathematical Activities',
      'Environmental Activities',
      'Psychomotor and Creative Activities',
      'Religious Education',
    ],
  },
  'PP2': {
    areas: [
      'Language Activities',
      'Mathematical Activities',
      'Environmental Activities',
      'Psychomotor and Creative Activities',
      'Religious Education',
    ],
  },
  'Grade 1': {
    areas: [
      'English',
      'Mathematics',
      'Environmental Activities',
      'Kiswahili',
      'Creative Arts',
      'Religious Education',
    ],
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
  },
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
  },
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
 * Seed CBC learning areas for a school.
 * Uses the school's existing classes to determine which levels to seed.
 * Safe to re-run — skips areas that already exist (area + level + school).
 *
 * @param {object} conn  - DB connection (supports execute)
 * @param {string} schoolId
 * @returns {object} { areas_added, skipped }
 */
async function seedLearningAreas(conn, schoolId) {
  const [classRows] = await conn.execute(
    'SELECT level_name, MIN(class_rank) AS min_rank FROM classes WHERE school_id = ? AND level_name IS NOT NULL GROUP BY level_name ORDER BY min_rank, level_name',
    [schoolId]
  );

  const [existingAreas] = await conn.execute(
    'SELECT area_name, level_name FROM learning_areas WHERE school_id = ?',
    [schoolId]
  );
  const existing = new Set(existingAreas.map(a => `${a.level_name}|${a.area_name}`));

  let areasAdded = 0;
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

      await conn.execute(
        'INSERT INTO learning_areas (school_id, level_name, area_name) VALUES (?, ?, ?)',
        [schoolId, level_name, areaName]
      );
      areasAdded++;
    }
  }

  return { areas_added: areasAdded, skipped };
}

/**
 * Seed KICD Strands and Sub-strands for all of a school's learning areas.
 * Safe to re-run — skips strands that already exist (area + strand + term)
 * and sub-strands that already exist (strand + name).
 *
 * @param {object} conn  - DB connection
 * @param {string} schoolId
 * @returns {object} { strands_added, sub_strands_added, skipped, no_catalog }
 */
async function seedStrands(conn, schoolId) {
  const [areas] = await conn.execute(
    'SELECT area_id, area_name FROM learning_areas WHERE school_id = ? ORDER BY level_name, area_name',
    [schoolId]
  );

  const [existingStrands] = await conn.execute(
    'SELECT strand_id, area_id, strand_name, term FROM strands WHERE area_id IN (SELECT area_id FROM learning_areas WHERE school_id = ?)',
    [schoolId]
  );
  const existingStrandSet = new Set(existingStrands.map(s => `${s.area_id}|${s.strand_name}|${s.term}`));
  const strandIdsByKey = {};
  for (const s of existingStrands) {
    strandIdsByKey[`${s.area_id}|${s.strand_name}|${s.term}`] = s.strand_id;
  }

  const [existingSubs] = await conn.execute(
    'SELECT sub_strand_id, strand_id, sub_strand_name FROM sub_strands WHERE strand_id IN (SELECT strand_id FROM strands WHERE area_id IN (SELECT area_id FROM learning_areas WHERE school_id = ?))',
    [schoolId]
  );
  const existingSubSet = new Set(existingSubs.map(s => `${s.strand_id}|${s.sub_strand_name}`));

  let strandsAdded = 0;
  let subStrandsAdded = 0;
  let skipped = 0;
  let noCatalog = 0;

  for (const area of areas) {
    const defs = getStrandDefs(area.area_name);
    if (!defs) {
      noCatalog++;
      console.warn('[seedStrands] no strand catalog for area: ', area.area_name);
      continue;
    }
    for (const def of defs) {
      const key = `${area.area_id}|${def.name}|${def.term}`;
      let strandId = strandIdsByKey[key];
      if (!strandId) {
        const [r] = await conn.execute(
          'INSERT INTO strands (area_id, strand_name, term) VALUES (?, ?, ?)',
          [area.area_id, def.name, def.term]
        );
        strandId = r.insertId;
        strandIdsByKey[key] = strandId;
        strandsAdded++;
      } else {
        skipped++;
      }
      for (const sub of def.subs) {
        const subKey = `${strandId}|${sub}`;
        if (existingSubSet.has(subKey)) { skipped++; continue; }
        await conn.execute(
          'INSERT INTO sub_strands (strand_id, sub_strand_name) VALUES (?, ?)',
          [strandId, sub]
        );
        existingSubSet.add(subKey);
        subStrandsAdded++;
      }
    }
  }

  return { strands_added: strandsAdded, sub_strands_added: subStrandsAdded, skipped, no_catalog: noCatalog };
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
    'SELECT class_id, class_rank FROM classes WHERE school_id = ? ORDER BY class_rank, class_name',
    [schoolId]
  );

  const sessionDefs = [
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
  AREA_STRANDS,
  getLevelData,
  getStrandDefs,
  seedLearningAreas,
  seedStrands,
  seedTerms,
  seedRubric,
  seedExamSessions,
  seedFees,
};