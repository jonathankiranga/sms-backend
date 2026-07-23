const express = require('express');
const mysql = require('mysql2/promise');
require('dotenv').config();
const cors = require('cors');

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

const app = express();
const defaultOrigins = 'https://teacher-frontend.vercel.app,https://parent-frontend.vercel.app,http://localhost:5173,http://localhost:3000';
app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : defaultOrigins.split(','),
  methods: ['GET', 'POST', 'DELETE', 'PUT', 'PATCH']
}));
app.use(express.json());

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA } : false,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0
});

app.use((req, res, next) => {
  req.db = pool;
  next();
});

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

app.get('/health', async (req, res) => {
  try {
    const [rows] = await req.db.execute('SELECT 1 AS ok');
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: 'error', db: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SMS Backend running on port ${PORT}`);
  console.log(`DB: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
});
