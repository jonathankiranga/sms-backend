const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const MIGRATE_SECRET = process.env.MIGRATE_SECRET || 'migrate2024';

router.post('/run', async (req, res) => {
  if (req.query.secret !== MIGRATE_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const scriptsDir = path.join(__dirname, '..', 'scripts');
  const files = fs.readdirSync(scriptsDir).filter(f => f.endsWith('.sql')).sort();
  const results = [];

  for (const file of files) {
    const sqlPath = path.join(scriptsDir, file);
    const sql = fs.readFileSync(sqlPath, 'utf8');
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

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
