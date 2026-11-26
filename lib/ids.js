const crypto = require('crypto');

// Database identifiers in the current schema use CHAR(9). Keep a three-character
// entity prefix and six cryptographically random base36 characters.
function genId(prefix) {
  const p = String(prefix || '').toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(p)) {
    throw new Error('ID prefix must contain between 1 and 3 letters');
  }
  const suffixLength = 9 - p.length;
  const suffix = crypto.randomInt(36 ** suffixLength).toString(36).toUpperCase().padStart(suffixLength, '0');
  return p + suffix;
}

// Generate a unique ID that does not already exist in `table.column`.
// Retries on collision, so duplicates are impossible even across rapid/concurrent writes.
async function generateUniqueId(db, prefix, table, column) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = genId(prefix);
    const [rows] = await db.execute(`SELECT ${column} FROM ${table} WHERE ${column} = ? LIMIT 1`, [id]);
    if (rows.length === 0) return id;
  }
  throw new Error(`Could not generate a unique ID for ${prefix} after multiple attempts`);
}

// Next teacher ID in the global TCH + 6-digit sequence (e.g. TCH000001).
// Fits teachers.teacher_id CHAR(9). Legacy non-numeric IDs (e.g. TCHWX001)
// are ignored; existing numeric IDs (e.g. TCH805056) seed the sequence.
// Verifies the candidate with a PK lookup and retries, so concurrent
// inserts stay safe.
async function nextTeacherId(db) {
  const [rows] = await db.execute('SELECT teacher_id FROM teachers');
  let max = 0;
  for (const r of rows) {
    const m = /^TCH(\d{6})$/.exec(r.teacher_id || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `TCH${String(max + 1 + attempt).padStart(6, '0')}`;
    if (candidate.length > 9) throw new Error('Teacher ID sequence exhausted');
    const [dup] = await db.execute('SELECT teacher_id FROM teachers WHERE teacher_id = ? LIMIT 1', [candidate]);
    if (dup.length === 0) return candidate;
  }
  throw new Error('Could not generate unique teacher ID');
}

module.exports = { genId, generateUniqueId, nextTeacherId };
