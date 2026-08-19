// One-off runner: node scripts/_run_migration.js <sql-file>
require('dotenv').config();
const fs = require('fs');
const mysql = require('mysql2/promise');

(async () => {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node scripts/_run_migration.js <file.sql>'); process.exit(1); }
  const sql = fs.readFileSync(file, 'utf8');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: +process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true' ? {} : undefined,
    multipleStatements: true,
  });
  try {
    await conn.query(sql);
    console.log(`[MIGRATION OK] ${file}`);
  } catch (e) {
    console.error(`[MIGRATION FAILED] ${e.message}`);
    process.exit(1);
  } finally {
    await conn.end();
  }
})();