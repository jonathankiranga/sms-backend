const express = require('express');
const { ensureSchoolCallbackKey } = require('./payments');
const router = express.Router();

// GET /api/bazar-pay/fee-structures/:school_id — list fee items for a school
router.get('/fee-structures/:school_id', async (req, res) => {
  const { school_id } = req.params;
  const { term, year } = req.query;
  let sql = 'SELECT * FROM fee_structures WHERE school_id = ?';
  const params = [school_id];
  if (term) { sql += ' AND term = ?'; params.push(term); }
  if (year) { sql += ' AND academic_year = ?'; params.push(year); }
  sql += ' ORDER BY fee_name';
  const [rows] = await req.db.execute(sql, params);
  res.json(rows);
});

// GET /api/bazar-pay/dashboard — summary stats
router.get('/dashboard', async (req, res) => {
  const { school_id, term, year } = req.query;
  if (!school_id) return res.status(400).json({ error: 'school_id required' });

  // Total fee structure amount for this term/year
  const [feeTotal] = await req.db.execute(
    `SELECT COALESCE(SUM(fa.effective), 0) AS total_expected
     FROM (SELECT f.fee_id, f.amount, f.is_optional FROM fee_structures f WHERE f.school_id = ? AND f.term = ? AND f.academic_year = ?) f
     JOIN fee_assignments fa ON f.fee_id = fa.fee_id
     WHERE fa.waived = FALSE`,
    [school_id, term, year]
  );

  // Total paid (non-reversed)
  const [paidTotal] = await req.db.execute(
    `SELECT COALESCE(SUM(amount), 0) AS total_paid
     FROM payment_ledger
     WHERE school_id = ? AND term = ? AND academic_year = ? AND reversed_at IS NULL`,
    [school_id, term, year]
  );

  // Payment method breakdown
  const [methodBreakdown] = await req.db.execute(
    `SELECT payment_method, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
     FROM payment_ledger
     WHERE school_id = ? AND term = ? AND academic_year = ? AND reversed_at IS NULL
     GROUP BY payment_method
     ORDER BY total DESC`,
    [school_id, term, year]
  );

  // Today's collections
  const [todayTotal] = await req.db.execute(
    `SELECT COALESCE(SUM(amount), 0) AS today_total, COUNT(*) AS today_count
     FROM payment_ledger
     WHERE school_id = ? AND DATE(logged_at) = CURDATE() AND reversed_at IS NULL`,
    [school_id]
  );

  // Recent payments (last 10)
  const [recentPayments] = await req.db.execute(
    `SELECT p.*, s.full_name AS student_name
     FROM payment_ledger p
     LEFT JOIN students s ON p.student_reference = s.student_id
     WHERE p.school_id = ? AND p.reversed_at IS NULL
     ORDER BY p.logged_at DESC LIMIT 10`,
    [school_id]
  );

  // Student count
  const [studentCount] = await req.db.execute(
    'SELECT COUNT(*) AS total FROM students WHERE school_id = ? AND enrollment_status = ?',
    [school_id, 'Active']
  );

  res.json({
    total_expected: feeTotal[0]?.total_expected || 0,
    total_paid: paidTotal[0]?.total_paid || 0,
    outstanding: (feeTotal[0]?.total_expected || 0) - (paidTotal[0]?.total_paid || 0),
    collection_rate: feeTotal[0]?.total_expected > 0
      ? Math.round((paidTotal[0]?.total_paid || 0) / feeTotal[0].total_expected * 100 * 10) / 10
      : 0,
    method_breakdown: methodBreakdown,
    today: { total: todayTotal[0]?.today_total || 0, count: todayTotal[0]?.today_count || 0 },
    recent_payments: recentPayments,
    active_students: studentCount[0]?.total || 0
  });
});

