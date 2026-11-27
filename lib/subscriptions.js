const { getNextTermStart } = require('./config');
const crypto = require('crypto');

function normalizePhone(value) {
  if (!value) return '';
  const phone = String(value).replace(/[\s-]/g, '').replace(/^\+/, '');
  if (/^0[17]\d{8}$/.test(phone)) return '254' + phone.slice(1);
  if (/^[17]\d{8}$/.test(phone)) return '254' + phone;
  return phone;
}

function normalizedPhoneSql(column) {
  const raw = `REPLACE(REPLACE(REPLACE(TRIM(${column}), ' ', ''), '-', ''), '+', '')`;
  return `CASE
    WHEN CHAR_LENGTH(${raw}) = 10 AND LEFT(${raw}, 1) = '0'
      THEN CONCAT('254', SUBSTRING(${raw}, 2))
    WHEN CHAR_LENGTH(${raw}) = 9 AND LEFT(${raw}, 1) IN ('1', '7')
      THEN CONCAT('254', ${raw})
    ELSE ${raw}
  END`;
}

async function resolveParentIdentity(db, phone) {
  const normalizedPhone = normalizePhone(phone);
  const [rows] = await db.execute(
    `SELECT p.parent_phone, p.parent_account_id, a.canonical_parent_phone
     FROM parent_profiles p
     LEFT JOIN parent_accounts a ON a.parent_account_id = p.parent_account_id
     WHERE ${normalizedPhoneSql('p.parent_phone')} = ?
     ORDER BY (p.parent_account_id IS NOT NULL) DESC,
              (p.parent_phone = a.canonical_parent_phone) DESC,
              p.parent_phone
     LIMIT 2`,
    [normalizedPhone]
  );
  if (!rows.length) throw new Error('Parent profile not found for the verified phone number');
  const accountIds = [...new Set(rows.map(row => row.parent_account_id).filter(Boolean).map(Number))];
  if (accountIds.length > 1) {
    throw new Error('This phone is linked to multiple parent accounts. Complete parent account consolidation before payment');
  }
  const row = rows[0];
  return {
    accountId: row.parent_account_id || null,
    parentPhone: row.canonical_parent_phone || row.parent_phone
  };
}

// Return only schools where this parent currently has an active child and
// where the parent, rather than the school, is responsible for the subscription.
async function getBillableSchoolIds(db, parentPhone, accountId) {
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
      [parentPhone]
    );
  }
  return rows.map(row => String(row.school_id));
}

// Resolve school context deterministically. A multi-school parent must choose;
// never silently allocate a payment or prepaid credit to the first school.
async function resolveParentSchool(db, phone, requestedSchoolId) {
  const identity = await resolveParentIdentity(db, phone);
  const schoolIds = await getBillableSchoolIds(db, identity.parentPhone, identity.accountId);

  if (requestedSchoolId) {
    const selected = String(requestedSchoolId);
    if (!schoolIds.includes(selected)) {
      throw new Error('The selected school has no active, billable children linked to this parent');
    }
    return { ...identity, schoolId: selected };
  }

  if (schoolIds.length === 1) return { ...identity, schoolId: schoolIds[0] };
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
      [resolved.parentPhone, resolved.schoolId]
    );
  }

  return {
    ...resolved,
    amount: pricePerChild * Number(rows[0]?.child_count || 0)
  };
}

// Read the canonical profile's prepaid balance after resolving the verified phone.
async function getPrepaidBalance(db, phone) {
  const identity = await resolveParentIdentity(db, phone);
  const [rows] = await db.execute(
    'SELECT prepaid_balance FROM parent_profiles WHERE parent_phone = ? LIMIT 1',
    [identity.parentPhone]
  );
  return rows.length > 0 ? parseFloat(rows[0].prepaid_balance || 0) : 0;
}

