const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Normalize Kenyan mobile numbers to international format (2547XXXXXXXX / 2541XXXXXXXX)
// so lookups match parent_profiles.parent_phone regardless of how the user types it
function normalizePhone(raw) {
  if (!raw) return raw;
  const p = String(raw).replace(/[\s-]/g, '').replace(/^\+/, '');
  if (/^0([17]\d{8})$/.test(p)) return '254' + p.slice(1);
  if (/^([17]\d{8})$/.test(p)) return '254' + p;
  if (/^254([17]\d{8})$/.test(p)) return p;
  return p;
}

router.post('/request-otp', wrap(async (req, res) => {
  const { phone, email } = req.body;
  if (!phone && !email) return res.status(400).json({ error: 'Phone number or email required' });
  const normPhone = phone ? normalizePhone(phone) : null;

  // Email login: resolve to the registered parent profile's phone up-front,
  // so every downstream phone-keyed flow keeps working after verification.
  let resolvedPhone = '';
  if (!normPhone && email) {
    const [pp] = await req.db.execute('SELECT parent_phone FROM parent_profiles WHERE email = ? LIMIT 1', [email]);
    resolvedPhone = pp[0]?.parent_phone || '';
  }

  const code = Math.floor(1000 + Math.random() * 9000).toString();
  const sessionId = crypto.randomBytes(32).toString('hex');

  await req.db.execute(
    'INSERT INTO otp_sessions (session_id, phone, email, code, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))',
    [sessionId, normPhone || resolvedPhone || '', email || null, code]
  );

  try {
    if (email && !normPhone) {
      const messaging = require('../services/messaging');
      if (messaging.sendEmailOtp) await messaging.sendEmailOtp(email, code);
      else console.log('=== Email OTP for', email, ':', code, '===');
    } else {
      const { sendOtp } = require('../services/messaging');
      await sendOtp(normPhone, code);
    }
  } catch (e) {
    console.error('OTP send failed (non-blocking):', e.message);
    if (email && !normPhone) console.log('=== Email OTP for', email, ':', code, '===');
    else if (process.env.NODE_ENV !== 'production') console.log('=== OTP for', normPhone, ':', code, '===');
  }

  res.json({ session_id: sessionId, message: 'OTP sent' });
}));

router.post('/verify-otp', wrap(async (req, res) => {
  const { session_id, code } = req.body;
  if (!session_id || !code) return res.status(400).json({ error: 'Missing session_id or code' });

  const [rows] = await req.db.execute(
    'SELECT phone, email FROM otp_sessions WHERE session_id = ? AND code = ? AND expires_at > NOW() AND verified = FALSE',
    [session_id, code]
  );

  if (rows.length === 0) {
    const [expiredRows] = await req.db.execute(
      'SELECT phone FROM otp_sessions WHERE session_id = ? AND code = ? AND verified = FALSE',
      [session_id, code]
    );
    if (expiredRows.length > 0) {
      return res.status(410).json({ error: 'Code expired - tap Resend to get a new one' });
    }
    return res.status(401).json({ error: 'Invalid or expired code' });
  }

  await req.db.execute('UPDATE otp_sessions SET verified = TRUE WHERE session_id = ?', [session_id]);

  const phone = rows[0].phone || '';
  const email = rows[0].email || null;

  // Resolve the canonical parent phone (email-only sessions map through parent_profiles.email)
  let effectivePhone = phone;
  if (!effectivePhone && email) {
    const [pp] = await req.db.execute('SELECT parent_phone FROM parent_profiles WHERE email = ? LIMIT 1', [email]);
    effectivePhone = pp[0]?.parent_phone || '';
  }

  // Compare against registered parent profiles (by phone or email) so the client can inform the user
  let registered = false;
  if (effectivePhone || email) {
    const [parentRows] = await req.db.execute(
      'SELECT parent_phone FROM parent_profiles WHERE parent_phone = ? OR (email IS NOT NULL AND email = ?)',
      [effectivePhone || '__none__', email || '__none__']
    );
    registered = parentRows.length > 0;
  }

  // Report how many active children are linked to this parent's phone
  let linkedChildren = 0;
  if (effectivePhone) {
    const [childrenCountRows] = await req.db.execute(
      'SELECT COUNT(*) AS cnt FROM student_parent_map m JOIN students s ON m.student_id = s.student_id WHERE m.parent_phone = ? AND s.enrollment_status = ?',
      [effectivePhone, 'Active']
    );
    linkedChildren = childrenCountRows[0]?.cnt || 0;
  }

  res.json({ phone: effectivePhone, email: email || undefined, verified: true, registered, linked_children: linkedChildren });
}));