// POST /api/bazar-pay/cash-payment — record manual payment
router.post('/cash-payment', async (req, res) => {
  const { school_id, student_id, amount, term, year, payment_method, notes, recorded_by } = req.body;
  if (!school_id || !student_id || !amount || !term || !year) {
    return res.status(400).json({ error: 'school_id, student_id, amount, term, year required' });
  }
  const validMethods = ['Cash', 'Bank Transfer', 'Cheque', 'M-Pesa'];
  const method = validMethods.includes(payment_method) ? payment_method : 'Cash';

  const ref = `${method === 'Cash' ? 'CSH' : method === 'Bank Transfer' ? 'BNK' : 'CHQ'}_${Date.now()}_${student_id}`;
  await req.db.execute(
    `INSERT INTO payment_ledger (transaction_reference, amount, parent_phone, student_reference, payment_method, school_id, term, academic_year, notes, recorded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [ref, amount, recorded_by || 'SYSTEM', student_id, method, school_id, term, year, notes || null, recorded_by || null]
  );

  // Fetch student name for response
  const [stu] = await req.db.execute('SELECT full_name FROM students WHERE student_id = ?', [student_id]);
  res.json({ success: true, transaction_reference: ref, student_name: stu[0]?.full_name || 'Unknown' });
});

// POST /api/bazar-pay/reverse-payment — reverse/void a payment
router.post('/reverse-payment', async (req, res) => {
  const { transaction_reference, reversed_by, reason } = req.body;
  if (!transaction_reference) return res.status(400).json({ error: 'transaction_reference required' });

  const [existing] = await req.db.execute(
    'SELECT * FROM payment_ledger WHERE transaction_reference = ?',
    [transaction_reference]
  );
  if (existing.length === 0) return res.status(404).json({ error: 'Payment not found' });
  if (existing[0].reversed_at) return res.status(400).json({ error: 'Payment already reversed' });

  await req.db.execute(
    'UPDATE payment_ledger SET reversed_at = NOW(), reversed_by = ?, notes = CONCAT(IFNULL(notes,?), ?) WHERE transaction_reference = ?',
    [reversed_by || 'SYSTEM', '', reason ? ` | REVERSED: ${reason}` : ' | REVERSED', transaction_reference]
  );

  res.json({ success: true, message: 'Payment reversed', transaction_reference });
});

// GET /api/bazar-pay/payments — list payments with filters
router.get('/payments', async (req, res) => {
  const { school_id, term, year, method, student_id, page = 1, limit = 50 } = req.query;
  if (!school_id) return res.status(400).json({ error: 'school_id required' });

  let sql = `SELECT p.*, s.full_name AS student_name, c.class_name
             FROM payment_ledger p
             LEFT JOIN students s ON p.student_reference = s.student_id
             LEFT JOIN classes c ON s.class_id = c.class_id
             WHERE p.school_id = ?`;
  const params = [school_id];

  if (term) { sql += ' AND p.term = ?'; params.push(term); }
  if (year) { sql += ' AND p.academic_year = ?'; params.push(year); }
  if (method) { sql += ' AND p.payment_method = ?'; params.push(method); }
  if (student_id) { sql += ' AND p.student_reference = ?'; params.push(student_id); }

  // Count total
  const [countResult] = await req.db.execute(
    sql.replace('p.*, s.full_name AS student_name, c.class_name', 'COUNT(*) AS total'),
    params
  );
  const totalRecords = countResult[0]?.total || 0;

  const offset = (parseInt(page) - 1) * parseInt(limit);
  sql += ' ORDER BY p.logged_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), offset);

  const [rows] = await req.db.execute(sql, params);
  res.json({
    payments: rows,
    pagination: { page: parseInt(page), limit: parseInt(limit), total: totalRecords, pages: Math.ceil(totalRecords / parseInt(limit)) }
  });
});

// GET /api/bazar-pay/student-balances — all students with fee summary
router.get('/student-balances', async (req, res) => {
  const { school_id, term, year, class_id } = req.query;
  if (!school_id || !term || !year) return res.status(400).json({ error: 'school_id, term, year required' });

  let studentSql = 'SELECT s.student_id, s.full_name, c.class_name, c.class_id FROM students s JOIN classes c ON s.class_id = c.class_id WHERE s.school_id = ? AND s.enrollment_status = ?';
  const studentParams = [school_id, 'Active'];
  if (class_id) { studentSql += ' AND s.class_id = ?'; studentParams.push(class_id); }
  studentSql += ' ORDER BY c.class_name, s.full_name';
  const [students] = await req.db.execute(studentSql, studentParams);

  // Get total fee amounts per student
  const [feeTotals] = await req.db.execute(
    `SELECT s.student_id, COALESCE(SUM(CASE WHEN fa.waived = FALSE THEN COALESCE(fa.adjusted_amount, f.amount) ELSE 0 END), 0) AS total_due
     FROM students s
     JOIN fee_assignments fa ON fa.student_id = s.student_id OR fa.class_id = s.class_id
     JOIN fee_structures f ON fa.fee_id = f.fee_id
     WHERE s.school_id = ? AND s.enrollment_status = ? AND f.term = ? AND f.academic_year = ?
     GROUP BY s.student_id`,
    [school_id, 'Active', term, year]
  );
  const dueMap = {};
  feeTotals.forEach(f => { dueMap[f.student_id] = parseFloat(f.total_due); });

  // Get total paid per student
  const [paidTotals] = await req.db.execute(
    `SELECT student_reference, COALESCE(SUM(amount), 0) AS total_paid
     FROM payment_ledger
     WHERE school_id = ? AND term = ? AND academic_year = ? AND reversed_at IS NULL
     GROUP BY student_reference`,
    [school_id, term, year]
  );
  const paidMap = {};
  paidTotals.forEach(p => { paidMap[p.student_reference] = parseFloat(p.total_paid); });

  const results = students.map(s => {
    const due = dueMap[s.student_id] || 0;
    const paid = paidMap[s.student_id] || 0;
    return {
      student_id: s.student_id,
      full_name: s.full_name,
      class_name: s.class_name,
      class_id: s.class_id,
      total_due: due,
      total_paid: paid,
      balance: due - paid,
      payment_status: paid >= due ? 'Paid' : paid > 0 ? 'Partial' : 'Unpaid'
    };
  });

  res.json({ students: results });
});

// GET /api/bazar-pay/statement/:student_id — full account statement
router.get('/statement/:student_id', async (req, res) => {
  const { student_id } = req.params;
  const { term, year } = req.query;
  if (!term || !year) return res.status(400).json({ error: 'term and year required' });

  const [student] = await req.db.execute(
    'SELECT s.*, c.class_name, c.school_id FROM students s JOIN classes c ON s.class_id = c.class_id WHERE s.student_id = ?',
    [student_id]
  );
  if (student.length === 0) return res.status(404).json({ error: 'Student not found' });

  // Fee items breakdown
  const [feeItems] = await req.db.execute(
    `SELECT f.fee_id, f.fee_name, f.amount, f.is_optional,
            COALESCE(fa.adjusted_amount, f.amount) AS effective_amount,
            fa.waived, fa.assignment_id
     FROM fee_structures f
     LEFT JOIN fee_assignments fa ON f.fee_id = fa.fee_id AND (fa.student_id = ? OR fa.class_id = (SELECT class_id FROM students WHERE student_id = ?))
     WHERE f.school_id = ? AND f.term = ? AND f.academic_year = ?
     ORDER BY f.fee_name`,
    [student_id, student_id, student[0].school_id, term, year]
  );

  // Transactions
  const [transactions] = await req.db.execute(
    `SELECT * FROM payment_ledger
     WHERE student_reference = ? AND term = ? AND academic_year = ?
     ORDER BY logged_at DESC`,
    [student_id, term, year]
  );

  const totalDue = feeItems.filter(f => !f.waived).reduce((sum, f) => sum + parseFloat(f.effective_amount), 0);
  const totalPaid = transactions.filter(t => !t.reversed_at).reduce((sum, t) => sum + parseFloat(t.amount), 0);

  res.json({
    student: student[0],
    term, year,
    fee_items: feeItems,
    transactions,
    summary: {
      total_due: totalDue,
      total_paid: totalPaid,
      balance: totalDue - totalPaid,
      payment_status: totalPaid >= totalDue ? 'Paid' : totalPaid > 0 ? 'Partial' : 'Unpaid'
    }
  });
});

// GET /api/bazar-pay/report — collection report
router.get('/report', async (req, res) => {
  const { school_id, term, year } = req.query;
  if (!school_id || !term || !year) return res.status(400).json({ error: 'school_id, term, year required' });

  // Class-wise collection
  const [classReport] = await req.db.execute(
    `SELECT c.class_id, c.class_name, COUNT(DISTINCT s.student_id) AS student_count,
            COALESCE(SUM(CASE WHEN fa.waived = FALSE THEN COALESCE(fa.adjusted_amount, f.amount) ELSE 0 END), 0) AS total_due,
            COALESCE(SUM(p.amount), 0) AS total_paid
     FROM classes c
     JOIN students s ON c.class_id = s.class_id AND s.enrollment_status = 'Active'
     LEFT JOIN fee_assignments fa ON fa.class_id = c.class_id OR fa.student_id = s.student_id
     LEFT JOIN fee_structures f ON fa.fee_id = f.fee_id AND f.term = ? AND f.academic_year = ?
     LEFT JOIN payment_ledger p ON p.student_reference = s.student_id AND p.term = ? AND p.academic_year = ? AND p.school_id = ? AND p.reversed_at IS NULL
     WHERE c.school_id = ?
     GROUP BY c.class_id, c.class_name
     ORDER BY c.class_name`,
    [term, year, term, year, school_id, school_id]
  );

  // Daily collections
  const [dailyCollections] = await req.db.execute(
    `SELECT DATE(logged_at) AS date, payment_method, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
     FROM payment_ledger
     WHERE school_id = ? AND term = ? AND academic_year = ? AND reversed_at IS NULL
     GROUP BY DATE(logged_at), payment_method
     ORDER BY date DESC LIMIT 30`,
    [school_id, term, year]
  );

  res.json({ class_report: classReport, daily_collections: dailyCollections });
});

// GET /api/bazar-pay/parent-subscriptions — list all parents with subscription status
// Allows bazar to see who has paid and who hasn't, and pay on behalf of those who haven't
router.get('/parent-subscriptions', async (req, res) => {
  const { school_id, term, year } = req.query;
  if (!school_id || !term || !year) return res.status(400).json({ error: 'school_id, term, year required' });

  // Get all unique parents linked to active students at this school
  const [parents] = await req.db.execute(
    `SELECT
      spm.parent_phone,
      pp.full_name AS parent_name,
      pp.is_premium,
      pp.premium_expires_at,
      GROUP_CONCAT(s.full_name ORDER BY s.full_name SEPARATOR ', ') AS children_names,
      GROUP_CONCAT(s.student_id ORDER BY s.full_name SEPARATOR ',') AS child_ids,
      COUNT(s.student_id) AS child_count
    FROM student_parent_map spm
    JOIN students s ON spm.student_id = s.student_id AND s.school_id = ? AND s.enrollment_status = 'Active'
    LEFT JOIN parent_profiles pp ON spm.parent_phone = pp.parent_phone
    GROUP BY spm.parent_phone, pp.full_name, pp.is_premium, pp.premium_expires_at
    ORDER BY pp.full_name, spm.parent_phone`,
    [school_id]
  );

  // Parents whose children have any non-reversed school-fee payment this term/year
  const [feePaid] = await req.db.execute(
    `SELECT DISTINCT spm.parent_phone
     FROM student_parent_map spm
     JOIN payment_ledger pl ON pl.student_reference = spm.student_id
     WHERE pl.school_id = ? AND pl.term = ? AND pl.academic_year = ? AND pl.reversed_at IS NULL`,
    [school_id, term, year]
  );
  const feePaidPhones = new Set(feePaid.map(r => r.parent_phone));

  const [activeSubs] = await req.db.execute(
    `SELECT parent_phone
     FROM premium_subscriptions
     WHERE school_id = ? AND term = ? AND year = ? AND payment_status = 'paid'
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [school_id, term, year]
  );
  const activeParentPhones = new Set(activeSubs.map(s => s.parent_phone));

  // Get app_settings for price
  const [setting] = await req.db.execute("SELECT setting_value FROM app_settings WHERE setting_key = 'premium_price'");
  const pricePerChild = parseInt(setting[0]?.setting_value || '100');

  const result = parents.map(p => {
    const activeFromSubscriptions = activeParentPhones.has(p.parent_phone);
    const activeFromProfile = p.is_premium && (!p.premium_expires_at || new Date(p.premium_expires_at) > new Date());
    const isActive = activeFromSubscriptions || activeFromProfile;
    const feesPaid = feePaidPhones.has(p.parent_phone);
    return {
      parent_phone: p.parent_phone,
      parent_name: p.parent_name || 'Unknown',
      child_count: p.child_count,
      children_names: p.children_names,
      child_ids: p.child_ids || '',
      is_active: isActive,
      fees_paid: feesPaid,
      cashback_candidate: feesPaid && !isActive,
      premium_expires_at: p.premium_expires_at,
      amount_due: isActive ? 0 : pricePerChild * p.child_count,
      price_per_child: pricePerChild
    };
  });
  result.sort((a, b) => (b.cashback_candidate ? 1 : 0) - (a.cashback_candidate ? 1 : 0) || a.parent_name.localeCompare(b.parent_name));
  const summary = {
    total_parents: result.length,
    active: result.filter(p => p.is_active).length,
    unpaid: result.filter(p => !p.is_active).length,
    cashback_candidates: result.filter(p => p.cashback_candidate).length,
    total_outstanding: result.filter(p => !p.is_active).reduce((sum, p) => sum + p.amount_due, 0)
  };

  res.json({ parents: result, summary });
});

