/**
 * Admin CLI — run on developer's machine only.
 * Usage: node admin/seed.js <command> [args]
 *
 * Commands:
 *   add-school <id> <name> [region]
 *   add-head <schoolId> <fullName> <phone>
 *   add-teacher <schoolId> <fullName> <phone>
 *   import <schoolId> <classId> <csvFile>
 *   list schools
 *   list teachers <schoolId>
 */
const mysql = require('mysql2/promise');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function getConn() {
  return mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false }
  });
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd) { console.log('Usage: node admin/seed.js <command>'); process.exit(1); }

  const conn = await getConn();

  switch (cmd) {
    case 'add-school': {
      const [id, name, region] = args;
      if (!id || !name) { console.log('Usage: add-school <id> <name> [region]'); break; }
      await conn.execute('INSERT INTO schools (school_id, school_name, region) VALUES (?, ?, ?)', [id, name, region || null]);
      console.log('School added:', id, name);
      break;
    }
    case 'add-head': {
      const [schoolId, fullName, phone] = args;
      if (!schoolId || !fullName || !phone) { console.log('Usage: add-head <schoolId> <fullName> <phone>'); break; }
      const tid = 'TCH' + Date.now().toString(36).toUpperCase();
      await conn.execute('INSERT INTO teachers (teacher_id, full_name, phone, school_id, role) VALUES (?, ?, ?, ?, ?)', [tid, fullName, phone, schoolId, 'head']);
      console.log('School head added:', tid, fullName);
      break;
    }
    case 'add-teacher': {
      const [schoolId2, fullName2, phone2] = args;
      if (!schoolId2 || !fullName2 || !phone2) { console.log('Usage: add-teacher <schoolId> <fullName> <phone>'); break; }
      const tid2 = 'TCH' + Date.now().toString(36).toUpperCase();
      await conn.execute('INSERT INTO teachers (teacher_id, full_name, phone, school_id, role) VALUES (?, ?, ?, ?, ?)', [tid2, fullName2, phone2, schoolId2, 'teacher']);
      console.log('Teacher added:', tid2, fullName2);
      break;
    }
    case 'list': {
      const what = args[0];
      if (what === 'schools') {
        const [rows] = await conn.execute('SELECT school_id, school_name, region, created_at FROM schools ORDER BY school_name');
        console.table(rows);
      } else if (what === 'teachers') {
        const [rows] = await conn.execute('SELECT teacher_id, full_name, phone, role FROM teachers WHERE school_id = ? ORDER BY full_name', [args[1]]);
        console.table(rows);
      }
      break;
    }
    default:
      console.log('Unknown command:', cmd);
  }

  await conn.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
