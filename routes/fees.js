const express = require('express');
const router = express.Router();

async function readSession(req) {
  const auth = (req.headers.authorization || '').trim();
  if (!auth.startsWith('Bearer ')) return null;
  const sessionId = auth.slice(7).trim();
  const [rows] = await req.db.execute(
    'SELECT phone, email, teacher_id, verified, expires_at FROM otp_sessions WHERE session_id = ? LIMIT 1',
    [sessionId]
  );
  const session = rows[0];
  if (!session || !session.verified || !session.expires_at || new Date(session.expires_at) <= new Date()) return null;
  return session;
}

async function resolveStaff(db, session) {
  let rows = [];
  if (session.teacher_id) {
    [rows] = await db.execute(
      'SELECT teacher_id, school_id, role, active FROM teachers WHERE teacher_id = ? LIMIT 1',
      [session.teacher_id]
    );
  }
  if (rows.length === 0 && session.phone) {
    [rows] = await db.execute(
      'SELECT teacher_id, school_id, role, active FROM teachers WHERE phone = ? LIMIT 1',
      [session.phone]
    );
  }
  if (rows.length === 0 && session.email) {
    [rows] = await db.execute(
      'SELECT teacher_id, school_id, role, active FROM teachers WHERE email = ? LIMIT 1',
      [session.email]
    );
  }
  return rows[0] || null;
}

async function requireFeeStaff(req, res, next) {
  try {
    const session = await readSession(req);
    if (!session) return res.status(401).json({ error: 'Authentication required' });
    const staff = await resolveStaff(req.db, session);
    const allowedRoles = req.method === 'GET' && req.path === '/classes' ? ['teacher', 'head', 'bursar'] : ['head', 'bursar'];
    if (!staff || !allowedRoles.includes(staff.role) || staff.active === 0) {
      return res.status(403).json({ error: 'Headteacher or bursar access is required' });
    }

    let feeId = req.params.fee_id || req.body.fee_id || null;
    if (!feeId && req.body.assignment_id) {
      const [assignments] = await req.db.execute(
        'SELECT fee_id FROM fee_assignments WHERE assignment_id = ? LIMIT 1',
        [req.body.assignment_id]
      );
      feeId = assignments[0]?.fee_id || null;
    }
    if (feeId) {
      const [fees] = await req.db.execute('SELECT school_id FROM fee_structures WHERE fee_id = ? LIMIT 1', [feeId]);
      if (!fees[0] || fees[0].school_id !== staff.school_id) {
        return res.status(403).json({ error: 'Fee item does not belong to your school' });
      }
    }

    const requestedSchool = req.body.school_id || req.query.school_id;
    if (requestedSchool && requestedSchool !== staff.school_id) {
      return res.status(403).json({ error: 'You cannot access another school' });
    }
    req.staff = staff;
    next();
  } catch (err) {
    next(err);
  }
}

async function requireFeeStatementAccess(req, res, next) {
  try {
    const session = await readSession(req);
    if (!session) return res.status(401).json({ error: 'Authentication required' });
    const [students] = await req.db.execute(
      'SELECT student_id, school_id FROM students WHERE student_id = ? LIMIT 1',
      [req.params.student_id]
    );
    const student = students[0];
    if (!student) return res.status(404).json({ error: 'Learner not found' });

    if (session.phone) {
      const [links] = await req.db.execute(
        'SELECT student_id FROM student_parent_map WHERE student_id = ? AND parent_phone = ? LIMIT 1',
        [student.student_id, session.phone]
      );
      if (links.length > 0) {
        req.feeStudent = student;
        return next();
      }
    }

    const staff = await resolveStaff(req.db, session);
    if (staff && ['teacher', 'head', 'bursar'].includes(staff.role) && staff.school_id === student.school_id && staff.active !== 0) {
      req.staff = staff;
      req.feeStudent = student;
      return next();
    }
    return res.status(403).json({ error: 'You are not linked to this learner' });
  } catch (err) {
    next(err);
  }
}

// GET /api/fees?school_id=X&term=Term%201&year=2026
router.get('/', requireFeeStaff, async (req, res) => {
  const { school_id, term, year } = req.query;
  if (!school_id) return res.status(400).json({ error: 'school_id required' });
  let sql = `SELECT f.*,
    (SELECT COUNT(*) FROM fee_assignments WHERE fee_id = f.fee_id) AS assigned_count,
    (SELECT GROUP_CONCAT(DISTINCT c.class_name ORDER BY c.class_name SEPARATOR ', ')
       FROM fee_assignments fa JOIN classes c ON fa.class_id = c.class_id
      WHERE fa.fee_id = f.fee_id) AS assigned_classes
  FROM fee_structures f WHERE f.school_id = ?`;
  const params = [school_id];
  if (term) { sql += ' AND f.term = ?'; params.push(term); }
  if (year) { sql += ' AND f.academic_year = ?'; params.push(year); }
  sql += ' ORDER BY f.fee_name';
  const [rows] = await req.db.execute(sql, params);
  res.json({ fees: rows });
});