// POST /api/bazar-pay/pay-bulk-subscriptions — bazar/vendor pays for all unpaid parents via a single STK push
router.post('/pay-bulk-subscriptions', async (req, res) => {
  const { school_id, term, year, school_phone, recorded_by } = req.body;
  if (!school_id || !term || !year || !school_phone) {
    return res.status(400).json({ error: 'school_id, term, year, school_phone required' });
  }

  try {
    // Dedupe: reject if there's an existing pending bulk STK submission for this school/term/year
    const [existingPending] = await req.db.execute(
      `SELECT COUNT(*) AS cnt FROM premium_bulk_payments WHERE school_id = ? AND term = ? AND year = ? AND payment_status = 'pending'`,
      [school_id, term, year]
    );
    if (existingPending[0]?.cnt > 0) {
      return res.status(409).json({ error: 'A pending bulk STK submission already exists for this school/term/year. Wait for it to complete or cancel it before initiating a new one.' });
    }

    const [activeSubs] = await req.db.execute(
      `SELECT parent_phone
       FROM premium_subscriptions
       WHERE school_id = ? AND term = ? AND year = ? AND payment_status = 'paid'
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [school_id, term, year]
    );
    const activeParentPhones = new Set(activeSubs.map(s => s.parent_phone));

    // Compute unpaid parents and total amount
    const [parents] = await req.db.execute(
      `SELECT spm.parent_phone, COUNT(s.student_id) AS child_count
       FROM student_parent_map spm
       JOIN students s ON spm.student_id = s.student_id AND s.school_id = ? AND s.enrollment_status = 'Active'
       LEFT JOIN parent_profiles pp ON spm.parent_phone = pp.parent_phone
       GROUP BY spm.parent_phone HAVING (pp.is_premium IS NULL OR pp.is_premium = 0)`
    , [school_id]);

    const unpaidParents = (parents || []).filter(p => !activeParentPhones.has(p.parent_phone));

    if (!unpaidParents || unpaidParents.length === 0) {
      return res.json({ success: true, message: 'No unpaid parents found', activated: 0 });
    }
    const [setting] = await req.db.execute("SELECT setting_value FROM app_settings WHERE setting_key = 'premium_price'");
    const pricePerChild = parseInt(setting[0]?.setting_value || '100');

    const totalStudents = unpaidParents.reduce((sum, p) => sum + (p.child_count || 1), 0);
    const totalAmount = unpaidParents.reduce((sum, p) => sum + ((p.child_count || 1) * pricePerChild), 0);

    // Insert pending bulk payment record
    const [result] = await req.db.execute(
      `INSERT INTO premium_bulk_payments (school_id, term, year, amount, total_students, initiated_by_phone, payment_status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [school_id, term, year, totalAmount, totalStudents, recorded_by || school_phone]
    );
    const paymentId = result.insertId;
    const reference = `BLK-${paymentId}`;

    // Ensure school has callback key
    const [schoolRows] = await req.db.execute('SELECT mpesa_callback_key FROM schools WHERE school_id = ?', [school_id]);
    const callbackKey = schoolRows[0]?.mpesa_callback_key || await ensureSchoolCallbackKey(req.db, school_id);

    // Initiate STK push to the school office phone using vendor MPESA credentials
    const mpesa = require('../services/mpesa');
    const stk = await mpesa.stkPush(school_phone, totalAmount, reference, 'School premium subscription payment', { callbackKey });

    // Store the reference so callback can match
    await req.db.execute('UPDATE premium_bulk_payments SET transaction_reference = ? WHERE payment_id = ?', [reference, paymentId]);

    if (stk.ResponseCode === '0') {
      return res.json({ success: true, status: 'pending', checkout_request_id: stk.CheckoutRequestID, transaction_reference: reference, amount: totalAmount, total_students: totalStudents });
    }

    // STK push failed
    await req.db.execute('UPDATE premium_bulk_payments SET payment_status = ? WHERE payment_id = ?', ['failed', paymentId]);
    return res.status(502).json({ error: 'M-Pesa STK push failed', detail: stk });
  } catch (err) {
    console.error('[BAZAR BULK STK]', err.message);
    res.status(500).json({ error: err.message });
  }
});


// POST /api/bazar-pay/pay-selected-subscriptions — bazar/vendor pays for selected parents via a single STK push
router.post('/pay-selected-subscriptions', async (req, res) => {
  const { school_id, term, year, parent_phones, school_phone, recorded_by } = req.body;
  if (!school_id || !term || !year || !Array.isArray(parent_phones) || parent_phones.length === 0 || !school_phone) {
    return res.status(400).json({ error: 'school_id, term, year, parent_phones (non-empty array), school_phone required' });
  }

  try {
    const [setting] = await req.db.execute("SELECT setting_value FROM app_settings WHERE setting_key = 'premium_price'");
    const pricePerChild = parseInt(setting[0]?.setting_value || '100');

    const [activeSubs] = await req.db.execute(
      `SELECT parent_phone
       FROM premium_subscriptions
       WHERE school_id = ? AND term = ? AND year = ? AND payment_status = 'paid'
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [school_id, term, year]
    );
    const activeParentPhones = new Set(activeSubs.map(s => s.parent_phone));

    // Dedupe: reject if any of the selected parent phones already have a pending STK entry for this school/term/year
    const placeholders = parent_phones.map(() => '?').join(',');
    const pendingParams = [...parent_phones, school_id, term, year];
    const [pendingRows] = await req.db.execute(
      `SELECT DISTINCT parent_phone FROM payment_ledger WHERE parent_phone IN (${placeholders}) AND school_id = ? AND term = ? AND academic_year = ? AND notes = 'STK_PENDING'`,
      pendingParams
    );
    if (pendingRows.length > 0) {
      const pendingPhones = pendingRows.map(r => r.parent_phone);
      return res.status(409).json({ error: 'Some selected parents already have a pending STK submission', pending_phones: pendingPhones });
    }

    const eligibleParentPhones = parent_phones.filter(phone => !activeParentPhones.has(phone));
    if (eligibleParentPhones.length === 0) {
      return res.json({ success: true, message: 'All selected parents are already paid for this term/year', activated: 0 });
    }

    // Calculate amount per parent (based on child count at this school)
    const parentDetails = [];
    for (const phone of eligibleParentPhones) {
      const [childRows] = await req.db.execute(
        `SELECT COUNT(*) AS cnt FROM student_parent_map spm JOIN students s ON spm.student_id = s.student_id WHERE spm.parent_phone = ? AND s.school_id = ? AND s.enrollment_status = 'Active'`,
        [phone, school_id]
      );
      const childCount = childRows[0]?.cnt || 1;
      const amount = pricePerChild * childCount;
      parentDetails.push({ phone, childCount, amount });
    }

    const totalStudents = parentDetails.reduce((sum, p) => sum + p.childCount, 0);
    const totalAmount = parentDetails.reduce((sum, p) => sum + p.amount, 0);

    // Insert premium_bulk_payments record for tracking
    const [resIns] = await req.db.execute(
      `INSERT INTO premium_bulk_payments (school_id, term, year, amount, total_students, initiated_by_phone, payment_status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [school_id, term, year, totalAmount, totalStudents, recorded_by || school_phone]
    );
    const paymentId = resIns.insertId;
    const reference = `BAZPAY-${paymentId}`;

    // Insert STK_PENDING payment_ledger rows for each selected parent with same reference
    const conn = await req.db.getConnection();
    try {
      await conn.beginTransaction();
      for (const p of parentDetails) {
        await conn.execute(
          `INSERT INTO payment_ledger (transaction_reference, amount, parent_phone, student_reference, payment_method, school_id, term, academic_year, notes, recorded_by, logged_at)
           VALUES (?, ?, ?, ?, 'M-Pesa-Pending', ?, ?, ?, 'STK_PENDING', ?, NOW())`,
          [reference, p.amount, p.phone, `SUB-${p.phone}`, school_id, term, year, recorded_by || 'BAZAR']
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    // Ensure school has callback key
    const [schoolRows] = await req.db.execute('SELECT mpesa_callback_key FROM schools WHERE school_id = ?', [school_id]);
    const callbackKey = schoolRows[0]?.mpesa_callback_key || await ensureSchoolCallbackKey(req.db, school_id);

    // Initiate STK push to school office phone
    const mpesa = require('../services/mpesa');
    const stk = await mpesa.stkPush(school_phone, totalAmount, reference, 'School selected subscriptions payment', { callbackKey });

    // Store the transaction reference in the bulk tracking row
    await req.db.execute('UPDATE premium_bulk_payments SET transaction_reference = ? WHERE payment_id = ?', [reference, paymentId]);

    if (stk.ResponseCode === '0') {
      return res.json({ success: true, status: 'pending', checkout_request_id: stk.CheckoutRequestID, transaction_reference: reference, amount: totalAmount, total_students: totalStudents, parents: eligibleParentPhones.length });
    }

    // Mark bulk record failed
    await req.db.execute('UPDATE premium_bulk_payments SET payment_status = ? WHERE payment_id = ?', ['failed', paymentId]);
    return res.status(502).json({ error: 'M-Pesa STK push failed', detail: stk });
  } catch (err) {
    console.error('[BAZAR SELECTED BULK STK]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
