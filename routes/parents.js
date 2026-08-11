const express = require('express');
const crypto = require('crypto');
const router = express.Router();

router.post('/request-otp', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number required' });

  const code = Math.floor(1000 + Math.random() * 9000).toString();
  const sessionId = crypto.randomBytes(32).toString('hex');

  await req.db.execute(
    'INSERT INTO otp_sessions (session_id, phone, code, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))',
    [sessionId, phone, code]
  );

  try {
    const { sendOtp } = require('../services/messaging');
    await sendOtp(phone, code);
  } catch (e) {
    console.error('OTP send failed (non-blocking):', e.message);
    if (process.env.NODE_ENV !== 'production') console.log('=== OTP for', phone, ':', code, '===');
  }

  res.json({ session_id: sessionId, message: 'OTP sent' });
});

router.post('/verify-otp', async (req, res) => {
  const { session_id, code } = req.body;
  if (!session_id || !code) return res.status(400).json({ error: 'Missing session_id or code' });

  const [rows] = await req.db.execute(
    'SELECT phone FROM otp_sessions WHERE session_id = ? AND code = ? AND expires_at > NOW() AND verified = FALSE',
    [session_id, code]
  );

  if (rows.length === 0) return res.status(401).json({ error: 'Invalid or expired code' });

  await req.db.execute('UPDATE otp_sessions SET verified = TRUE WHERE session_id = ?', [session_id]);

  const phone = rows[0].phone;
  // Compare the OTP phone with registered parent profile and return a flag so the client can inform the user
  const [parentRows] = await req.db.execute('SELECT parent_phone FROM parent_profiles WHERE parent_phone = ?', [phone]);
  const registered = parentRows.length > 0;

  // Also report how many active children are linked to this phone
  const [childrenCountRows] = await req.db.execute('SELECT COUNT(*) AS cnt FROM student_parent_map m JOIN students s ON m.student_id = s.student_id WHERE m.parent_phone = ? AND s.enrollment_status = ?', [phone, 'Active']);
  const linkedChildren = childrenCountRows[0]?.cnt || 0;

  res.json({ phone, verified: true, registered, linked_children: linkedChildren });
});

// GET /api/parents/my-schools/:phone — returns all schools a parent has children in
router.get('/my-schools/:phone', async (req, res) => {
  const { phone } = req.params;
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
});

