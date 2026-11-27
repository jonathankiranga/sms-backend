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
  const normPhone = req.body.phone ? normalizePhone(req.body.phone) : '';
  const email = req.body.email ? String(req.body.email).trim().toLowerCase() : '';
  if (!normPhone && !email) return res.status(400).json({ error: 'Phone number or email required' });

  // Resolve both identifiers to one global parent account. Never silently
  // combine two accounts when the supplied phone and email disagree.
  const conditions = [];
  const params = [];
  if (normPhone) { conditions.push("(contact_type = 'phone' AND contact_value = ?)"); params.push(normPhone); }
  if (email) { conditions.push("(contact_type = 'email' AND contact_value = ?)"); params.push(email); }
  const [matches] = await req.db.execute(
    `SELECT DISTINCT a.parent_account_id, a.canonical_parent_phone
     FROM parent_account_contacts c
     JOIN parent_accounts a ON a.parent_account_id = c.parent_account_id
     WHERE ${conditions.join(' OR ')}`,
    params
  );

  if (!matches.length) {
    return res.status(404).json({ error: 'This contact is not registered with a parent account. Ask the school to register or link your contact details.' });
  }
  if (matches.length > 1 && (normPhone || !email)) {
    return res.status(409).json({ error: 'Your email and telephone number are associated with different parent accounts. Sign in using the email alone to verify and consolidate the matching parent records.' });
  }

  // Email-only sign-in may match legacy parent profiles from several schools.
  // Select a stable account for the OTP session; the verified-email step below
  // consolidates the matching accounts after proof of email ownership.
  matches.sort((a, b) => Number(a.parent_account_id) - Number(b.parent_account_id));
  const account = matches[0];
  const code = crypto.randomInt(1000, 10000).toString();
  const sessionId = crypto.randomBytes(32).toString('hex');
  await req.db.execute(
    `INSERT INTO otp_sessions
      (session_id, phone, email, code, expires_at, verified, parent_account_id)
     VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE), FALSE, ?)`,
    [sessionId, account.canonical_parent_phone, email || null, code, account.parent_account_id]
  );

  try {
    const messaging = require('../services/messaging');
    if (email) {
      if (!messaging.sendEmailOtp) throw new Error('Email OTP delivery is not configured');
      await messaging.sendEmailOtp(email, code);
    } else {
      await messaging.sendOtp(normPhone, code);
    }
  } catch (err) {
    console.error('[PARENT OTP] Delivery failed:', err.message);
    await req.db.execute('DELETE FROM otp_sessions WHERE session_id = ?', [sessionId]);
    return res.status(503).json({ error: 'Unable to send the verification code. Please try again.' });
  }

  res.json({ session_id: sessionId, message: 'OTP sent' });
}));

