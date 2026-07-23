const express = require('express');
const router = express.Router();

router.post('/sync', async (req, res) => {
  const { school_id, teacher_id, attendance_date, records } = req.body;
  if (!school_id || !teacher_id || !attendance_date || !records?.length) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const connection = await req.db.getConnection();
  try {
    await connection.beginTransaction();

    for (const r of records) {
      await connection.execute(
        `INSERT INTO attendance_logs (student_id, teacher_id, attendance_date, status, synced_at)
         VALUES (?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE status = VALUES(status), synced_at = NOW()`,
        [r.student_id, teacher_id, attendance_date, r.status]
      );

      if (r.status === 'Absent') {
        const [parentRows] = await connection.execute(
          `SELECT p.parent_phone, s.full_name AS student_name, sch.school_name
           FROM attendance_logs a
           JOIN students s ON a.student_id = s.student_id
           JOIN schools sch ON s.school_id = sch.school_id
           JOIN student_parent_map m ON s.student_id = m.student_id
           JOIN parent_profiles p ON m.parent_phone = p.parent_phone
           WHERE a.student_id = ? AND a.attendance_date = ?
             AND p.is_premium = TRUE AND p.premium_expires_at >= NOW()
           LIMIT 1`,
          [r.student_id, attendance_date]
        );

        if (parentRows.length > 0) {
          const parent = parentRows[0];
          try {
            const { sendAbsenceAlert } = require('../services/messaging');
            await sendAbsenceAlert(parent.parent_phone, parent.student_name, parent.school_name, attendance_date);
          } catch (e) {
            console.error('WhatsApp send failed (non-blocking):', e.message);
          }
        }
      }
    }

    await connection.execute(
      `INSERT INTO sync_log (teacher_id, device_batch_id, records_count, synced_at)
       VALUES (?, ?, ?, NOW())`,
      [teacher_id, req.body.batch_id || 'manual', records.length]
    );

    await connection.commit();

    // Check consecutive absences for premium parents
    try {
      const { sendConsecutiveAbsenceAlert } = require('../services/messaging');
      for (const r of records) {
        if (r.status !== 'Absent') continue;
        const [absCnt] = await connection.execute(
          `SELECT COUNT(*) AS cnt FROM attendance_logs
           WHERE student_id = ? AND status = 'Absent'
             AND attendance_date >= DATE_SUB(?, INTERVAL 5 DAY)
             AND attendance_date <= ?`,
          [r.student_id, attendance_date, attendance_date]
        );
        if (absCnt[0].cnt >= 3) {
          const [parentRows] = await connection.execute(
            `SELECT p.parent_phone, s.full_name AS student_name, sch.school_name
             FROM students s
             JOIN schools sch ON s.school_id = sch.school_id
             JOIN student_parent_map m ON s.student_id = m.student_id
             JOIN parent_profiles p ON m.parent_phone = p.parent_phone
             WHERE s.student_id = ? AND p.is_premium = TRUE AND (p.premium_expires_at IS NULL OR p.premium_expires_at >= NOW())
             LIMIT 1`,
            [r.student_id]
          );
          for (const p of parentRows) {
            sendConsecutiveAbsenceAlert(p.parent_phone, p.student_name, absCnt[0].cnt, p.school_name)
              .catch(e => console.error('[WA] Consecutive absence alert failed:', e.message));
          }
        }
      }
    } catch (e) {
      console.error('[ATTENDANCE] Consecutive absence check error:', e.message);
    }

    res.json({ synced: records.length, date: attendance_date });
  } catch (err) {
    await connection.rollback();
    console.error('Attendance sync error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

router.get('/students/:teacher_id', async (req, res) => {
  try {
    const [teacherRows] = await req.db.execute(
      'SELECT school_id FROM teachers WHERE teacher_id = ?',
      [req.params.teacher_id]
    );
    if (teacherRows.length === 0) return res.status(404).json({ error: 'Teacher not found' });

    const [students] = await req.db.execute(
      'SELECT s.student_id, s.full_name, c.class_name FROM students s JOIN classes c ON s.class_id = c.class_id WHERE s.school_id = ? AND s.enrollment_status = ? ORDER BY c.class_name, s.full_name',
      [teacherRows[0].school_id, 'Active']
    );
    res.json({ students });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
