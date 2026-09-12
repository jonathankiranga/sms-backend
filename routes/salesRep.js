const express = require('express');
const crypto = require('crypto');
const router = express.Router();

// ─── Auth Middleware ──────────────────────────────────────────────────────────
// Verifies Bearer token from Authorization header against otp_sessions.
// Attaches full sales rep profile to req.salesRep.
async function requireSalesRepAuth(req, res, next) {
  const auth = (req.headers.authorization || '').trim();
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const sessionId = auth.split(' ')[1];
  try {
    const [rows] = await req.db.execute(
      'SELECT phone, email, verified, expires_at FROM otp_sessions WHERE session_id = ?',
      [sessionId]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid session' });
    const sess = rows[0];
    if (!sess.verified || !sess.expires_at || new Date(sess.expires_at) <= new Date()) {
      return res.status(401).json({ error: 'Session expired' });
    }

    // Resolve the sales rep from the session phone or email
    let rep = null;
    if (sess.phone) {
      const [repRows] = await req.db.execute(
        'SELECT rep_id, full_name, phone, email, commission_type, commission_value FROM sales_reps WHERE phone = ? LIMIT 1',
        [sess.phone]
      );
      if (repRows.length) rep = repRows[0];
    }
    if (!rep && sess.email) {
      const [repRows] = await req.db.execute(
        'SELECT rep_id, full_name, phone, email, commission_type, commission_value FROM sales_reps WHERE email = ? LIMIT 1',
        [sess.email]
      );
      if (repRows.length) rep = repRows[0];
    }
    if (!rep) return res.status(401).json({ error: 'Sales rep account not found' });

    req.salesRep = rep;
    next();
  } catch (err) {
    console.error('[SALES-REP AUTH]', err.message);
    res.status(500).json({ error: 'Authentication error' });
  }
}

// ─── OTP Request ─────────────────────────────────────────────────────────────
// POST /api/sales-rep/request-otp
// Body: { phone?, email? }
router.post('/request-otp', async (req, res) => {
  const { phone, email } = req.body;
  if (!phone && !email) return res.status(400).json({ error: 'Phone or email required' });

  try {
    // Look up the sales rep by phone or email
    const [repRows] = await req.db.execute(
      'SELECT rep_id, full_name, phone, email FROM sales_reps WHERE (phone = ? OR email = ?) LIMIT 1',
      [phone || '', email || '']
    );
    if (repRows.length === 0) {
      return res.status(404).json({ error: 'No sales rep account found with that phone or email' });
    }

    const rep = repRows[0];
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const sessionId = crypto.randomBytes(32).toString('hex');

    // otp_sessions.phone is NOT NULL — use empty string for email-only reps
    await req.db.execute(
      'INSERT INTO otp_sessions (session_id, phone, email, code, expires_at, verified) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE), FALSE)',
      [sessionId, rep.phone || '', rep.email || null, code]
    );

    // Send OTP via messaging service (non-blocking)
    try {
      const messaging = require('../services/messaging');
      const contactEmail = rep.email || email;
      const contactPhone = rep.phone || phone;
      if (contactEmail && messaging.sendEmailOtp) {
        await messaging.sendEmailOtp(contactEmail, code);
      } else if (contactPhone) {
        await messaging.sendOtp(contactPhone, code);
      }
    } catch (e) {
      console.error('[SALES-REP OTP send failed (non-blocking)]:', e.message);
      // Always log fallback so it can be retrieved in dev
      console.log(`=== Sales Rep OTP for ${rep.phone || rep.email}: ${code} ===`);
    }

    res.json({ session_id: sessionId, message: 'OTP sent' });
  } catch (err) {
    console.error('[SALES-REP request-otp]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── OTP Verify ──────────────────────────────────────────────────────────────
// POST /api/sales-rep/verify-otp
// Body: { session_id, code }
router.post('/verify-otp', async (req, res) => {
  const { session_id, code } = req.body;
  if (!session_id || !code) return res.status(400).json({ error: 'Missing session_id or code' });

  try {
    const [rows] = await req.db.execute(
      'SELECT phone, email FROM otp_sessions WHERE session_id = ? AND code = ? AND expires_at > NOW() AND verified = FALSE',
      [session_id, code]
    );

    if (rows.length === 0) {
      // Distinguish expired-but-correct from plain wrong
      const [expiredRows] = await req.db.execute(
        'SELECT phone FROM otp_sessions WHERE session_id = ? AND code = ? AND verified = FALSE',
        [session_id, code]
      );
      if (expiredRows.length > 0) {
        return res.status(410).json({ error: 'Code expired — tap Resend to get a new one' });
      }
      return res.status(401).json({ error: 'Invalid or expired code' });
    }

    const sess = rows[0];

    // Mark session verified and extend to 4 hours
    await req.db.execute(
      'UPDATE otp_sessions SET verified = TRUE, expires_at = DATE_ADD(NOW(), INTERVAL 4 HOUR) WHERE session_id = ?',
      [session_id]
    );

    // Resolve the sales rep
    let rep = null;
    if (sess.phone) {
      const [repRows] = await req.db.execute(
        'SELECT rep_id, full_name, phone, email FROM sales_reps WHERE phone = ? LIMIT 1',
        [sess.phone]
      );
      if (repRows.length) rep = repRows[0];
    }
    if (!rep && sess.email) {
      const [repRows] = await req.db.execute(
        'SELECT rep_id, full_name, phone, email FROM sales_reps WHERE email = ? LIMIT 1',
        [sess.email]
      );
      if (repRows.length) rep = repRows[0];
    }
    if (!rep) return res.status(404).json({ error: 'Sales rep account not found' });

    res.json({
      rep_id:    rep.rep_id,
      full_name: rep.full_name,
      session_id,
      verified:  true
    });
  } catch (err) {
    console.error('[SALES-REP verify-otp]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Profile ─────────────────────────────────────────────────────────────────
// GET /api/sales-rep/profile
router.get('/profile', requireSalesRepAuth, async (req, res) => {
  const { rep_id } = req.salesRep;
  try {
    // Get full rep details
    const [repRows] = await req.db.execute(
      'SELECT rep_id, full_name, phone, email, commission_type, commission_value FROM sales_reps WHERE rep_id = ?',
      [rep_id]
    );
    if (!repRows.length) return res.status(404).json({ error: 'Rep not found' });
    const rep = repRows[0];

    // Count assigned schools
    const [[{ school_count }]] = await req.db.execute(
      'SELECT COUNT(*) AS school_count FROM schools WHERE sales_rep_id = ?',
      [rep_id]
    );

    // All-time stats: total revenue and commission across all paid subscriptions
    const [[stats]] = await req.db.execute(
      `SELECT
         COALESCE(SUM(ps.amount), 0)        AS total_revenue,
         COUNT(ps.subscription_id)           AS total_transactions
       FROM schools sc
       LEFT JOIN premium_subscriptions ps
              ON ps.school_id = sc.school_id
             AND ps.payment_status = 'paid'
       WHERE sc.sales_rep_id = ?`,
      [rep_id]
    );

    res.json({
      ...rep,
      school_count:        Number(school_count),
      total_revenue:       Number(stats.total_revenue),
      total_transactions:  Number(stats.total_transactions)
    });
  } catch (err) {
    console.error('[SALES-REP profile]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Commission Calculation ───────────────────────────────────────────────────
// GET /api/sales-rep/commission?term=&year=
// Reuses the same calcRepCommission logic from admin-api.js (duplicated here
// to keep the routes independent and avoid coupling to admin-api internals).
async function calcRepCommission(db, repId, term, year) {
  // Pull parent-pays revenue: sum of amounts in premium_subscriptions
  const [parentRows] = await db.execute(
    `SELECT
       sc.school_id,
       sc.school_name,
       sr.commission_type,
       sr.commission_value,
       COALESCE(SUM(ps.amount), 0) AS parent_revenue,
       COUNT(ps.subscription_id)   AS transactions
     FROM schools sc
     JOIN sales_reps sr ON sc.sales_rep_id = sr.rep_id
     LEFT JOIN premium_subscriptions ps
            ON ps.school_id = sc.school_id
           AND ps.payment_status = 'paid'
           AND ps.payment_model = 'parent'
           AND ps.term = ?
           AND ps.year = ?
     WHERE sc.sales_rep_id = ?
     GROUP BY sc.school_id, sc.school_name, sr.commission_type, sr.commission_value`,
    [term, year, repId]
  );

  // Pull school-pays revenue: sum of completed bulk payments
  const [bulkRows] = await db.execute(
    `SELECT
       sc.school_id,
       COALESCE(SUM(bp.amount), 0)  AS bulk_revenue,
       COUNT(bp.payment_id)          AS bulk_transactions
     FROM schools sc
     LEFT JOIN premium_bulk_payments bp
            ON bp.school_id = sc.school_id
           AND bp.payment_status = 'completed'
           AND bp.term = ?
           AND bp.year = ?
     WHERE sc.sales_rep_id = ?
     GROUP BY sc.school_id`,
    [term, year, repId]
  );

  // Index bulk revenue and transaction count by school_id for fast lookup
  const bulkBySchool = {};
  for (const b of bulkRows) {
    bulkBySchool[b.school_id] = {
      revenue:      Number(b.bulk_revenue),
      transactions: Number(b.bulk_transactions),
    };
  }

  let totalRevenue = 0;
  let totalCommission = 0;
  const breakdown = [];

  for (const row of parentRows) {
    const parentRev   = Number(row.parent_revenue);
    const bulk        = bulkBySchool[row.school_id] || { revenue: 0, transactions: 0 };
    const rev         = parentRev + bulk.revenue;
    // Total transactions = parent subscriptions + bulk payment events
    const totalTxns   = Number(row.transactions) + bulk.transactions;

    const comm = row.commission_type === 'flat'
      ? Number(row.commission_value) * totalTxns
      : rev * (Number(row.commission_value) / 100);

    totalRevenue    += rev;
    totalCommission += comm;

    breakdown.push({
      school_id:    row.school_id,
      school_name:  row.school_name,
      revenue:      rev,
      transactions: totalTxns,
      commission:   Math.round(comm * 100) / 100
    });
  }

  return {
    rep_id:            repId,
    term,
    year,
    revenue_base:      Math.round(totalRevenue * 100) / 100,
    commission_amount: Math.round(totalCommission * 100) / 100,
    breakdown
  };
}

router.get('/commission', requireSalesRepAuth, async (req, res) => {
  const { term, year } = req.query;
  if (!term || !year) return res.status(400).json({ error: 'term and year are required' });

  try {
    const result = await calcRepCommission(req.db, req.salesRep.rep_id, term, parseInt(year));

    // Check if a payment request exists for this term/year
    const [paymentRows] = await req.db.execute(
      'SELECT payment_id, payment_status FROM commission_payments WHERE rep_id = ? AND term = ? AND year = ?',
      [req.salesRep.rep_id, term, parseInt(year)]
    );
    result.existing_payment = paymentRows.length ? paymentRows[0] : null;

    res.json(result);
  } catch (err) {
    console.error('[SALES-REP commission]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── My Payments ─────────────────────────────────────────────────────────────
// GET /api/sales-rep/payments
router.get('/payments', requireSalesRepAuth, async (req, res) => {
  try {
    const [rows] = await req.db.execute(
      `SELECT payment_id, term, year, commission_amount, revenue_base,
              payment_status, request_notes, rejection_reason, payment_reference,
              created_at, approved_at, paid_at
       FROM commission_payments
       WHERE rep_id = ?
       ORDER BY created_at DESC`,
      [req.salesRep.rep_id]
    );
    res.json({ payments: rows });
  } catch (err) {
    console.error('[SALES-REP payments GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Request Payment ─────────────────────────────────────────────────────────
// POST /api/sales-rep/payments
// Body: { term, year, request_notes? }
router.post('/payments', requireSalesRepAuth, async (req, res) => {
  const { term, year, request_notes } = req.body;
  const rep_id = req.salesRep.rep_id;

  if (!term || !year) return res.status(400).json({ error: 'term and year are required' });

  try {
    // Check for duplicate
    const [existing] = await req.db.execute(
      'SELECT payment_id, payment_status FROM commission_payments WHERE rep_id = ? AND term = ? AND year = ?',
      [rep_id, term, parseInt(year)]
    );
    if (existing.length) {
      return res.status(409).json({
        error: `A payment request for ${term} ${year} already exists`,
        existing: existing[0]
      });
    }

    // Calculate commission
    const calc = await calcRepCommission(req.db, rep_id, term, parseInt(year));
    if (calc.commission_amount <= 0) {
      return res.status(400).json({
        error: `No commission earned for ${term} ${year}. Revenue was KSh ${calc.revenue_base}.`
      });
    }

    // Insert payment request
    const [result] = await req.db.execute(
      `INSERT INTO commission_payments (rep_id, term, year, commission_amount, revenue_base, payment_status, request_notes)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      [rep_id, term, parseInt(year), calc.commission_amount, calc.revenue_base, request_notes || null]
    );

    // Save per-school breakdown
    for (const row of calc.breakdown) {
      await req.db.execute(
        `INSERT IGNORE INTO commission_calculations
           (rep_id, school_id, term, year, revenue_amount, commission_type, commission_value, calculated_commission)
         SELECT ?, ?, ?, ?, ?, commission_type, commission_value, ?
         FROM sales_reps WHERE rep_id = ?`,
        [rep_id, row.school_id, term, parseInt(year), row.revenue, row.commission, rep_id]
      );
    }

    // Audit log
    await req.db.execute(
      `INSERT INTO commission_audit_log (action_type, payment_id, rep_id, term, year, performed_by, details)
       VALUES ('requested', ?, ?, ?, ?, ?, ?)`,
      [result.insertId, rep_id, term, parseInt(year), rep_id,
       JSON.stringify({ commission_amount: calc.commission_amount, revenue_base: calc.revenue_base })]
    );

    res.json({
      payment_id:        result.insertId,
      rep_id,
      term,
      year:              parseInt(year),
      commission_amount: calc.commission_amount,
      revenue_base:      calc.revenue_base,
      payment_status:    'pending',
      breakdown:         calc.breakdown
    });
  } catch (err) {
    console.error('[SALES-REP payments POST]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Wallet ───────────────────────────────────────────────────────────────────
// GET /api/sales-rep/wallet  — get wallet balance + recent transactions
router.get('/wallet', requireSalesRepAuth, async (req, res) => {
  const { rep_id } = req.salesRep;
  try {
    // Ensure wallet row exists
    await req.db.execute(
      'INSERT IGNORE INTO rep_wallets (rep_id, balance, total_credited, total_withdrawn) VALUES (?, 0, 0, 0)',
      [rep_id]
    );
    const [[wallet]] = await req.db.execute(
      'SELECT balance, total_credited, total_withdrawn FROM rep_wallets WHERE rep_id = ?',
      [rep_id]
    );
    const [txns] = await req.db.execute(
      'SELECT txn_id, txn_type, amount, balance_after, description, reference_type, created_at FROM wallet_transactions WHERE rep_id = ? ORDER BY created_at DESC LIMIT 50',
      [rep_id]
    );
    const [withdrawals] = await req.db.execute(
      'SELECT withdrawal_id, amount, status, mpesa_phone, mpesa_reference, requested_at, completed_at FROM wallet_withdrawals WHERE rep_id = ? ORDER BY requested_at DESC LIMIT 20',
      [rep_id]
    );
    res.json({
      balance:          Number(wallet.balance),
      total_credited:   Number(wallet.total_credited),
      total_withdrawn:  Number(wallet.total_withdrawn),
      transactions:     txns,
      withdrawals:      withdrawals,
    });
  } catch (err) {
    console.error('[WALLET GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sales-rep/wallet/withdraw  — request M-Pesa withdrawal
// Body: { amount, mpesa_phone }
router.post('/wallet/withdraw', requireSalesRepAuth, async (req, res) => {
  const { rep_id, phone } = req.salesRep;
  const { amount, mpesa_phone } = req.body;

  if (!amount || isNaN(amount) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Valid amount required' });
  }
  const withdrawAmount = Math.round(Number(amount) * 100) / 100;
  const targetPhone = mpesa_phone || phone;
  if (!targetPhone) return res.status(400).json({ error: 'M-Pesa phone number required' });

  const conn = await req.db.getConnection();
  try {
    await conn.beginTransaction();

    // Ensure wallet exists and lock the row
    await conn.execute(
      'INSERT IGNORE INTO rep_wallets (rep_id, balance, total_credited, total_withdrawn) VALUES (?, 0, 0, 0)',
      [rep_id]
    );
    const [[wallet]] = await conn.execute(
      'SELECT balance FROM rep_wallets WHERE rep_id = ? FOR UPDATE',
      [rep_id]
    );
    const currentBalance = Number(wallet.balance);
    if (withdrawAmount > currentBalance) {
      await conn.rollback();
      return res.status(400).json({
        error: `Insufficient balance. Available: KSh ${currentBalance.toLocaleString()}, Requested: KSh ${withdrawAmount.toLocaleString()}`
      });
    }

    // Create withdrawal record
    const [wResult] = await conn.execute(
      "INSERT INTO wallet_withdrawals (rep_id, amount, status, mpesa_phone) VALUES (?, ?, 'processing', ?)",
      [rep_id, withdrawAmount, targetPhone]
    );
    const withdrawalId = wResult.insertId;

    // Deduct from wallet immediately (holds the funds while processing)
    const newBalance = currentBalance - withdrawAmount;
    await conn.execute(
      'UPDATE rep_wallets SET balance = ?, total_withdrawn = total_withdrawn + ? WHERE rep_id = ?',
      [newBalance, withdrawAmount, rep_id]
    );

    // Record wallet transaction
    await conn.execute(
      "INSERT INTO wallet_transactions (rep_id, txn_type, amount, balance_after, description, reference_id, reference_type) VALUES (?, 'debit', ?, ?, ?, ?, 'withdrawal')",
      [rep_id, withdrawAmount, newBalance, `Withdrawal via M-Pesa to ${targetPhone}`, String(withdrawalId)]
    );

    await conn.commit();

    // Trigger M-Pesa STK push (non-blocking after commit)
    try {
      const mpesa = require('../services/mpesa');
      // Use a school's mpesa credentials — find any school assigned to this rep
      const [schoolRows] = await req.db.execute(
        'SELECT school_id FROM schools WHERE sales_rep_id = ? AND mpesa_callback_key IS NOT NULL LIMIT 1',
        [rep_id]
      );
      let stkResult = null;
      if (schoolRows.length > 0) {
        const schoolId = schoolRows[0].school_id;
        const [keyRows] = await req.db.execute('SELECT mpesa_callback_key FROM schools WHERE school_id = ?', [schoolId]);
        const callbackKey = keyRows[0]?.mpesa_callback_key;
        const reference = `WDR-${withdrawalId}`;
        stkResult = await mpesa.stkPush(targetPhone, withdrawAmount, reference, 'Commission withdrawal', { callbackKey });
        if (stkResult?.CheckoutRequestID) {
          await req.db.execute(
            'UPDATE wallet_withdrawals SET checkout_request_id = ?, mpesa_reference = ? WHERE withdrawal_id = ?',
            [stkResult.CheckoutRequestID, reference, withdrawalId]
          );
        }
      } else {
        // No school with M-Pesa credentials — mark as completed (manual payout)
        await req.db.execute(
          "UPDATE wallet_withdrawals SET status = 'completed', completed_at = NOW() WHERE withdrawal_id = ?",
          [withdrawalId]
        );
      }
    } catch (mpesaErr) {
      // M-Pesa failed — reverse the deduction
      console.error('[WALLET WITHDRAW MPESA]', mpesaErr.message);
      await req.db.execute(
        'UPDATE rep_wallets SET balance = balance + ?, total_withdrawn = total_withdrawn - ? WHERE rep_id = ?',
        [withdrawAmount, withdrawAmount, rep_id]
      );
      await req.db.execute(
        "UPDATE wallet_withdrawals SET status = 'failed', failure_reason = ? WHERE withdrawal_id = ?",
        [mpesaErr.message, withdrawalId]
      );
      // Remove the debit transaction
      await req.db.execute(
        "DELETE FROM wallet_transactions WHERE reference_id = ? AND reference_type = 'withdrawal'",
        [String(withdrawalId)]
      );
      return res.status(502).json({ error: 'M-Pesa STK push failed: ' + mpesaErr.message });
    }

    res.json({
      withdrawal_id: withdrawalId,
      amount:        withdrawAmount,
      balance_after: newBalance,
      mpesa_phone:   targetPhone,
      status:        'processing',
      message:       `KSh ${withdrawAmount.toLocaleString()} withdrawal initiated. Check your phone for M-Pesa prompt.`
    });
  } catch (err) {
    await conn.rollback();
    console.error('[WALLET WITHDRAW]', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
