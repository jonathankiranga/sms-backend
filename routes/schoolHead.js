const express = require('express');
const crypto = require('crypto');
const router = express.Router();

router.get('/:schoolId/teachers', async (req, res) => {
  const [rows] = await req.db.execute(
    'SELECT teacher_id, full_name, phone, role FROM teachers WHERE school_id = ? ORDER BY full_name',
    [req.params.schoolId]
  );
  res.json({ teachers: rows });
});

router.post('/:schoolId/teachers', async (req, res) => {
  const { full_name, phone } = req.body;
  if (!full_name || !phone) return res.status(400).json({ error: 'Name and phone required' });

  const teacherId = 'TCH' + Date.now().toString(36).toUpperCase();

  const [existing] = await req.db.execute('SELECT teacher_id FROM teachers WHERE phone = ?', [phone]);
  if (existing.length > 0) return res.status(409).json({ error: 'Phone already registered' });

  await req.db.execute(
    'INSERT INTO teachers (teacher_id, full_name, phone, school_id, role) VALUES (?, ?, ?, ?, ?)',
    [teacherId, full_name, phone, req.params.schoolId, 'teacher']
  );

  res.json({ teacher_id: teacherId, full_name, phone, role: 'teacher' });
});

router.delete('/:schoolId/teachers/:teacherId', async (req, res) => {
  const [t] = await req.db.execute(
    'SELECT role FROM teachers WHERE teacher_id = ? AND school_id = ?',
    [req.params.teacherId, req.params.schoolId]
  );
  if (t.length === 0) return res.status(404).json({ error: 'Teacher not found' });
  if (t[0].role === 'head') return res.status(403).json({ error: 'Cannot remove school head' });

  await req.db.execute('DELETE FROM teachers WHERE teacher_id = ?', [req.params.teacherId]);
  res.json({ deleted: true });
});

// CSV Import Students — school head can bulk-import into a class
router.post('/:schoolId/students/import', async (req, res) => {
  const { class_id, csv } = req.body;
  if (!class_id || !csv) return res.status(400).json({ error: 'class_id and csv required' });
  const lines = csv.trim().split('\n');
  let imported = 0, errors = 0;
  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length < 2) { errors++; continue; }
    const student_id = parts[0].trim();
    const full_name = parts.slice(1).join(',').trim();
    if (!student_id || !full_name) { errors++; continue; }
    try {
      await req.db.execute('INSERT INTO students (student_id, full_name, class_id, school_id) VALUES (?, ?, ?, ?)',
        [student_id, full_name, class_id, req.params.schoolId]);
      imported++;
    } catch { errors++; }
  }
  res.json({ imported, errors });
});

// Analytics — attendance summary per class for school head
router.get('/:schoolId/analytics/attendance', async (req, res) => {
  const { days } = req.query;
  const period = parseInt(days) || 30;
  const [rows] = await req.db.execute(
    `SELECT a.attendance_date, a.status, COUNT(*) AS cnt
     FROM attendance_logs a
     JOIN students s ON a.student_id = s.student_id
     WHERE s.school_id = ? AND a.attendance_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY a.attendance_date, a.status
     ORDER BY a.attendance_date`,
    [req.params.schoolId, period]
  );
  res.json({ analytics: rows });
});

// Broadcast WhatsApp message to all premium parents in the school
router.post('/:schoolId/broadcast', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  const [parents] = await req.db.execute(
    `SELECT DISTINCT p.parent_phone, s.school_name
     FROM parent_profiles p
     JOIN student_parent_map m ON p.parent_phone = m.parent_phone
     JOIN students st ON m.student_id = st.student_id
     JOIN schools s ON st.school_id = s.school_id
     WHERE st.school_id = ? AND p.is_premium = TRUE AND (p.premium_expires_at IS NULL OR p.premium_expires_at >= NOW())`,
    [req.params.schoolId]
  );
  if (parents.length === 0) return res.json({ sent: 0, message: 'No premium parents found' });
  const { sendBroadcast } = require('../services/messaging');
  let sent = 0;
  for (const p of parents) {
    try {
      await sendBroadcast(p.parent_phone, p.school_name, message);
      sent++;
    } catch (e) {
      console.error(`[BROADCAST] Failed to ${p.parent_phone}: ${e.message}`);
    }
  }
  res.json({ sent, total: parents.length });
});

// Fee reminder — trigger WhatsApp fee reminder for a parent
router.post('/:schoolId/fee-reminder/:studentId', async (req, res) => {
  const [student] = await req.db.execute(
    `SELECT s.full_name FROM students s WHERE s.student_id = ? AND s.school_id = ?`,
    [req.params.studentId, req.params.schoolId]
  );
  if (student.length === 0) return res.status(404).json({ error: 'Student not found' });

  // Get total fee for the current term
  const [fees] = await req.db.execute(
    `SELECT SUM(f.amount) AS total FROM fee_structures f
     WHERE f.school_id = ? AND f.term = (SELECT CONCAT('Term ', CEIL(MONTH(CURDATE())/4)) FROM DUAL)`,
    [req.params.schoolId]
  );
  // Get amount paid
  const [paid] = await req.db.execute(
    `SELECT COALESCE(SUM(amount), 0) AS paid FROM payment_ledger WHERE student_reference = ?`,
    [req.params.studentId]
  );
  const total = fees[0]?.total || 0;
  const balance = total - paid[0].paid;

  const [parentRows] = await req.db.execute(
    `SELECT p.parent_phone FROM student_parent_map m
     JOIN parent_profiles p ON m.parent_phone = p.parent_phone
     WHERE m.student_id = ? AND p.is_premium = TRUE`,
    [req.params.studentId]
  );

  if (parentRows.length > 0) {
    const { sendFeeReminder } = require('../services/messaging');
    for (const p of parentRows) {
      sendFeeReminder(p.parent_phone, student[0].full_name, total.toString(), Math.max(0, balance).toString())
        .catch(e => console.error('[WA] Fee reminder failed:', e.message));
    }
    res.json({ sent: parentRows.length, student: student[0].full_name, balance: Math.max(0, balance) });
  } else {
    res.json({ sent: 0, message: 'No premium parent linked' });
  }
});

module.exports = router;