// GET /api/parents/my-schools/:phone — returns all schools a parent has children in
router.get('/my-schools/:phone', wrap(async (req, res) => {
  const phone = normalizePhone(req.params.phone);
  const [rows] = await req.db.execute(
    `SELECT DISTINCT sc.school_id, sc.school_name, sc.region, sc.contact_phone,
            COUNT(s.student_id) AS children_count
     FROM student_parent_map m
     JOIN students s ON m.student_id = s.student_id AND s.enrollment_status = 'Active'
     JOIN schools sc ON s.school_id = sc.school_id
     WHERE m.parent_phone = ?
     GROUP BY sc.school_id, sc.school_name, sc.region, sc.contact_phone
     ORDER BY sc.school_name`,
    [phone]
  );
  res.json({ schools: rows });
}));

router.get('/dashboard/:phone', wrap(async (req, res) => {
  const phone = normalizePhone(req.params.phone);
  const { school_id: filterSchoolId } = req.query;

  const [children] = await req.db.execute(
    `SELECT s.student_id, s.full_name, c.class_name, s.school_id,
       sc.school_name,
       (SELECT status FROM attendance_logs WHERE student_id = s.student_id ORDER BY attendance_date DESC LIMIT 1) AS last_attendance,
       (SELECT attendance_date FROM attendance_logs WHERE student_id = s.student_id ORDER BY attendance_date DESC LIMIT 1) AS last_date,
       (SELECT marked_at FROM attendance_logs WHERE student_id = s.student_id ORDER BY attendance_date DESC LIMIT 1) AS arrival_time,
       (SELECT amount FROM payment_ledger WHERE student_reference = s.student_id AND reversed_at IS NULL ORDER BY logged_at DESC LIMIT 1) AS last_payment_amount,
       (SELECT logged_at FROM payment_ledger WHERE student_reference = s.student_id AND reversed_at IS NULL ORDER BY logged_at DESC LIMIT 1) AS last_payment_date
     FROM students s
     JOIN classes c ON s.class_id = c.class_id
     JOIN schools sc ON s.school_id = sc.school_id
     JOIN student_parent_map m ON s.student_id = m.student_id
     WHERE m.parent_phone = ? AND s.enrollment_status = 'Active'
       ${filterSchoolId ? 'AND s.school_id = ?' : ''}
     ORDER BY sc.school_name, s.full_name`,
    filterSchoolId ? [phone, filterSchoolId] : [phone]
  );

  const schoolId = children.length > 0 ? children[0].school_id : null;

  const [parent] = await req.db.execute(
    'SELECT full_name AS parent_name, is_premium, premium_expires_at, prepaid_balance FROM parent_profiles WHERE parent_phone = ?',
    [phone]
  );

  // Auto-activate from prepaid balance when it covers a term and the parent is
  // otherwise not active.
  if ((!parent[0]?.is_premium || (parent[0]?.premium_expires_at && new Date(parent[0].premium_expires_at) <= new Date()))
      && parseFloat(parent[0]?.prepaid_balance || 0) > 0) {
    const { autoActivateFromPrepaid } = require('../lib/subscriptions');
    await autoActivateFromPrepaid(req.db, phone, schoolId);
  }

  const [setting] = await req.db.execute("SELECT setting_value FROM app_settings WHERE setting_key = 'premium_price'");
  const premiumPrice = parseInt(setting[0]?.setting_value || '100');

  // Multi-school support: summarize every school the parent has children in
  const schoolMap = new Map();
  for (const ch of children) {
    if (!schoolMap.has(ch.school_id)) {
      schoolMap.set(ch.school_id, { school_id: ch.school_id, school_name: ch.school_name, children_count: 0, school_pays: false });
    }
    schoolMap.get(ch.school_id).children_count++;
  }

  // Check if ANY linked school covers premium; auto-activate school-paid subscriptions per school
  let schoolPays = false;
  let schoolFee = premiumPrice;
  const { getCurrentTerm, getNextTermStart } = require('../lib/config');
  for (const schoolEntry of schoolMap.values()) {
    const sid = schoolEntry.school_id;
    const [school] = await req.db.execute('SELECT premium_payment_model, premium_fee_per_term FROM schools WHERE school_id = ?', [sid]);
    if (school.length > 0 && school[0].premium_payment_model === 'school') {
      schoolPays = true;
      schoolFee = school[0].premium_fee_per_term || premiumPrice;
      schoolEntry.school_pays = true;
      // Auto-activate premium for this parent if school pays and not already premium
      const currentTerm = await getCurrentTerm(req.db, sid);
      const currentYear = new Date().getFullYear();
      const [existingSub] = await req.db.execute(
        'SELECT subscription_id FROM premium_subscriptions WHERE school_id = ? AND parent_phone = ? AND term = ? AND year = ? AND payment_status = ?',
        [sid, phone, currentTerm, currentYear, 'paid']
      );
      if (existingSub.length === 0) {
        // Check school-paid subscription exists
        const [sub] = await req.db.execute(
          'SELECT subscription_id FROM premium_subscriptions WHERE school_id = ? AND parent_phone = ? AND term = ? AND year = ? AND payment_model = ?',
          [sid, phone, currentTerm, currentYear, 'school']
        );
        if (sub.length > 0) {
          // Activate this parent until next term starts
          const expiresAt = await getNextTermStart(req.db, sid);
          await req.db.execute(
            "UPDATE premium_subscriptions SET payment_status = 'paid', activated_at = NOW(), expires_at = ? WHERE subscription_id = ?",
            [expiresAt, sub[0].subscription_id]
          );
          await req.db.execute(
            'UPDATE parent_profiles SET is_premium = TRUE, premium_expires_at = ? WHERE parent_phone = ?',
            [expiresAt, phone]
          );
        }
      }
    }
  }

  const childCount = children.length || 0;
  const premiumTotal = schoolPays ? 0 : premiumPrice * Math.max(childCount, 1);

  // Re-read profile so auto-activation from prepaid balance above is reflected.
  const fresh = await req.db.execute(
    'SELECT full_name AS parent_name, is_premium, premium_expires_at, prepaid_balance FROM parent_profiles WHERE parent_phone = ?',
    [phone]
  );
  const freshParent = fresh[0] || parent[0] || { is_premium: false, prepaid_balance: 0 };
  const premiumActive = schoolPays || (Boolean(freshParent.is_premium) && (!freshParent.premium_expires_at || new Date(freshParent.premium_expires_at) > new Date()));

  // Children are always visible — premium gates alerts/features, not visibility
  const renewalRequired = !premiumActive;

  res.json({
    parent: freshParent,
    school_id: schoolId,
    schools: [...schoolMap.values()],
    children,
    premium_price: schoolPays ? 0 : premiumPrice,
    premium_children_count: childCount,
    premium_total: premiumTotal,
    premium_active: premiumActive,
    premium_due: premiumActive ? 0 : premiumTotal,
    renewal_required: renewalRequired,
    school_pays: schoolPays,
    prepaid_balance: parseFloat(freshParent.prepaid_balance || 0)
  });
}));

