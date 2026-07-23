const express = require('express');
const router = express.Router();

// GET /api/fees?school_id=X&term=Term%201&year=2026
router.get('/', async (req, res) => {
  const { school_id, term, year } = req.query;
  if (!school_id) return res.status(400).json({ error: 'school_id required' });
  let sql = 'SELECT f.*, (SELECT COUNT(*) FROM fee_assignments WHERE fee_id = f.fee_id) AS assigned_count FROM fee_structures f WHERE f.school_id = ?';
  const params = [school_id];
  if (term) { sql += ' AND f.term = ?'; params.push(term); }
  if (year) { sql += ' AND f.academic_year = ?'; params.push(year); }
  sql += ' ORDER BY f.fee_name';
  const [rows] = await req.db.execute(sql, params);
  res.json({ fees: rows });
});

// POST /api/fees — create fee item
router.post('/', async (req, res) => {
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
router.delete('/:fee_id', async (req, res) => {
  await req.db.execute('DELETE FROM fee_assignments WHERE fee_id = ?', [req.params.fee_id]);
  await req.db.execute('DELETE FROM fee_structures WHERE fee_id = ?', [req.params.fee_id]);
  res.json({ deleted: true });
});

// POST /api/fees/assign — assign fee to class or student
router.post('/assign', async (req, res) => {
  const { fee_id, class_id, student_id, adjusted_amount, waived } = req.body;
  if (!fee_id) return res.status(400).json({ error: 'fee_id required' });
  await req.db.execute(
    'INSERT INTO fee_assignments (fee_id, class_id, student_id, adjusted_amount, waived) VALUES (?, ?, ?, ?, ?)',
    [fee_id, class_id || null, student_id || null, adjusted_amount || null, waived || false]
  );
  res.json({ assigned: true });
});

// GET /api/fees/statement/:student_id/:term/:year
router.get('/statement/:student_id/:term/:year', async (req, res) => {
  const { student_id, term, year } = req.params;
  const [fees] = await req.db.execute(
    `SELECT f.fee_id, f.fee_name, f.amount, f.is_optional,
            fa.adjusted_amount, fa.waived,
            COALESCE((SELECT SUM(pl.amount) FROM payment_ledger pl WHERE pl.student_reference = ? AND pl.logged_at LIKE CONCAT(?, '%')), 0) AS paid
     FROM fee_structures f
     LEFT JOIN fee_assignments fa ON f.fee_id = fa.fee_id AND (fa.student_id = ? OR fa.class_id = (SELECT class_id FROM students WHERE student_id = ?))
     WHERE f.term = ? AND f.academic_year = ?
       AND (f.is_optional = FALSE OR fa.assignment_id IS NOT NULL)
     ORDER BY f.fee_name`,
    [student_id, year, student_id, student_id, term, year]
  );
  const items = fees.map(f => ({
    ...f,
    effective_amount: f.waived ? 0 : (f.adjusted_amount || f.amount),
    balance: (f.waived ? 0 : (f.adjusted_amount || f.amount)) - f.paid
  }));
  const total_due = items.reduce((s, i) => s + i.effective_amount, 0);
  const total_paid = items.reduce((s, i) => s + i.paid, 0);
  res.json({ items, total_due, total_paid, balance: total_due - total_paid });
});

// GET /api/fees/classes?school_id=X — for dropdown
router.get('/classes', async (req, res) => {
  const { school_id } = req.query;
  const [rows] = await req.db.execute('SELECT class_id, class_name FROM classes WHERE school_id = ? ORDER BY class_name', [school_id]);
  res.json({ classes: rows });
});

module.exports = router;