router.get('/dashboard/:phone', async (req, res) => {
  const { phone } = req.params;
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
    'SELECT is_premium, premium_expires_at FROM parent_profiles WHERE parent_phone = ?',
    [phone]
  );

  const [setting] = await req.db.execute("SELECT setting_value FROM app_settings WHERE setting_key = 'premium_price'");
  const premiumPrice = parseInt(setting[0]?.setting_value || '100');

  // Check if school pays for premium
  let schoolPays = false;
  let schoolFee = premiumPrice;
  if (schoolId) {
    const [school] = await req.db.execute('SELECT premium_payment_model, premium_fee_per_term FROM schools WHERE school_id = ?', [schoolId]);
    if (school.length > 0 && school[0].premium_payment_model === 'school') {
      schoolPays = true;
      schoolFee = school[0].premium_fee_per_term || premiumPrice;
      // Auto-activate premium for this parent if school pays and not already premium
      const { getCurrentTerm, getNextTermStart } = require('../lib/config');
      const currentTerm = await getCurrentTerm(req.db, schoolId);
      const currentYear = new Date().getFullYear();
      const [existingSub] = await req.db.execute(
        'SELECT subscription_id FROM premium_subscriptions WHERE school_id = ? AND parent_phone = ? AND term = ? AND year = ? AND payment_status = ?',
        [schoolId, phone, currentTerm, currentYear, 'paid']
      );
      if (existingSub.length === 0) {
        // Check school-paid subscription exists
        const [sub] = await req.db.execute(
          'SELECT subscription_id FROM premium_subscriptions WHERE school_id = ? AND parent_phone = ? AND term = ? AND year = ? AND payment_model = ?',
          [schoolId, phone, currentTerm, currentYear, 'school']
        );
        if (sub.length > 0) {
          // Activate this parent until next term starts
          const expiresAt = await getNextTermStart(req.db, schoolId);
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
  const premiumActive = schoolPays || (Boolean(parent[0]?.is_premium) && (!parent[0]?.premium_expires_at || new Date(parent[0].premium_expires_at) > new Date()));

  const payloadChildren = premiumActive ? children : [];
  const renewalRequired = !premiumActive;

  res.json({
    parent: parent[0] || { is_premium: false },
    school_id: schoolId,
    children: payloadChildren,
    premium_price: schoolPays ? 0 : premiumPrice,
    premium_children_count: childCount,
    premium_total: premiumTotal,
    premium_active: premiumActive,
    premium_due: premiumActive ? 0 : premiumTotal,
    renewal_required: renewalRequired,
    school_pays: schoolPays
  });
});

// POST /api/parents/upgrade — initiate premium upgrade (M-Pesa STK or simulated)
router.post('/upgrade', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone required' });

  // Prevent parent payment if school pays
  const [childSchools] = await req.db.execute(
    'SELECT DISTINCT s.school_id FROM students s JOIN student_parent_map m ON s.student_id = m.student_id WHERE m.parent_phone = ?',
    [phone]
  );
  for (const cs of childSchools) {
    const [school] = await req.db.execute('SELECT premium_payment_model FROM schools WHERE school_id = ?', [cs.school_id]);
    if (school.length > 0 && school[0].premium_payment_model === 'school') {
      return res.json({
        transaction_ref: null,
        status: 'school_paid',
        message: 'Your school covers the premium subscription. You already have access.'
      });
    }
  }

  const [childCountRows] = await req.db.execute(
    'SELECT COUNT(*) AS child_count FROM student_parent_map WHERE parent_phone = ?',
    [phone]
  );
  const childCount = childCountRows[0]?.child_count || 0;

  const [setting] = await req.db.execute("SELECT setting_value FROM app_settings WHERE setting_key = 'premium_price'");
  const pricePerChild = parseInt(setting[0]?.setting_value || '100');
  const totalDue = pricePerChild * Math.max(childCount, 1);

  // Reference includes last 6 digits of phone + timestamp — unique per parent even if concurrent
  const phoneSuffix = phone.replace(/\D/g, '').slice(-6);
  const txnRef = 'UPG' + phoneSuffix + Date.now().toString(36).toUpperCase();

  // Store the pending upgrade so we can match it in the callback
  // even if Safaricom returns a hashed phone number
  await req.db.execute(
    `INSERT INTO payment_ledger (transaction_reference, amount, parent_phone, student_reference, payment_method, logged_at, notes)
     VALUES (?, ?, ?, ?, 'M-Pesa-Pending', NOW(), 'STK_PENDING')`,
    [txnRef, totalDue, phone, txnRef]
  );

  // Try real M-Pesa STK push if credentials are configured
  if (process.env.MPESA_CONSUMER_KEY && process.env.MPESA_CONSUMER_SECRET && process.env.MPESA_SHORTCODE) {
    try {
      const mpesa = require('../services/mpesa');
      const result = await mpesa.stkPush(phone, totalDue, txnRef, 'Education APP Premium');
      if (result.ResponseCode === '0') {
        console.log(`[MPESA] STK push sent to ${phone} for KSh ${totalDue} ref ${txnRef}`);
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

  // Simulated upgrade — mark premium immediately (used when M-Pesa not configured in dev)
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
    message: `Premium activated for KSh ${totalDue}/term for ${childCount || 1} child${childCount === 1 ? '' : 'ren'}`,
    premium_due: totalDue,
    premium_children_count: childCount || 1
  });
});

// GET /api/parents/premium-status/:phone
// Lightweight endpoint used at login to show renewal/locked UI before OTP. Returns no children.
router.get('/premium-status/:phone', async (req, res) => {
  const phone = req.params.phone;
  const [rows] = await req.db.execute(
    'SELECT is_premium, premium_expires_at FROM parent_profiles WHERE parent_phone = ?',
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

  const premiumTotal = schoolPays ? 0 : premiumPrice * Math.max(childCount, 1);
  const registered = rows.length > 0;

  if (!registered) return res.json({
    is_premium: false, registered: false,
    premium_children_count: childCount, premium_total: premiumTotal,
    premium_price: schoolPays ? 0 : premiumPrice,
    renewal_required: !schoolPays,
    school_pays: schoolPays
  });
  const active = schoolPays || (rows[0].is_premium && (!rows[0].premium_expires_at || new Date(rows[0].premium_expires_at) > new Date()));
  res.json({
    is_premium: active,
    registered: true,
    expires_at: rows[0].premium_expires_at,
    premium_children_count: childCount,
    premium_total: premiumTotal,
    premium_price: schoolPays ? 0 : premiumPrice,
    renewal_required: !active,
    school_pays: schoolPays
  });
});

// GET /api/parents/payment-status — poll after STK push to check if payment completed
router.get('/payment-status', async (req, res) => {
  const { checkout_request_id, phone } = req.query;
  if (!checkout_request_id && !phone) return res.status(400).json({ error: 'checkout_request_id or phone required' });

  // Check if the pending record was updated to STK_COMPLETED (callback arrived)
  const [rows] = await req.db.execute(
    `SELECT notes, transaction_reference, amount FROM payment_ledger
     WHERE (student_reference LIKE 'UPG%' OR transaction_reference LIKE 'UPG%' OR student_reference LIKE 'BAZPAY-%' OR transaction_reference LIKE 'BAZPAY-%')
       AND parent_phone = ?
       AND notes IN ('STK_COMPLETED', 'STK_PENDING')
     ORDER BY logged_at DESC LIMIT 1`,
    [phone]
  );

  if (rows.length > 0 && rows[0].notes === 'STK_COMPLETED') {
    // Also verify parent_profiles is_premium is now true
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
  const [p] = await req.db.execute(
    'SELECT is_premium, premium_expires_at FROM parent_profiles WHERE parent_phone = ?',
    [phone]
  );
  const active = p[0]?.is_premium && (!p[0]?.premium_expires_at || new Date(p[0].premium_expires_at) > new Date());
  return res.json({ status: active ? 'completed' : 'pending' });
});

// POST /api/parents/fee-reminder — send fee balance to parent's WhatsApp
router.post('/fee-reminder', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone required' });

  const [children] = await req.db.execute(
    `SELECT s.student_id, s.full_name FROM students s
     JOIN student_parent_map m ON s.student_id = m.student_id
     WHERE m.parent_phone = ? AND s.enrollment_status = 'Active'`,
    [phone]
  );

  const [parent] = await req.db.execute(
    'SELECT is_premium FROM parent_profiles WHERE parent_phone = ?',
    [phone]
  );

  if (!parent[0]?.is_premium) return res.json({ sent: 0, message: 'Premium required for fee reminders' });

  const { sendFeeReminder } = require('../services/messaging');
  let sent = 0;
  for (const child of children) {
    // Get current term fee total
    const [fees] = await req.db.execute(
      `SELECT COALESCE(SUM(f.amount), 0) AS total
       FROM fee_structures f
       WHERE f.school_id = (SELECT school_id FROM students WHERE student_id = ?)
         AND f.term = (SELECT CONCAT('Term ', CEIL(MONTH(CURDATE())/4)) FROM DUAL)`,
      [child.student_id]
    );
    // Get amount paid
    const [paid] = await req.db.execute(
      `SELECT COALESCE(SUM(amount), 0) AS paid FROM payment_ledger WHERE student_reference = ?`,
      [child.student_id]
    );
    const total = fees[0]?.total || 0;
    const balance = total - paid[0].paid;
    try {
      await sendFeeReminder(phone, child.full_name, total.toString(), Math.max(0, balance).toString());
      sent++;
    } catch (e) {
      console.error('[WA] Fee reminder failed:', e.message);
    }
  }
  res.json({ sent, total: children.length });
});

// GET /api/parents/academic-records/:phone — free endpoint, no premium check
router.get('/academic-records/:phone', async (req, res) => {
  const { phone } = req.params;
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
});

module.exports = router;
