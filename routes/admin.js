const express = require('express');
const router = express.Router();

function requireAdmin(req, res, next) {
  if (process.env.ADMIN_ENABLED !== 'true') {
    return res.status(404).send('<h1>404 Not Found</h1>');
  }
  next();
}

async function countTable(db, table) {
  try {
    const [[r]] = await db.execute(`SELECT COUNT(*) AS cnt FROM \`${table}\``);
    return r.cnt;
  } catch { return '—'; }
}

router.use(requireAdmin);

router.get('/', async (req, res) => {
  try {
    const [schoolCount, teacherCount, studentCount, parentCount,
           attendCount, paymentCount, assessmentCount, campaignCount] = await Promise.all([
      countTable(req.db, 'schools'),
      countTable(req.db, 'teachers'),
      countTable(req.db, 'students'),
      countTable(req.db, 'parent_profiles'),
      countTable(req.db, 'attendance_logs'),
      countTable(req.db, 'payment_ledger'),
      countTable(req.db, 'assessments'),
      countTable(req.db, 'marketplace_campaigns')
    ]);

    let schools = [];
    try {
      [schools] = await req.db.execute('SELECT school_id, school_name, region FROM schools ORDER BY school_name LIMIT 20');
    } catch { schools = []; }

    let recentSync = [];
    try {
      [recentSync] = await req.db.execute('SELECT * FROM sync_log ORDER BY synced_at DESC LIMIT 10');
    } catch { recentSync = []; }

    let html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shule SMS Admin</title><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#F1F5F9;color:#1E293B;padding:32px}
h1{font-size:20px;font-weight:700;margin-bottom:24px;color:#7B4F9B}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:32px}
.card{background:#fff;border-radius:10px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.06)}
.card .num{font-size:28px;font-weight:700;color:#7B4F9B}
.card .label{font-size:12px;color:#64748B;margin-top:4px}
h2{font-size:15px;font-weight:600;margin-bottom:12px;color:#334155}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);margin-bottom:32px}
th{text-align:left;padding:10px 14px;font-size:11px;font-weight:600;text-transform:uppercase;color:#64748B;background:#F8FAFC;border-bottom:1px solid #E2E8F0}
td{padding:10px 14px;font-size:13px;border-bottom:1px solid #F1F5F9}
tr:last-child td{border-bottom:none}
.env-box{background:#1E293B;color:#E2E8F0;padding:16px;border-radius:10px;font-size:12px;font-family:monospace;margin-bottom:32px}
.env-box .ok{color:#10B981}.env-box .miss{color:#EF4444}
</style></head><body>
<h1>Shule SMS Admin</h1>
<div class="cards">
  <div class="card"><div class="num">${schoolCount}</div><div class="label">Schools</div></div>
  <div class="card"><div class="num">${teacherCount}</div><div class="label">Teachers</div></div>
  <div class="card"><div class="num">${studentCount}</div><div class="label">Students</div></div>
  <div class="card"><div class="num">${parentCount}</div><div class="label">Parents</div></div>
  <div class="card"><div class="num">${attendCount}</div><div class="label">Attendance Logs</div></div>
  <div class="card"><div class="num">${paymentCount}</div><div class="label">Payments</div></div>
  <div class="card"><div class="num">${assessmentCount}</div><div class="label">Assessments</div></div>
  <div class="card"><div class="num">${campaignCount}</div><div class="label">Campaigns</div></div>
</div>

<h2>Schools (${schoolCount})</h2>
<table><thead><tr><th>School ID</th><th>School Name</th><th>Region</th></tr></thead><tbody>
${schools.length ? schools.map(s => `<tr><td>${s.school_id}</td><td>${s.school_name}</td><td>${s.region || '—'}</td></tr>`).join('') : '<tr><td colspan="3" style="color:#94A3B8;text-align:center">No data or table missing</td></tr>'}
</tbody></table>

<h2>Recent Sync Activity</h2>
<table><thead><tr><th>ID</th><th>Type</th><th>Status</th><th>Time</th></tr></thead><tbody>
${recentSync.length ? recentSync.map(s => `<tr><td>${s.sync_id}</td><td>${s.sync_type}</td><td style="color:${s.status === 'success' ? '#10B981' : '#EF4444'}">${s.status}</td><td>${new Date(s.synced_at).toLocaleString()}</td></tr>`).join('') : '<tr><td colspan="4" style="color:#94A3B8;text-align:center">No sync activity</td></tr>'}
</tbody></table>

<h2>Environment Variables</h2>
<div class="env-box">
DB_HOST: <span class="ok">SET</span><br>
DB_USER: <span class="ok">SET</span><br>
DB_NAME: <span class="ok">SET</span><br>
PORT: <span class="ok">${process.env.PORT || '3000'}</span><br>
WA_ACCESS_TOKEN: ${process.env.META_ACCESS_TOKEN ? '<span class="ok">SET</span>' : '<span class="miss">MISSING</span>'}<br>
WA_PHONE_ID: ${process.env.PHONE_NUMBER_ID ? '<span class="ok">SET</span>' : '<span class="miss">MISSING</span>'}<br>
CORS_ORIGIN: <span class="ok">${process.env.CORS_ORIGIN || '* (default)'}</span><br>
ADMIN_ENABLED: <span class="ok">${process.env.ADMIN_ENABLED || 'false'}</span>
</div>`;
    res.send(html);
  } catch (err) {
    res.status(500).send(`<h1>Admin Error</h1><pre>${err.message}</pre>`);
  }
});

module.exports = router;