// POST /api/fees — create fee item
router.post('/', requireFeeStaff, async (req, res) => {
  const { school_id, fee_name, amount, term, academic_year, is_optional } = req.body;
  if (!school_id || !fee_name || !amount || !term || !academic_year) {
    return res.status(400).json({ error: 'school_id, fee_name, amount, term, academic_year required' });
  }
  const [r] = await req.db.execute(
    'INSERT INTO fee_structures (school_id, fee_name, amount, term, academic_year, is_optional) VALUES (?, ?, ?, ?, ?, ?)',
    [school_id, fee_name, amount, term, academic_year, is_optional || false]
  );
  res.json({ fee_id: r.insertId, fee_name, amount });
});

// DELETE /api/fees/:fee_id
router.delete('/:fee_id', requireFeeStaff, async (req, res) => {
  await req.db.execute('DELETE FROM fee_assignments WHERE fee_id = ?', [req.params.fee_id]);
  await req.db.execute('DELETE FROM fee_structures WHERE fee_id = ?', [req.params.fee_id]);
  res.json({ deleted: true });
});

// POST /api/fees/assign — assign fee to class or student
router.post('/assign', requireFeeStaff, async (req, res) => {
  const { fee_id, class_id, student_id, adjusted_amount, waived } = req.body;
  if (!fee_id) return res.status(400).json({ error: 'fee_id required' });
  await req.db.execute(
    'INSERT INTO fee_assignments (fee_id, class_id, student_id, adjusted_amount, waived) VALUES (?, ?, ?, ?, ?)',
    [fee_id, class_id || null, student_id || null, adjusted_amount || null, waived || false]
  );
  res.json({ assigned: true });
});

// POST /api/fees/unassign — remove a fee assignment
router.post('/unassign', requireFeeStaff, async (req, res) => {
  const { assignment_id, fee_id, class_id, student_id } = req.body;
  if (assignment_id) {
    await req.db.execute('DELETE FROM fee_assignments WHERE assignment_id = ?', [assignment_id]);
  } else if (fee_id) {
    if (class_id) await req.db.execute('DELETE FROM fee_assignments WHERE fee_id = ? AND class_id = ?', [fee_id, class_id]);
    else if (student_id) await req.db.execute('DELETE FROM fee_assignments WHERE fee_id = ? AND student_id = ?', [fee_id, student_id]);
    else return res.status(400).json({ error: 'assignment_id, or fee_id with class_id/student_id required' });
  } else {
    return res.status(400).json({ error: 'assignment_id, or fee_id with class_id/student_id required' });
  }
  res.json({ unassigned: true });
});

// GET /api/fees/statement/:student_id/:term/:year
router.get('/statement/:student_id/:term/:year', requireFeeStatementAccess, async (req, res) => {
  const { student_id, term, year } = req.params;
  const [fees] = await req.db.execute(
    `SELECT f.fee_id, f.fee_name, f.amount, f.is_optional,
            fa.adjusted_amount, fa.waived
     FROM fee_structures f
     LEFT JOIN fee_assignments fa ON f.fee_id = fa.fee_id AND (fa.student_id = ? OR fa.class_id = (SELECT class_id FROM students WHERE student_id = ?))
     WHERE f.school_id = (SELECT school_id FROM students WHERE student_id = ?)
       AND f.term = ? AND f.academic_year = ?
       AND (f.is_optional = FALSE OR fa.assignment_id IS NOT NULL)
     ORDER BY f.fee_name`,
    [student_id, student_id, student_id, term, year]
  );
  const [paidRows] = await req.db.execute(
    `SELECT COALESCE(SUM(amount), 0) AS total_paid
     FROM payment_ledger
     WHERE student_reference = ? AND school_id = (SELECT school_id FROM students WHERE student_id = ?)
       AND term = ? AND academic_year = ? AND reversed_at IS NULL`,
    [student_id, student_id, term, year]
  );
  const total_paid = parseFloat(paidRows[0]?.total_paid || 0);
  const items = fees.map(f => ({
    ...f,
    effective_amount: f.waived ? 0 : (f.adjusted_amount || f.amount),
  }));
  const total_due = items.reduce((s, i) => s + i.effective_amount, 0);

  // Fetch school contact to include on fee statement
  const [studentInfo] = await req.db.execute('SELECT school_id FROM students WHERE student_id = ?', [student_id]);
  const schoolId = studentInfo[0]?.school_id || null;
  let schoolContact = null;
  if (schoolId) {
    const [srows] = await req.db.execute('SELECT school_id, school_name, contact_name, contact_phone, contact_email, contact_address, contact_website FROM schools WHERE school_id = ?', [schoolId]);
    schoolContact = srows[0] || null;
  }

  res.json({ items, total_due, total_paid, balance: total_due - total_paid, school_contact: schoolContact });
});

// GET /api/fees/classes?school_id=X — for dropdown
router.get('/classes', requireFeeStaff, async (req, res) => {
  const { school_id } = req.query;
  const [rows] = await req.db.execute('SELECT class_id, class_name FROM classes WHERE school_id = ? ORDER BY class_name', [school_id]);
  res.json({ classes: rows });
});

module.exports = router;
