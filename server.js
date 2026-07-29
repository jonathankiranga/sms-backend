const express = require('express');
const mysql = require('mysql2/promise');
require('dotenv').config();
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const attendanceRoutes = require('./routes/attendance');
const teacherRoutes = require('./routes/teachers');
const schoolHeadRoutes = require('./routes/schoolHead');
const parentRoutes = require('./routes/parents');
const assessmentRoutes = require('./routes/assessments');
const schoolRoutes = require('./routes/schools');
const merchantRoutes = require('./routes/merchants');
const feeRoutes = require('./routes/fees');
const paymentRoutes = require('./routes/payments');
const adRoutes = require('./routes/ads');
const adminRoutes = require('./routes/admin');
const adminApiRoutes = require('./routes/admin-api');
const webpushRoutes = require('./routes/webpush');
const migrateRoutes = require('./routes/migrate');
const lessonPlanRoutes = require('./routes/lessonPlans');
const competencyRoutes = require('./routes/competencies');
const bazarPayRoutes = require('./routes/bazarPay');
const examSessionRoutes = require('./routes/examSessions');

const app = express();
const defaultOrigins = 'https://teacher-frontend.vercel.app,https://parent-frontend.vercel.app,https://headteacher-frontend.vercel.app,http://localhost:5173,http://localhost:3000';
const configuredOrigins = (process.env.CORS_ORIGIN || '').split(',').map(o => o.trim()).filter(Boolean);
const allowedOrigins = [...new Set([...configuredOrigins, ...defaultOrigins.split(',')])];

app.use(helmet());
app.set('trust proxy', 1);

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many OTP requests. Try again in 15 minutes.' }
});

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  methods: ['GET', 'POST', 'DELETE', 'PUT', 'PATCH']
}));
app.use(express.json());

// Support both DATABASE_URL connection string and individual DB_* env vars
let poolConfig;
if (process.env.DATABASE_URL) {
  const u = new URL(process.env.DATABASE_URL);
  poolConfig = {
    host: u.hostname,
    port: parseInt(u.port) || 4000,
    user: u.username,
    password: u.password,
    database: u.pathname.replace('/', ''),
    ssl: { minVersion: 'TLSv1.2' },
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0
  };
} else {
  poolConfig = {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '4000'),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'false' ? false : (
      process.env.DB_SSL_CA
        ? { ca: process.env.DB_SSL_CA }
        : { minVersion: 'TLSv1.2' }
    ),
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0
  };
}
const pool = mysql.createPool(poolConfig);

// Migration runner: if RUN_MIGRATIONS=true (and not blocked in production) the server will execute .sql files from backend/scripts in filename order.
async function runMigrationsIfNeeded() {
  try {
    const runFlag = (process.env.RUN_MIGRATIONS || '').toLowerCase() === 'true';
    if (!runFlag) return;
    if (process.env.NODE_ENV === 'production' && (process.env.MIGRATE_ALLOW_PROD || '').toLowerCase() !== 'true') {
      console.log('RUN_MIGRATIONS requested but MIGRATE_ALLOW_PROD not set — skipping migrations in production');
      return;
    }

    const fs = require('fs').promises;
    const path = require('path');
    const scriptsDir = path.join(__dirname, 'scripts');
    const files = await fs.readdir(scriptsDir);
    const sqlFiles = files.filter(f => f.endsWith('.sql')).sort();
    if (sqlFiles.length === 0) { console.log('No SQL migration files found in', scriptsDir); return; }

    // Use a dedicated connection with multipleStatements for running migration SQL files
    const migrationPool = mysql.createPool({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '3306'),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      ssl: process.env.DB_SSL === 'true' ? (process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA } : {}) : process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA } : false,
      waitForConnections: true,
      connectionLimit: 1,
      queueLimit: 0,
      multipleStatements: true
    });
    const conn = await migrationPool.getConnection();
    try {
      // Ensure migrations history table exists
      await conn.query(`CREATE TABLE IF NOT EXISTS migrations_history (
        name VARCHAR(255) PRIMARY KEY,
        applied_at DATETIME NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

      for (const file of sqlFiles) {
        const [rows] = await conn.query('SELECT name FROM migrations_history WHERE name = ?', [file]);
        if (rows && rows.length > 0) {
          console.log('Skipping already-applied migration:', file);
          continue;
        }
        const filePath = path.join(scriptsDir, file);
        console.log('Applying migration:', filePath);
        const sql = await fs.readFile(filePath, 'utf8');
        if (!sql.trim()) {
          console.log('Empty migration file, skipping:', file);
          continue;
        }
        // Execute the SQL file (may contain multiple statements)
        await conn.query(sql);
        await conn.query('INSERT INTO migrations_history (name, applied_at) VALUES (?, NOW())', [file]);
        console.log('Applied migration:', file);
      }
    } finally {
      conn.release();
      await migrationPool.end();
    }
  } catch (err) {
    console.error('Migration runner failed:', err);
    // Do not crash the server on migration errors; surface the error and continue
  }
}

// Start migrations (but do not await here so server starts promptly)
runMigrationsIfNeeded();

app.use((req, res, next) => {
  req.db = pool;
  next();
});

// Apply rate limiting to OTP routes
app.use('/api/teachers/request-otp', otpLimiter);
app.use('/api/parents/request-otp', otpLimiter);
app.use('/api/merchants/request-otp', otpLimiter);
app.use('/api/merchants/register', otpLimiter);

// Reusable auth middleware — verifies Bearer token from OTP session
async function authenticate(req, res, next) {
  const auth = (req.headers.authorization || '').trim();
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const sessionId = auth.split(' ')[1];
  const [rows] = await req.db.execute(
    'SELECT phone, verified, expires_at FROM otp_sessions WHERE session_id = ?',
    [sessionId]
  );
  if (rows.length === 0) return res.status(401).json({ error: 'Invalid session' });
  const sess = rows[0];
  if (!sess.verified || !sess.expires_at || new Date(sess.expires_at) <= new Date()) {
    return res.status(401).json({ error: 'Session expired' });
  }
  req.user = { phone: sess.phone };
  next();
}

app.use('/api/attendance', attendanceRoutes);
app.use('/api/teachers', teacherRoutes);
app.use('/api/school-head', schoolHeadRoutes);
app.use('/api/parents', parentRoutes);
app.use('/v1/payments', paymentRoutes);
app.use('/api/ads', adRoutes);
app.use('/api/assessments', assessmentRoutes);
app.use('/api/schools', schoolRoutes);
app.use('/api/merchants', merchantRoutes);
app.use('/api/fees', feeRoutes);
app.use('/admin/api', adminApiRoutes);
app.use('/admin', adminRoutes);
app.use('/api/webpush', webpushRoutes);
app.use('/api/migrate', migrateRoutes);
app.use('/api/lesson-plans', lessonPlanRoutes);
app.use('/api/competencies', competencyRoutes);
app.use('/api/bazar-pay', bazarPayRoutes);
app.use('/api/exam-sessions', examSessionRoutes);

app.get('/health', async (req, res) => {
  try {
    const [rows] = await req.db.execute('SELECT 1 AS ok');
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[HEALTH]', err.message);
    res.status(500).json({ status: 'error', db: 'Database connection failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SMS Backend running on port ${PORT}`);
  console.log(`DB: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
});