// POST /api/parents/upgrade — initiate premium upgrade (M-Pesa STK or simulated)
// Accepts optional school_id so multi-school parents pay per school and the
// payment is allocated to the correct school via the ledger row.
router.post('/upgrade', wrap(async (req, res) => {
  const { phone: rawPhone, school_id, amount: clientAmount } = req.body;
  if (!rawPhone) return res.status(400).json({ error: 'Phone required' });
  const phone = normalizePhone(rawPhone);

  // Scope to active children at the chosen school (or all schools when omitted)
  const scopeSql = school_id ? ' AND s.school_id = ?' : '';
  const scopeParams = school_id ? [school_id] : [];
  const [childRows] = await req.db.execute(
    `SELECT s.student_id, s.school_id, sc.premium_payment_model
     FROM students s
     JOIN student_parent_map m ON s.student_id = m.student_id
     JOIN schools sc ON s.school_id = sc.school_id
     WHERE m.parent_phone = ? AND s.enrollment_status = 'Active'${scopeSql}`,
    [phone, ...scopeParams]
  );

  // Prevent parent payment if a covered school pays for premium (within scope)
  for (const row of childRows) {
    if (row.premium_payment_model === 'school') {
      return res.json({
        transaction_ref: null,
        status: 'school_paid',
        message: 'Your school covers the subscription for you. You already have access.'
      });
    }
  }

  const childCount = childRows.length;

  const [setting] = await req.db.execute("SELECT setting_value FROM app_settings WHERE setting_key = 'premium_price'");
  const pricePerChild = parseInt(setting[0]?.setting_value || '100');
  const defaultTotal = pricePerChild * Math.max(childCount, 1);
  const totalDue = clientAmount ? parseInt(clientAmount, 10) : defaultTotal;

  const txnRef = 'TXN' + Date.now().toString(36).toUpperCase();

  // Ensure parent profile exists (payment_ledger FK requires it)
  await req.db.execute('INSERT IGNORE INTO parent_profiles (parent_phone) VALUES (?)', [phone]);

  // Store the pending upgrade tagged with the target school so the STK callback
  // allocates the subscription to the correct school
  const [insertResult] = await req.db.execute(
    `INSERT INTO payment_ledger (transaction_reference, amount, parent_phone, student_reference, payment_method, logged_at, notes, school_id)
     VALUES (?, ?, ?, ?, 'M-Pesa-Pending', NOW(), 'STK_PENDING', ?)`,
    [txnRef, totalDue, phone, txnRef, school_id || null]
  );
  const accountRef = String(insertResult.insertId).padStart(10, '0');

  // Try real M-Pesa STK push only when ALL credentials are configured
  if (process.env.MPESA_CONSUMER_KEY && process.env.MPESA_CONSUMER_SECRET && process.env.MPESA_SHORTCODE && process.env.MPESA_PASSKEY) {
    try {
      const mpesa = require('../services/mpesa');
      const result = await mpesa.stkPush(phone, totalDue, accountRef, 'Education');
      if (result.ResponseCode === '0') {
        // Store the CheckoutRequestID so the Buy Goods callback (no AccountReference) can match this ledger row
        await req.db.execute(
          "UPDATE payment_ledger SET student_reference = ? WHERE transaction_reference = ? AND notes = 'STK_PENDING'",
          [result.CheckoutRequestID, txnRef]
        );
        console.log(`[MPESA] STK push sent to ${phone} for KSh ${totalDue} ref ${txnRef} checkout ${result.CheckoutRequestID}`);
        return res.json({
          transaction_ref: txnRef,
          checkout_request_id: result.CheckoutRequestID,
          status: 'pending',
          message: `M-Pesa STK push sent to your phone. Enter PIN to pay KSh ${totalDue} for ${childCount || 1} child${childCount === 1 ? '' : 'ren'}.`
        });
      }
      console.error('[MPESA] STK push failed:', result);
      return res.status(502).json({ error: 'M-Pesa payment failed', detail: result.errorMessage || 'STK push rejected' });
    } catch (err) {
      console.error('[MPESA] STK push error:', err.message);
      return res.status(502).json({ error: 'M-Pesa service unavailable' });
    }
  }

  // Never simulate payments in production — fail loudly instead
  if (process.env.NODE_ENV === 'production') {
    console.error('[PREMIUM] M-Pesa not configured — refusing simulated upgrade for', phone);
    return res.status(503).json({ error: 'M-Pesa payments are not configured yet. Please contact support.' });
  }

  // Simulated upgrade — dev only — mark premium immediately (used when M-Pesa not configured in dev)
  const { getNextTermStart } = require('../lib/config');
  const [schoolRows] = await req.db.execute(
    'SELECT DISTINCT s.school_id FROM students s JOIN student_parent_map m ON s.student_id = m.student_id WHERE m.parent_phone = ? LIMIT 1',
    [phone]
  );
  const schoolIdForExpiry = schoolRows[0]?.school_id;
  const expiresAt = schoolIdForExpiry ? await getNextTermStart(req.db, schoolIdForExpiry) : new Date(Date.now() + 120 * 86400000);

  const [existing] = await req.db.execute('SELECT parent_phone FROM parent_profiles WHERE parent_phone = ?', [phone]);
  if (existing.length > 0) {
    await req.db.execute(
      'UPDATE parent_profiles SET is_premium = TRUE, premium_expires_at = ? WHERE parent_phone = ?',
      [expiresAt, phone]
    );
  } else {
    await req.db.execute(
      'INSERT INTO parent_profiles (parent_phone, full_name, is_premium, premium_expires_at) VALUES (?, ?, TRUE, ?)',
      [phone, null, expiresAt]
    );
  }

  console.log(`[PREMIUM] ${phone} upgraded (simulated) — expires ${expiresAt.toISOString()}`);
  res.json({
    transaction_ref: txnRef,
    status: 'confirmed',
    message: `Subscription activated for KSh ${totalDue}/term for ${childCount || 1} child${childCount === 1 ? '' : 'ren'}`,
    premium_due: totalDue,
    premium_children_count: childCount || 1
  });
}));