async function updateCanonicalProfile(db, pricing, sql, params) {
  if (pricing.accountId) {
    return db.execute(
      sql.replace('WHERE parent_phone = ?', 'WHERE parent_account_id = ?'),
      [...params.slice(0, -1), pricing.accountId]
    );
  }
  return db.execute(sql, params);
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
  const [existingSubscriptions] = await db.execute(
    `SELECT MAX(expires_at) AS current_expiry
     FROM premium_subscriptions
     WHERE school_id = ? AND parent_phone = ? AND payment_status = 'paid'
       AND expires_at > NOW()`,
    [pricing.schoolId, pricing.parentPhone]
  );
  if (existingSubscriptions[0]?.current_expiry) {
    cursor = new Date(existingSubscriptions[0].current_expiry);
  }
  let finalExpiry = cursor;

  for (let i = 0; i < termsActivated; i++) {
    finalExpiry = await getNextTermStart(db, pricing.schoolId, cursor);
    cursor = finalExpiry;
  }

  const currentTerm = getCurrentTermLabel();
  const currentYear = new Date().getFullYear();
  await updateCanonicalProfile(
    db,
    pricing,
    'UPDATE parent_profiles SET is_premium = TRUE, premium_expires_at = ? WHERE parent_phone = ?',
    [finalExpiry, pricing.parentPhone]
  );

  if (remaining > 0) {
    await updateCanonicalProfile(
      db,
      pricing,
      'UPDATE parent_profiles SET prepaid_balance = prepaid_balance + ? WHERE parent_phone = ?',
      [remaining, pricing.parentPhone]
    );
  }

  await db.execute(
    `INSERT INTO premium_subscriptions
     (school_id, parent_phone, term, year, payment_model, payment_status, amount, activated_at, expires_at)
     VALUES (?, ?, ?, ?, 'parent', 'paid', ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE payment_status = 'paid', activated_at = NOW(),
       expires_at = VALUES(expires_at), amount = VALUES(amount)`,
    [pricing.schoolId, pricing.parentPhone, currentTerm, currentYear, paidAmount, finalExpiry]
  );

  return { school_id: pricing.schoolId, terms_activated: termsActivated, expires_at: finalExpiry, prepaid_balance_added: remaining };
}

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

async function autoActivateFromPrepaid(db, phone, activeSchoolId) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const pricing = await getTermPrice(connection, phone, activeSchoolId);
    if (pricing.amount <= 0) {
      await connection.commit();
      return false;
    }

    const [activeSubscriptions] = await connection.execute(
      `SELECT 1 FROM premium_subscriptions
       WHERE school_id = ? AND parent_phone = ? AND payment_status = 'paid'
         AND (expires_at IS NULL OR expires_at > NOW())
       LIMIT 1 FOR UPDATE`,
      [pricing.schoolId, pricing.parentPhone]
    );
    if (activeSubscriptions.length > 0) {
      await connection.commit();
      return false;
    }

    const [walletRows] = await connection.execute(
      'SELECT prepaid_balance FROM parent_profiles WHERE parent_phone = ? LIMIT 1 FOR UPDATE',
      [pricing.parentPhone]
    );
    const balance = Number(walletRows[0]?.prepaid_balance || 0);
    if (balance < pricing.amount) {
      await connection.commit();
      return false;
    }

    const newExpiry = await getNextTermStart(connection, pricing.schoolId);
    const currentTerm = getCurrentTermLabel();
    const currentYear = new Date().getFullYear();
    await connection.execute(
      'UPDATE parent_profiles SET is_premium = TRUE, premium_expires_at = ?, prepaid_balance = prepaid_balance - ? WHERE parent_phone = ?',
      [newExpiry, pricing.amount, pricing.parentPhone]
    );
    await connection.execute(
      `INSERT INTO premium_subscriptions
       (school_id, parent_phone, term, year, payment_model, payment_status, amount, activated_at, expires_at)
       VALUES (?, ?, ?, ?, 'parent', 'paid', ?, NOW(), ?)
       ON DUPLICATE KEY UPDATE payment_status = 'paid', activated_at = NOW(),
         expires_at = VALUES(expires_at), amount = VALUES(amount)`,
      [pricing.schoolId, pricing.parentPhone, currentTerm, currentYear, pricing.amount, newExpiry]
    );
    const reference = 'PRE-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    await connection.execute(
      `INSERT INTO payment_ledger
       (transaction_reference, amount, parent_phone, student_reference, payment_method,
        school_id, term, academic_year, notes, logged_at)
       VALUES (?, ?, ?, ?, 'Prepaid Balance', ?, ?, ?, 'PREPAID_SUBSCRIPTION', NOW())`,
      [reference, pricing.amount, pricing.parentPhone, 'SUB-' + pricing.parentPhone,
        pricing.schoolId, currentTerm, currentYear]
    );

    await connection.commit();
    return true;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

module.exports = {
  normalizePhone,
  normalizedPhoneSql,
  resolveParentIdentity,
  getBillableSchoolIds,
  resolveParentSchool,
  getTermPrice,
  getPrepaidBalance,
  applyParentPayment,
  getCurrentTermLabel,
  autoActivateFromPrepaid
};