router.post('/verify-otp', wrap(async (req, res) => {
  const { session_id, code } = req.body;
  if (!session_id || !code) return res.status(400).json({ error: 'Missing session_id or code' });

  const [rows] = await req.db.execute(
    `SELECT phone, email, parent_account_id
     FROM otp_sessions
     WHERE session_id = ? AND code = ? AND expires_at > NOW() AND verified = FALSE
     LIMIT 1`,
    [session_id, code]
  );
  if (!rows.length) {
    const [expired] = await req.db.execute(
      'SELECT session_id FROM otp_sessions WHERE session_id = ? AND code = ? AND verified = FALSE LIMIT 1',
      [session_id, code]
    );
    return res.status(expired.length ? 410 : 401).json({
      error: expired.length ? 'Code expired - tap Resend to get a new one' : 'Invalid or expired code'
    });
  }

  let accountId = rows[0].parent_account_id;
  if (!accountId) return res.status(403).json({ error: 'This OTP session is not linked to a parent account. Request a new code.' });

  const connection = await req.db.getConnection();
  let account;
  try {
    await connection.beginTransaction();

    // An email can be present on multiple legacy parent profiles. Only after
    // successful email OTP verification do we consolidate those identities.
    const verifiedEmail = rows[0].email ? String(rows[0].email).trim().toLowerCase() : '';
    if (verifiedEmail) {
      const [emailAccounts] = await connection.execute(
        `SELECT DISTINCT parent_account_id
         FROM parent_account_contacts
         WHERE contact_type = 'email' AND contact_value = ?
         ORDER BY parent_account_id
         FOR UPDATE`,
        [verifiedEmail]
      );
      const accountIds = emailAccounts.map(row => Number(row.parent_account_id));
      if (accountIds.length) {
        accountId = Math.min(...accountIds);
        for (const duplicateId of accountIds.filter(id => id !== accountId)) {
          await connection.execute(
            `INSERT IGNORE INTO parent_student_relationships
               (parent_account_id, student_id, school_id, relationship_type, is_primary,
                can_view_results, can_view_fees, status)
             SELECT ?, student_id, school_id, relationship_type, is_primary,
                    can_view_results, can_view_fees, status
             FROM parent_student_relationships
             WHERE parent_account_id = ?`,
            [accountId, duplicateId]
          );
          await connection.execute(
            `INSERT IGNORE INTO parent_account_contacts
               (parent_account_id, contact_type, contact_value, is_primary, verified_at)
             SELECT ?, contact_type, contact_value, is_primary, verified_at
             FROM parent_account_contacts
             WHERE parent_account_id = ?`,
            [accountId, duplicateId]
          );
          await connection.execute(
            'UPDATE parent_profiles SET parent_account_id = ? WHERE parent_account_id = ?',
            [accountId, duplicateId]
          );
          await connection.execute(
            'UPDATE otp_sessions SET parent_account_id = ? WHERE parent_account_id = ?',
            [accountId, duplicateId]
          );
          await connection.execute('DELETE FROM parent_student_relationships WHERE parent_account_id = ?', [duplicateId]);
          await connection.execute('DELETE FROM parent_account_contacts WHERE parent_account_id = ?', [duplicateId]);
          await connection.execute('DELETE FROM parent_accounts WHERE parent_account_id = ?', [duplicateId]);
        }
      }
      await connection.execute(
        `UPDATE parent_account_contacts
         SET verified_at = COALESCE(verified_at, NOW())
         WHERE parent_account_id = ? AND contact_type = 'email' AND contact_value = ?`,
        [accountId, verifiedEmail]
      );
    }

    const [accounts] = await connection.execute(
      'SELECT parent_account_id, canonical_parent_phone, full_name FROM parent_accounts WHERE parent_account_id = ? LIMIT 1',
      [accountId]
    );
    if (!accounts.length) throw new Error('Parent account not found');
    account = accounts[0];

    await connection.execute(
      'UPDATE otp_sessions SET parent_account_id = ?, verified = TRUE, phone = ?, expires_at = DATE_ADD(NOW(), INTERVAL 4 HOUR) WHERE session_id = ?',
      [accountId, account.canonical_parent_phone, session_id]
    );

    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  const [countRows] = await req.db.execute(
    `SELECT COUNT(DISTINCT r.student_id) AS cnt
     FROM parent_student_relationships r
     JOIN students s ON s.student_id = r.student_id
     WHERE r.parent_account_id = ? AND r.status = 'active' AND s.enrollment_status = 'Active'`,
    [accountId]
  );

  res.json({
    session_id,
    parent_account_id: accountId,
    phone: account.canonical_parent_phone,
    parent_name: account.full_name,
    verified: true,
    registered: true,
    linked_children: Number(countRows[0]?.cnt || 0)
  });
}));

// Protect parent records with the verified OTP session, not a caller-supplied phone.
async function requireParentSession(req, res, next) {
  try {
    const auth = (req.headers.authorization || '').trim();
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
    const sessionId = auth.slice(7).trim();
    if (!sessionId) return res.status(401).json({ error: 'Invalid session' });

    const [sessions] = await req.db.execute(
      'SELECT phone, parent_account_id, verified, expires_at FROM otp_sessions WHERE session_id = ? LIMIT 1',
      [sessionId]
    );
    const session = sessions[0];
    if (!session || !session.verified || !session.expires_at || new Date(session.expires_at) <= new Date()) {
      return res.status(401).json({ error: 'Session expired or not verified' });
    }

    const sessionPhone = normalizePhone(session.phone);
    const accountId = session.parent_account_id || null;
    if (!accountId && !sessionPhone) return res.status(403).json({ error: 'Verified parent identity is not linked to this session' });

    const suppliedPhone = req.params.phone || (req.body && req.body.phone) || req.query.phone;
    if (suppliedPhone) {
      const supplied = normalizePhone(suppliedPhone);
      if (accountId) {
        const [contact] = await req.db.execute(
          "SELECT contact_id FROM parent_account_contacts WHERE parent_account_id = ? AND contact_type = 'phone' AND contact_value = ? LIMIT 1",
          [accountId, supplied]
        );
        if (!contact.length && supplied !== sessionPhone) {
          return res.status(403).json({ error: 'This session cannot access another parent account' });
        }
      } else if (supplied !== sessionPhone) {
        return res.status(403).json({ error: 'This session cannot access another parent account' });
      }
    }

    req.parentPhone = sessionPhone;
    req.parentAccountId = accountId;
    next();
  } catch (err) {
    next(err);
  }
}

// GET /api/parents/account-dashboard
// Consolidated family view: all active children linked to this global parent
// account, regardless of which school or legacy parent phone they were registered under.
router.get('/account-dashboard', requireParentSession, wrap(async (req, res) => {
  if (!req.parentAccountId) return res.status(403).json({ error: 'Global parent account migration is required' });

  const [children] = await req.db.execute(
    `SELECT s.student_id, s.full_name, c.class_name, s.school_id, sc.school_name,
       r.relationship_type, r.can_view_results, r.can_view_fees,
       (SELECT al.status FROM attendance_logs al WHERE al.student_id = s.student_id ORDER BY al.attendance_date DESC LIMIT 1) AS last_attendance,
       (SELECT al.attendance_date FROM attendance_logs al WHERE al.student_id = s.student_id ORDER BY al.attendance_date DESC LIMIT 1) AS last_date,
       (SELECT al.marked_at FROM attendance_logs al WHERE al.student_id = s.student_id ORDER BY al.attendance_date DESC LIMIT 1) AS arrival_time,
       (SELECT pl.amount FROM payment_ledger pl WHERE pl.student_reference = s.student_id AND pl.reversed_at IS NULL ORDER BY pl.logged_at DESC LIMIT 1) AS last_payment_amount,
       (SELECT pl.logged_at FROM payment_ledger pl WHERE pl.student_reference = s.student_id AND pl.reversed_at IS NULL ORDER BY pl.logged_at DESC LIMIT 1) AS last_payment_date
     FROM parent_student_relationships r
     JOIN students s ON s.student_id = r.student_id AND s.school_id = r.school_id
     JOIN classes c ON c.class_id = s.class_id
     JOIN schools sc ON sc.school_id = r.school_id
     WHERE r.parent_account_id = ? AND r.status = 'active' AND s.enrollment_status = 'Active'
     ORDER BY sc.school_name, s.full_name`,
    [req.parentAccountId]
  );

  const [accountRows] = await req.db.execute(
    'SELECT parent_account_id, canonical_parent_phone, full_name FROM parent_accounts WHERE parent_account_id = ? LIMIT 1',
    [req.parentAccountId]
  );
  const account = accountRows[0];
  const schoolMap = new Map();
  for (const child of children) {
    if (!schoolMap.has(child.school_id)) {
      schoolMap.set(child.school_id, {
        school_id: child.school_id,
        school_name: child.school_name,
        children_count: 0,
        premium_active: false,
        payment_model: 'parent'
      });
    }
    schoolMap.get(child.school_id).children_count += 1;
  }

  // Subscription entitlement is evaluated separately for each school.
  // A subscription paid for School A must never unlock School B.
  for (const schoolEntry of schoolMap.values()) {
    const [schoolRows] = await req.db.execute(
      'SELECT premium_payment_model FROM schools WHERE school_id = ? LIMIT 1',
      [schoolEntry.school_id]
    );
    const school = schoolRows[0];
    schoolEntry.payment_model = school?.premium_payment_model || 'parent';
    if (schoolEntry.payment_model === 'school') {
      schoolEntry.premium_active = true;
    } else {
      const [subscriptionRows] = await req.db.execute(
        `SELECT ps.subscription_id
         FROM premium_subscriptions ps
         JOIN parent_profiles pp ON pp.parent_phone = ps.parent_phone
         WHERE pp.parent_account_id = ? AND ps.school_id = ?
           AND ps.payment_status = 'paid'
           AND (ps.expires_at IS NULL OR ps.expires_at > NOW())
         LIMIT 1`,
        [req.parentAccountId, schoolEntry.school_id]
      );
      schoolEntry.premium_active = subscriptionRows.length > 0;
    }
  }

  for (const child of children) {
    child.premium_active = Boolean(schoolMap.get(child.school_id)?.premium_active);
  }

  const schoolList = Array.from(schoolMap.values());
  res.json({
    parent: { parent_name: account?.full_name || null },
    parent_account_id: req.parentAccountId,
    phone: account?.canonical_parent_phone || req.parentPhone,
    school_id: children[0]?.school_id || null,
    schools: schoolList,
    children,
    children_count: children.length,
    premium_active: schoolList.length > 0 && schoolList.every(s => s.premium_active),
    premium_any_active: schoolList.some(s => s.premium_active)
  });
}));

// GET /api/parents/my-schools/:phone — returns all schools a parent has children in
router.get('/my-schools/:phone', requireParentSession, wrap(async (req, res) => {
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

router.get('/dashboard/:phone', requireParentSession, wrap(async (req, res) => {
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
router.post('/upgrade', requireParentSession, wrap(async (req, res) => {
  const { phone: rawPhone, school_id, amount: clientAmount } = req.body;
  if (!rawPhone) return res.status(400).json({ error: 'Phone required' });
  const phone = normalizePhone(rawPhone);
  if (phone !== req.parentPhone) return res.status(403).json({ error: 'This session cannot pay from another parent account' });

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
router.get('/payment-status', requireParentSession, wrap(async (req, res) => {
  const { checkout_request_id, phone: rawPhone } = req.query;
  if (!checkout_request_id && !rawPhone) return res.status(400).json({ error: 'checkout_request_id or phone required' });
  const phone = rawPhone ? normalizePhone(rawPhone) : null;

  // 1. Check payment_ledger — matches individual parent upgrade STK
  //    (student_reference is set to CheckoutRequestID after the STK push)
  const [rows] = await req.db.execute(
    `SELECT notes, transaction_reference, amount FROM payment_ledger
     WHERE parent_phone = ? AND (student_reference = ? OR transaction_reference = ?)
     ORDER BY logged_at DESC LIMIT 1`,
    [req.parentPhone, checkout_request_id || '', checkout_request_id || '']
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

  // 2. Check premium_bulk_payments — matches bazar bulk/selected STK pushes.
  //    The checkout_request_id is stored after the STK push is initiated.
  if (checkout_request_id) {
    const [bulk] = await req.db.execute(
      `SELECT payment_status, school_id FROM premium_bulk_payments
       WHERE transaction_reference IN (
         SELECT transaction_reference FROM payment_ledger WHERE student_reference = ? OR transaction_reference = ? LIMIT 1
       )
       OR checkout_request_id = ?
       ORDER BY created_at DESC LIMIT 1`,
      [checkout_request_id, checkout_request_id, checkout_request_id]
    ).catch(() => [[]]);  // table may not have checkout_request_id column on older DBs

    if (bulk.length > 0 && bulk[0].payment_status === 'completed') {
      if (phone) {
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
      return res.json({ status: 'completed' });
    }
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

  // 3. No pending record found — check if already premium (paid via another path)
  if (!phone) return res.json({ status: 'pending' });
  const [p] = await req.db.execute(
    'SELECT is_premium, premium_expires_at FROM parent_profiles WHERE parent_phone = ?',
    [phone]
  );
  const active = p[0]?.is_premium && (!p[0]?.premium_expires_at || new Date(p[0].premium_expires_at) > new Date());
  return res.json({ status: active ? 'completed' : 'pending' });
}));

// GET /api/parents/academic-records/:phone — free endpoint, no premium check
router.get('/academic-records/:phone', requireParentSession, wrap(async (req, res) => {
  const phone = normalizePhone(req.params.phone);
  if (!phone) return res.status(400).json({ error: 'Phone required' });

  const { getCurrentTerm, getRubricConfig, getLevel } = require('../lib/config');

  let children;
  if (req.parentAccountId) {
    [children] = await req.db.execute(
      `SELECT s.student_id, s.full_name, c.class_name, s.school_id
       FROM parent_student_relationships r
       JOIN students s ON s.student_id = r.student_id AND s.school_id = r.school_id
       JOIN classes c ON s.class_id = c.class_id
       WHERE r.parent_account_id = ? AND r.status = 'active'
         AND r.can_view_results = 1 AND s.enrollment_status = 'Active'`,
      [req.parentAccountId]
    );
  } else {
    [children] = await req.db.execute(
      `SELECT s.student_id, s.full_name, c.class_name, s.school_id
       FROM students s
       JOIN classes c ON s.class_id = c.class_id
       JOIN student_parent_map m ON s.student_id = m.student_id
       WHERE m.parent_phone = ? AND s.enrollment_status = 'Active'`,
      [phone]
    );
  }

  const result = [];
  for (const child of children) {
    const rubricConfig = await getRubricConfig(req.db, child.school_id);
    const currentTerm = await getCurrentTerm(req.db, child.school_id);
    const currentYear = new Date().getFullYear();

    // Current term — assessment results by learning area (recorded levels, never averages)
    const [currentAreas] = await req.db.execute(
      `SELECT la.area_id, la.area_name, ar.performance_level, ar.score, a.max_score
       FROM assessment_results ar
       JOIN assessments a ON ar.assessment_id = a.assessment_id
       JOIN sub_strands ss ON a.sub_strand_id = ss.sub_strand_id
       JOIN strands st ON ss.strand_id = st.strand_id
       JOIN learning_areas la ON st.area_id = la.area_id
       WHERE ar.student_id = ? AND st.term = ? AND YEAR(a.date) = ?
       ORDER BY la.area_name`,
      [child.student_id, currentTerm, currentYear]
    );

    // Current term — exam results by learning area (recorded levels, never averages)
    const [currentExamAreas] = await req.db.execute(
      `SELECT la.area_id, la.area_name, er.performance_level, er.score, er.out_of
       FROM exam_results er
       JOIN exam_sessions es ON er.session_id = es.session_id
       JOIN sub_strands ss ON er.sub_strand_id = ss.sub_strand_id
       JOIN strands st ON ss.strand_id = st.strand_id
       JOIN learning_areas la ON st.area_id = la.area_id
       WHERE er.student_id = ? AND es.term = ? AND es.academic_year = ?
       ORDER BY la.area_name`,
      [child.student_id, currentTerm, currentYear]
    );

    const levelOrder = { EE: 4, ME: 3, AE: 2, BE: 1 };
    const dominantLevel = (levels) => {
      if (!levels || levels.length === 0) return null;
      return levels.reduce((best, l) => (levelOrder[l] || 0) > (levelOrder[best] || 0) ? l : best);
    };
    const DEFAULT_LABELS = {
      EE: { label: 'Exceeding Expectations', color: '#2E7D32' },
      ME: { label: 'Meeting Expectations', color: '#1565C0' },
      AE: { label: 'Approaching Expectations', color: '#E65100' },
      BE: { label: 'Below Expectations', color: '#C62828' }
    };
    const levelMeta = (code) => {
      const found = (rubricConfig || []).find(r => r.level_code === code);
      if (found) return { level: code, label: found.label, color: found.color };
      const d = DEFAULT_LABELS[code] || DEFAULT_LABELS.BE;
      return { level: code, label: d.label, color: d.color };
    };
    // Map one result row to its level: recorded first, else threshold-map its own percentage
    const rowLevel = (row, score, outOf) => {
      if (row.performance_level) return row.performance_level;
      if (score != null && Number(outOf) > 0) {
        const m = getLevel((Number(score) / Number(outOf)), rubricConfig);
        if (m) return m.level_code;
      }
      return null;
    };

    // Merge assessment + exam results
    const areaMap = new Map();
    for (const a of currentAreas) {
      if (!areaMap.has(a.area_name)) areaMap.set(a.area_name, { area_id: a.area_id, area_name: a.area_name, levels: [] });
      areaMap.get(a.area_name).levels.push(rowLevel(a, a.score, a.max_score));
    }
    for (const a of currentExamAreas) {
      if (!areaMap.has(a.area_name)) areaMap.set(a.area_name, { area_id: a.area_id, area_name: a.area_name, levels: [] });
      areaMap.get(a.area_name).levels.push(rowLevel(a, a.score, a.out_of));
    }
    const currentAreasList = [];
    for (const entry of areaMap.values()) {
      const code = dominantLevel((entry.levels || []).filter(Boolean)) || 'BE';
      currentAreasList.push({ area_name: entry.area_name, ...levelMeta(code) });
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
        // Area levels for this archived term (recorded levels, never averages)
        const [areas] = await req.db.execute(
          `SELECT la.area_name, ar.performance_level, ar.score, a.max_score
           FROM assessment_results ar
           JOIN assessments a ON ar.assessment_id = a.assessment_id
           JOIN sub_strands ss ON a.sub_strand_id = ss.sub_strand_id
           JOIN strands st ON ss.strand_id = st.strand_id
           JOIN learning_areas la ON st.area_id = la.area_id
           WHERE ar.student_id = ? AND st.term = ? AND YEAR(a.date) = ?
           ORDER BY la.area_name`,
          [child.student_id, term, year]
        );
        const byArea = new Map();
        for (const a of areas) {
          if (!byArea.has(a.area_name)) byArea.set(a.area_name, []);
          byArea.get(a.area_name).push(rowLevel(a, a.score, a.max_score));
        }
        termData.push({
          term,
          areas: Array.from(byArea.entries()).map(([area_name, levels]) => {
            const code = dominantLevel(levels.filter(Boolean)) || 'BE';
            return { area_name, ...levelMeta(code) };
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
