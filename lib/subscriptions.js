const { getNextTermStart } = require('./config');

// Return only schools where this parent currently has an active child and
// where the parent, rather than the school, is responsible for the subscription.
async function getBillableSchoolIds(db, phone, accountId) {
  let rows;
  if (accountId) {
    [rows] = await db.execute(
      `SELECT DISTINCT s.school_id
       FROM parent_student_relationships r
       JOIN students s ON s.student_id = r.student_id AND s.school_id = r.school_id
       JOIN schools sc ON sc.school_id = r.school_id
       WHERE r.parent_account_id = ? AND r.status = 'active'
         AND s.enrollment_status = 'Active'
         AND COALESCE(sc.premium_payment_model, 'parent') = 'parent'
       ORDER BY s.school_id`,
      [accountId]
    );
  } else {
    [rows] = await db.execute(
      `SELECT DISTINCT s.school_id
       FROM students s
       JOIN student_parent_map m ON m.student_id = s.student_id
       JOIN schools sc ON sc.school_id = s.school_id
       WHERE m.parent_phone = ? AND s.enrollment_status = 'Active'
         AND COALESCE(sc.premium_payment_model, 'parent') = 'parent'
       ORDER BY s.school_id`,
      [phone]
    );
  }
  return rows.map(row => String(row.school_id));
}

// Resolve school context deterministically. A multi-school parent must choose;
// never silently allocate a payment or prepaid credit to the first school.
async function resolveParentSchool(db, phone, requestedSchoolId) {
  const [profiles] = await db.execute(
    'SELECT parent_account_id FROM parent_profiles WHERE parent_phone = ? LIMIT 1',
    [phone]
  );
  const accountId = profiles[0]?.parent_account_id || null;
  const schoolIds = await getBillableSchoolIds(db, phone, accountId);

  if (requestedSchoolId) {
    const selected = String(requestedSchoolId);
    if (!schoolIds.includes(selected)) {
      throw new Error('The selected school has no active, billable children linked to this parent');
    }
    return { schoolId: selected, accountId };
  }

  if (schoolIds.length === 1) return { schoolId: schoolIds[0], accountId };
  if (schoolIds.length > 1) {
    throw new Error('Select a school before applying a parent subscription payment or prepaid credit');
  }
  throw new Error('No active billable children found for this parent');
}

// Compute the per-term price for the selected school only.
async function getTermPrice(db, phone, schoolId = null) {
  const resolved = await resolveParentSchool(db, phone, schoolId);
  const [setting] = await db.execute(
    "SELECT setting_value FROM app_settings WHERE setting_key = 'premium_price'"
  );
  const pricePerChild = parseInt(setting[0]?.setting_value || '200', 10);
  if (!Number.isFinite(pricePerChild) || pricePerChild <= 0) {
    throw new Error('The configured premium price is invalid');
  }

  let rows;
  if (resolved.accountId) {
    [rows] = await db.execute(
      `SELECT COUNT(DISTINCT s.student_id) AS child_count
       FROM parent_student_relationships r
       JOIN students s ON s.student_id = r.student_id AND s.school_id = r.school_id
       WHERE r.parent_account_id = ? AND r.school_id = ?
         AND r.status = 'active' AND s.enrollment_status = 'Active'`,
      [resolved.accountId, resolved.schoolId]
    );
  } else {
    [rows] = await db.execute(
      `SELECT COUNT(DISTINCT s.student_id) AS child_count
       FROM students s
       JOIN student_parent_map m ON m.student_id = s.student_id
       WHERE m.parent_phone = ? AND s.school_id = ?
         AND s.enrollment_status = 'Active'`,
      [phone, resolved.schoolId]
    );
  }

  return {
    schoolId: resolved.schoolId,
    accountId: resolved.accountId,
    amount: pricePerChild * Number(rows[0]?.child_count || 0)
  };
}

// Read the prepaid balance associated with this verified parent phone.
async function getPrepaidBalance(db, phone) {
  const [rows] = await db.execute(
    'SELECT prepaid_balance FROM parent_profiles WHERE parent_phone = ?',
    [phone]
  );
  return rows.length > 0 ? parseFloat(rows[0].prepaid_balance || 0) : 0;
}