// GET /api/parents/premium-status/:phone
// Lightweight endpoint used at login to show renewal/locked UI before OTP. Returns no children.
router.get('/premium-status/:phone', wrap(async (req, res) => {
  const phone = normalizePhone(req.params.phone);
  const [rows] = await req.db.execute(
    'SELECT is_premium, premium_expires_at, prepaid_balance FROM parent_profiles WHERE parent_phone = ?',
    [phone]
  );

  const [childCountRows] = await req.db.execute(
    'SELECT COUNT(*) AS child_count FROM student_parent_map m JOIN students s ON m.student_id = s.student_id WHERE m.parent_phone = ? AND s.enrollment_status = ?',
    [phone, 'Active']
  );
  const childCount = childCountRows[0]?.child_count || 0;

  const [setting] = await req.db.execute("SELECT setting_value FROM app_settings WHERE setting_key = 'premium_price'");
  const premiumPrice = parseInt(setting[0]?.setting_value || '100');

  // Check if any linked school pays for premium
  let schoolPays = false;
  let schoolFee = premiumPrice;
  const [childSchools] = await req.db.execute(
    'SELECT DISTINCT s.school_id FROM students s JOIN student_parent_map m ON s.student_id = m.student_id WHERE m.parent_phone = ?',
    [phone]
  );
  for (const cs of childSchools) {
    const [school] = await req.db.execute('SELECT premium_payment_model, premium_fee_per_term FROM schools WHERE school_id = ?', [cs.school_id]);
    if (school.length > 0 && school[0].premium_payment_model === 'school') {
      schoolPays = true;
      schoolFee = school[0].premium_fee_per_term || premiumPrice;
      break;
    }
  }

  // If the parent has a prepaid balance that covers the term price, auto-activate
  // the current term (consuming one term from the credit) so they don't have to pay again.
  const prepaid = rows.length > 0 ? parseFloat(rows[0].prepaid_balance || 0) : 0;
  if (rows.length > 0 && !schoolPays && prepaid > 0) {
    const { autoActivateFromPrepaid } = require('../lib/subscriptions');
    const l = childSchools.length > 0 ? childSchools[0].school_id : null;
    await autoActivateFromPrepaid(req.db, phone, l);
  }

  const premiumTotal = schoolPays ? 0 : premiumPrice * Math.max(childCount, 1);

  let balanceForReturn = prepaid;
  let activeRow = rows[0];
  if (rows.length > 0) {
    const [b] = await req.db.execute('SELECT is_premium, premium_expires_at, prepaid_balance FROM parent_profiles WHERE parent_phone = ?', [phone]);
    activeRow = b[0];
    balanceForReturn = parseFloat(b[0].prepaid_balance || 0);
  }
  const registered = rows.length > 0;

  if (!registered) return res.json({
    is_premium: false, registered: false,
    premium_children_count: childCount, premium_total: premiumTotal,
    premium_price: schoolPays ? 0 : premiumPrice,
    renewal_required: !schoolPays,
    school_pays: schoolPays,
    prepaid_balance: 0
  });
  const active = schoolPays || (activeRow.is_premium && (!activeRow.premium_expires_at || new Date(activeRow.premium_expires_at) > new Date()));
  res.json({
    is_premium: active,
    registered: true,
    expires_at: activeRow.premium_expires_at,
    premium_children_count: childCount,
    premium_total: premiumTotal,
    premium_price: schoolPays ? 0 : premiumPrice,
    renewal_required: !active,
    school_pays: schoolPays,
    prepaid_balance: balanceForReturn
  });
}));

