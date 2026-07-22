const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false }
  });
  const [r] = await c.execute("SHOW COLUMNS FROM teachers LIKE 'role'");
  if (r.length === 0) {
    await c.execute("ALTER TABLE teachers ADD COLUMN role ENUM('teacher','head') DEFAULT 'teacher' AFTER phone");
    console.log('role column added');
  } else {
    console.log('role column exists');
  }
  await c.end();
})().catch(e => console.error(e.message));
