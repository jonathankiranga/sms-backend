const express = require('express');
const mysql = require('mysql2/promise');
require('dotenv').config();
const cors = require('cors');

const attendanceRoutes = require('./routes/attendance');
const teacherRoutes = require('./routes/teachers');
const schoolHeadRoutes = require('./routes/schoolHead');
const parentRoutes = require('./routes/parents');
const paymentRoutes = require('./routes/payments');
const adRoutes = require('./routes/ads');

const app = express();
app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*',
  methods: ['GET', 'POST']
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