// Apply a confirmed M-Pesa payment to exactly one school's subscription.
// The caller should execute this using its transaction connection.
async function applyParentPayment(db, phone, amount, activeSchoolId) {
  const pricing = await getTermPrice(db, phone, activeSchoolId);
  const paidAmount = Number(amount);
  if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
    throw new Error('The confirmed payment amount is invalid');
  }
  if (pricing.amount <= 0) {
    throw new Error('No billable children found for the selected school');
  }
  if (paidAmount < pricing.amount) {
    throw new Error(`Insufficient subscription payment: KSh ${pricing.amount} required for this school`);
  }

  const termsActivated = Math.floor((paidAmount + 0.000001) / pricing.amount);
  const remaining = Math.max(0, Math.round((paidAmount - (termsActivated * pricing.amount)) * 100) / 100);
  let cursor = new Date();
  let finalExpiry = cursor;

  for (let i = 0; i < termsActivated; i++) {
    finalExpiry = await getNextTermStart(db, pricing.schoolId, cursor);
    cursor = finalExpiry;
  }

  const currentTerm = getCurrentTermLabel();
  const currentYear = new Date().getFullYear();
  await db.execute(
    'UPDATE parent_profiles SET is_premium = TRUE, premium_expires_at = ? WHERE parent_phone = ?',
    [finalExpiry, phone]
  );

  if (remaining > 0) {
    await db.execute(
      'UPDATE parent_profiles SET prepaid_balance = prepaid_balance + ? WHERE parent_phone = ?',
      [remaining, phone]
    );
  }

  await db.execute(
    `INSERT INTO premium_subscriptions
     (school_id, parent_phone, term, year, payment_model, payment_status, amount, activated_at, expires_at)
     VALUES (?, ?, ?, ?, 'parent', 'paid', ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE payment_status = 'paid', activated_at = NOW(),
       expires_at = VALUES(expires_at), amount = VALUES(amount)`,
    [pricing.schoolId, phone, currentTerm, currentYear, paidAmount, finalExpiry]
  );

  return { school_id: pricing.schoolId, terms_activated: termsActivated, expires_at: finalExpiry, prepaid_balance_added: remaining };
}

// Extend expiry only within the explicitly resolved school.
async function extendPremium(db, phone, activeSchoolId, termsAhead) {
  const { schoolId } = await resolveParentSchool(db, phone, activeSchoolId);
  let cursor = new Date();
  for (let i = 0; i < termsAhead; i++) {
    cursor = await getNextTermStart(db, schoolId, cursor);
  }
  return cursor;
}

function getCurrentTermLabel() {
  const month = new Date().getMonth() + 1;
  return `Term ${Math.ceil(month / 4)}`;
}

// Prepaid credit is applied only to the selected school's term amount.
async function autoActivateFromPrepaid(db, phone, activeSchoolId) {
  const pricing = await getTermPrice(db, phone, activeSchoolId);
  if (pricing.amount <= 0) return false;

  const balance = await getPrepaidBalance(db, phone);
  if (balance < pricing.amount) return false;

  const newExpiry = await extendPremium(db, phone, pricing.schoolId, 1);
  await db.execute(
    'UPDATE parent_profiles SET is_premium = TRUE, premium_expires_at = ?, prepaid_balance = prepaid_balance - ? WHERE parent_phone = ?',
    [newExpiry, pricing.amount, phone]
  );
  await db.execute(
    `INSERT INTO premium_subscriptions
     (school_id, parent_phone, term, year, payment_model, payment_status, amount, activated_at, expires_at)
     VALUES (?, ?, ?, ?, 'parent', 'paid', ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE payment_status = 'paid', activated_at = NOW(),
       expires_at = VALUES(expires_at), amount = VALUES(amount)`,
    [pricing.schoolId, phone, getCurrentTermLabel(), new Date().getFullYear(), pricing.amount, newExpiry]
  );
  return true;
}

module.exports = {
  getBillableSchoolIds,
  resolveParentSchool,
  getTermPrice,
  getPrepaidBalance,
  applyParentPayment,
  getCurrentTermLabel,
  autoActivateFromPrepaid
};
