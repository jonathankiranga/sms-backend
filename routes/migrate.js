const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const MIGRATE_SECRET = process.env.MIGRATE_SECRET || '';

function migrationAuthorized(req) {
  if (process.env.NODE_ENV === 'production') return false;
  if (!MIGRATE_SECRET) return false;
  const supplied = req.get('x-migrate-secret') || '';
  return supplied.length > 0 && supplied === MIGRATE_SECRET;
}

// GET /api/migrate/check?secret=... — read-only schema diagnostic for the schools table
router.get('/check', async (req, res) => {
  if (!migrationAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const [cols] = await req.db.query(
      "SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schools' ORDER BY ORDINAL_POSITION"
    );
    const [idx] = await req.db.query(
      "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schools' GROUP BY INDEX_NAME"
    );
    res.json({
      database: (await req.db.query('SELECT DATABASE() AS d'))[0][0].d,
      school_columns: cols.map(c => c.COLUMN_NAME),
      mpesa_columns: cols.filter(c => c.COLUMN_NAME.startsWith('mpesa_')).map(c => `${c.COLUMN_NAME} (${c.COLUMN_TYPE})`),
      indexes: idx.map(i => i.INDEX_NAME)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/run', async (req, res) => {
  if (!migrationAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const scriptsDir = path.join(__dirname, '..', 'scripts');
  const files = fs.readdirSync(scriptsDir).filter(f => f.endsWith('.sql')).sort();
  const results = [];

  for (const file of files) {
    // These scripts are diagnostics or contain MySQL triggers with DELIMITER
    // directives. The endpoint's semicolon splitter cannot execute them safely.
    if ([
      '20261127_global_identity_memberships.sql',
      'preflight_global_identity_migration.sql',
      'validate_global_identity_migration.sql'
    ].includes(file)) {
      results.push({
        file,
        skipped: true,
        reason: 'Run this script manually through a MySQL client that supports DELIMITER.'
      });
      continue;
    }

    const sqlPath = path.join(scriptsDir, file);
    const sql = fs.readFileSync(sqlPath, 'utf8');
    const clean = sql.replace(/^--.*$/gm, '').trim();
    const statements = clean
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    const fileResults = { file, statements: [] };

    for (const stmt of statements) {
      try {
        await req.db.execute(stmt);
        fileResults.statements.push({ sql: stmt.substring(0, 80) + '...', status: 'ok' });
      } catch (err) {
        fileResults.statements.push({ sql: stmt.substring(0, 80) + '...', status: 'error', message: err.message });
      }
    }

    results.push(fileResults);
  }

  res.json({ migrated: true, results });
});

module.exports = router;