// GET /api/parents/payment-status — poll after STK push to check if payment completed
router.get('/payment-status', wrap(async (req, res) => {
  const { checkout_request_id, phone: rawPhone } = req.query;
  if (!checkout_request_id && !rawPhone) return res.status(400).json({ error: 'checkout_request_id or phone required' });
  const phone = rawPhone ? normalizePhone(rawPhone) : null;

  // Check if the pending record was updated to STK_COMPLETED (callback arrived)
  const [rows] = await req.db.execute(
    `SELECT notes, transaction_reference, amount FROM payment_ledger
     WHERE student_reference = ? OR transaction_reference = ?
     ORDER BY logged_at DESC LIMIT 1`,
    [checkout_request_id || '', checkout_request_id || '']
  );

  if (rows.length > 0 && rows[0].notes === 'STK_COMPLETED') {
    if (!phone) return res.json({ status: 'completed' });
    const [p] = await req.db.execute(
      'SELECT is_premium, premium_expires_at FROM parent_profiles WHERE parent_phone = ?',
      [phone]
    );
    return res.json({
      status: 'completed',
      is_premium: p[0]?.is_premium || false,
      premium_expires_at: p[0]?.premium_expires_at || null
    });
  }

  if (rows.length > 0 && ['STK_CANCELLED', 'STK_TIMEOUT', 'STK_FAILED'].includes(rows[0].notes)) {
    return res.json({ status: 'failed', reason: rows[0].notes === 'STK_CANCELLED' ? 'Cancelled by user' : 'Payment not completed. You did not enter your PIN in time.' });
  }

  if (rows.length > 0 && rows[0].notes === 'STK_PENDING') {
    // Check if Safaricom already confirmed via STK query
    if (process.env.MPESA_CONSUMER_KEY && checkout_request_id) {
      try {
        const mpesa = require('../services/mpesa');
        const queryResult = await mpesa.stkPushQuery(checkout_request_id);
        if (queryResult.ResultCode === '0' || queryResult.ResultCode === 0) {
          return res.json({ status: 'completed' });
        }
        if (queryResult.ResultCode === '1032') {
          return res.json({ status: 'failed', reason: 'Cancelled by user' });
        }
        if (queryResult.ResultCode === '1') {
          return res.json({ status: 'failed', reason: 'Insufficient funds or wrong PIN' });
        }
      } catch (e) {
        console.error('[PAYMENT STATUS] STK query failed:', e.message);
      }
    }
    return res.json({ status: 'pending' });
  }

  // No pending record found — check if already premium (paid via another path)
  if (!phone) return res.json({ status: 'pending' });
  const [p] = await req.db.execute(
    'SELECT is_premium, premium_expires_at FROM parent_profiles WHERE parent_phone = ?',
    [phone]
  );
  const active = p[0]?.is_premium && (!p[0]?.premium_expires_at || new Date(p[0].premium_expires_at) > new Date());
  return res.json({ status: active ? 'completed' : 'pending' });
}));

