// Per-school configuration helpers

async function getCurrentTerm(db, schoolId) {
  const [rows] = await db.execute(
    'SELECT term_name, start_date, end_date FROM school_terms WHERE school_id = ? AND start_date <= CURDATE() AND end_date >= CURDATE() LIMIT 1',
    [schoolId]
  );
  if (rows.length > 0) return rows[0].term_name;
  // Fallback: derive from month
  const m = new Date().getMonth() + 1;
  return m <= 4 ? 'Term 1' : m <= 8 ? 'Term 2' : 'Term 3';
}

async function getNextTermStart(db, schoolId) {
  const [rows] = await db.execute(
    'SELECT MIN(start_date) AS next_start FROM school_terms WHERE school_id = ? AND start_date > CURDATE()',
    [schoolId]
  );
  if (rows.length > 0 && rows[0].next_start) return rows[0].next_start;
  // Fallback: hardcoded months
  const m = new Date().getMonth() + 1;
  const y = new Date().getFullYear();
  if (m <= 4) return new Date(y, 4, 1);
  if (m <= 8) return new Date(y, 8, 1);
  return new Date(y + 1, 0, 1);
}

async function getRubricConfig(db, schoolId) {
  const [rows] = await db.execute(
    'SELECT level_code, min_percent, label, color FROM school_rubric_config WHERE school_id = ? ORDER BY min_percent DESC',
    [schoolId]
  );
  if (rows.length === 0) {
    return [
      { level_code: 'EE', min_percent: 80, label: 'Exceeding Expectations', color: '#2E7D32' },
      { level_code: 'ME', min_percent: 60, label: 'Meeting Expectations', color: '#1565C0' },
      { level_code: 'AE', min_percent: 40, label: 'Approaching Expectations', color: '#E65100' },
      { level_code: 'BE', min_percent: 0, label: 'Below Expectations', color: '#C62828' },
    ];
  }
  return rows;
}

function getLevel(pct, rubricConfig) {
  for (const level of rubricConfig) {
    if (pct >= level.min_percent / 100) return level;
  }
  return rubricConfig[rubricConfig.length - 1];
}

module.exports = { getCurrentTerm, getNextTermStart, getRubricConfig, getLevel };
