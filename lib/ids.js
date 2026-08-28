const crypto = require('crypto');

// Generate a random, human-friendly ID like "SCH1Y8K7M2QX".
function rawId(prefix, entropyBase36) {
  const ts = Date.now().toString(36);
  return `${prefix}${ts}${entropyBase36}`.toUpperCase();
}

// Produces an ID with much more entropy than the old genId (3 random chars).
// Old: prefix + base36(ms) + 3 chars  (~46k random combos, weak if timestamps collide).
// New: prefix + base36(ms) + 6 base36 chars derived from crypto.randomBytes (much larger space).
function genId(prefix) {
  let entropy = crypto.randomBytes(6).toString('hex');
  // convert hex -> base36 to keep output chars [0-9a-z] (nice to read)
  let n = BigInt('0x' + entropy);
  let b36 = '';
  while (n > 0n) {
    b36 = '0123456789abcdefghijklmnopqrstuvwxyz'[Number(n % 36n)] + b36;
    n = n / 36n;
  }
  b36 = b36.padStart(9, '0');
  return rawId(prefix, b36);
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

module.exports = { genId, generateUniqueId };