// GET /api/parents/academic-records/:phone — free endpoint, no premium check
router.get('/academic-records/:phone', wrap(async (req, res) => {
  const phone = normalizePhone(req.params.phone);
  if (!phone) return res.status(400).json({ error: 'Phone required' });

  const { getCurrentTerm, getRubricConfig, getLevel } = require('../lib/config');

  const [children] = await req.db.execute(
    `SELECT s.student_id, s.full_name, c.class_name, s.school_id
     FROM students s
     JOIN classes c ON s.class_id = c.class_id
     JOIN student_parent_map m ON s.student_id = m.student_id
     WHERE m.parent_phone = ? AND s.enrollment_status = 'Active'`,
    [phone]
  );

  const result = [];
  for (const child of children) {
    const rubricConfig = await getRubricConfig(req.db, child.school_id);
    const currentTerm = await getCurrentTerm(req.db, child.school_id);
    const currentYear = new Date().getFullYear();

    // Current term — assessment results by learning area
    const [currentAreas] = await req.db.execute(
      `SELECT la.area_id, la.area_name,
              AVG(ar.score / a.max_score) * 100 AS avg_pct
       FROM assessment_results ar
       JOIN assessments a ON ar.assessment_id = a.assessment_id
       JOIN sub_strands ss ON a.sub_strand_id = ss.sub_strand_id
       JOIN strands st ON ss.strand_id = st.strand_id
       JOIN learning_areas la ON st.area_id = la.area_id
       WHERE ar.student_id = ? AND st.term = ? AND YEAR(a.date) = ?
       GROUP BY la.area_id, la.area_name
       ORDER BY la.area_name`,
      [child.student_id, currentTerm, currentYear]
    );

    // Current term — exam results by learning area
    const [currentExamAreas] = await req.db.execute(
      `SELECT la.area_id, la.area_name,
              AVG(er.score / er.out_of) * 100 AS avg_pct
       FROM exam_results er
       JOIN exam_sessions es ON er.session_id = es.session_id
       JOIN sub_learning_areas sla ON er.sub_area_id = sla.sub_area_id
       JOIN learning_areas la ON sla.area_id = la.area_id
       WHERE er.student_id = ? AND es.term = ? AND es.academic_year = ?
       GROUP BY la.area_id, la.area_name
       ORDER BY la.area_name`,
      [child.student_id, currentTerm, currentYear]
    );

    // Merge assessment + exam results
    const areaMap = new Map();
    for (const a of currentAreas) {
      areaMap.set(a.area_name, { area_id: a.area_id, area_name: a.area_name, avg_pct: parseFloat(a.avg_pct) || 0 });
    }
    for (const a of currentExamAreas) {
      if (areaMap.has(a.area_name)) {
        areaMap.get(a.area_name).avg_pct = Math.max(areaMap.get(a.area_name).avg_pct, parseFloat(a.avg_pct) || 0);
      } else {
        areaMap.set(a.area_name, { area_id: a.area_id, area_name: a.area_name, avg_pct: parseFloat(a.avg_pct) || 0 });
      }
    }
    const currentAreasList = [];
    for (const entry of areaMap.values()) {
      const matched = getLevel(entry.avg_pct / 100, rubricConfig);
      currentAreasList.push({
        area_name: entry.area_name,
        avg_pct: Math.round(entry.avg_pct * 10) / 10,
        level: matched ? matched.level_code : 'BE',
        label: matched ? matched.label : 'Below Expectations',
        color: matched ? matched.color : '#C62828'
      });
    }

    // Archive — distinct years/terms with data (excluding current)
    const [archiveYears] = await req.db.execute(
      `SELECT DISTINCT YEAR(a.date) AS year, st.term
       FROM assessment_results ar
       JOIN assessments a ON ar.assessment_id = a.assessment_id
       JOIN sub_strands ss ON a.sub_strand_id = ss.sub_strand_id
       JOIN strands st ON ss.strand_id = st.strand_id
       WHERE ar.student_id = ?
       UNION
       SELECT DISTINCT es.academic_year AS year, es.term
       FROM exam_results er
       JOIN exam_sessions es ON er.session_id = es.session_id
       WHERE er.student_id = ?
       ORDER BY year DESC, term`,
      [child.student_id, child.student_id]
    );

    const archive = [];
    const yearMap = new Map();
    for (const row of archiveYears) {
      if (row.year === currentYear) continue;
      if (!yearMap.has(row.year)) yearMap.set(row.year, []);
      yearMap.get(row.year).push(row.term);
    }
    for (const [year, terms] of yearMap) {
      const termData = [];
      for (const term of terms) {
        // Area averages for this archived term
        const [areas] = await req.db.execute(
          `SELECT la.area_name,
                  AVG(ar.score / a.max_score) * 100 AS avg_pct
           FROM assessment_results ar
           JOIN assessments a ON ar.assessment_id = a.assessment_id
           JOIN sub_strands ss ON a.sub_strand_id = ss.sub_strand_id
           JOIN strands st ON ss.strand_id = st.strand_id
           JOIN learning_areas la ON st.area_id = la.area_id
           WHERE ar.student_id = ? AND st.term = ? AND YEAR(a.date) = ?
           GROUP BY la.area_name
           ORDER BY la.area_name`,
          [child.student_id, term, year]
        );
        termData.push({
          term,
          areas: areas.map(a => {
            const matched = getLevel((parseFloat(a.avg_pct) || 0) / 100, rubricConfig);
            return {
              area_name: a.area_name,
              avg_pct: Math.round((parseFloat(a.avg_pct) || 0) * 10) / 10,
              level: matched ? matched.level_code : 'BE',
              label: matched ? matched.label : 'Below Expectations',
              color: matched ? matched.color : '#C62828'
            };
          })
        });
      }
      archive.push({ year, terms: termData });
    }

    result.push({
      student_id: child.student_id,
      full_name: child.full_name,
      class_name: child.class_name,
      current: {
        term: currentTerm,
        year: currentYear,
        areas: currentAreasList
      },
      archive
    });
  }

  res.json(result);
}));

module.exports = router;
