const { getNextTermStart, getCurrentTerm } = require('./config');

// Compute the per-term subscription price for a parent based on active children.
async function getTermPrice(db, phone) {
  const [setting] = await db.execute("SELECT setting_value FROM app_settings WHERE setting_key = 'premium_price'");
  const pricePerChild = parseInt(setting[0]?.setting_value || '100', 10);
  const [childRows] = await db.execute(
    `SELECT s.student_id FROM students s
     JOIN student_parent_map m ON s.student_id = m.student_id
     JOIN schools sc ON s.school_id = sc.school_id
     WHERE m.parent_phone = ? AND s.enrollment_status = 'Active' AND COALESCE(sc.premium_payment_model,'parent') = 'parent'`,
    [phone]
  );
  return pricePerChild * Math.max(childRows.length, 1);
}

// Read the parent's current prepaid (credit) balance.
async function getPrepaidBalance(db, phone) {
  const [rows] = await db.execute('SELECT prepaid_balance FROM parent_profiles WHERE parent_phone = ?', [phone]);
  return rows.length > 0 ? parseFloat(rows[0].prepaid_balance || 0) : 0;
}

// Apply a real M-Pesa payment towards the parent's subscription.
// - Covers the current term (and extends premium_expires_at).
// - If the amount covers more than one term's cost, any surplus is banked as a
//   prepaid balance and auto-applied to subsequent terms.
// Takes a db connection/transaction so the whole allocation is atomic.
async function applyParentPayment(db, phone, amount, activeSchoolId) {
  const termPrice = await getTermPrice(db, phone);
  await db.execute("UPDATE parent_profiles SET is_premium = TRUE WHERE parent_phone = ?", [phone]);

  let remaining = parseFloat(amount || 0);
  const currentTerm = getCurrentTermLabel();
  const currentYear = new Date().getFullYear();
  let currentExpires = await extendPremium(db, phone, activeSchoolId, 1);

  // First term is covered by the payment itself (if the parent has any children).
  remaining -= termPrice;

  // Any leftover keeps covering future terms and banks as a running credit.
  let coveredExtra = 0;
  let futureCursor = currentExpires;
  while (remaining >= termPrice) {
    remaining -= termPrice;
    coveredExtra += 1;
    futureCursor = await extendPremium(db, phone, activeSchoolId, coveredExtra + 1);
  }
  if (coveredExtra > 0) {
    await db.execute(
      "UPDATE parent_profiles SET premium_expires_at = ? WHERE parent_phone = ?",
      [futureCursor, phone]
    );
  }

  // Bank whatever remains after whole terms as a prepaid balance.
  await db.execute(
    "UPDATE parent_profiles SET prepaid_balance = prepaid_balance + ? WHERE parent_phone = ?",
    [Math.max(remaining, 0), phone]
  );

  await db.execute(
    `INSERT INTO premium_subscriptions
     (school_id, parent_phone, term, year, payment_model, payment_status, amount, activated_at, expires_at)
     VALUES (?, ?, ?, ?, 'parent', 'paid', ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE payment_status = 'paid', activated_at = NOW(), expires_at = VALUES(expires_at), amount = VALUES(amount)`,
    [activeSchoolId || null, phone, currentTerm, currentYear, amount, currentExpires]
  );
}

// Extend premium expiry N terms ahead of the best current term start.
async function extendPremium(db, phone, activeSchoolId, termsAhead) {
  let cursor = new Date();
  let schoolId = activeSchoolId;
  if (!schoolId) {
    const [rows] = await db.execute(
      'SELECT sc.school_id FROM schools sc JOIN students s ON s.school_id = sc.school_id JOIN student_parent_map m ON m.student_id = s.student_id WHERE m.parent_phone = ? LIMIT 1',
      [phone]
    );
    schoolId = rows[0]?.school_id || null;
  }
  for (let i = 0; i < termsAhead; i++) {
    if (schoolId) cursor = await getNextTermStart(db, schoolId);
    else cursor = new Date(cursor.getTime() + 90 * 86400000);
  }
  return cursor;
}

function getCurrentTermLabel() {
  const m = new Date().getMonth() + 1;
  return `Term ${Math.ceil(m / 4)}`;
}

module.exports = { getTermPrice, getPrepaidBalance, applyParentPayment, getCurrentTermLabel, autoActivateFromPrepaid };

// If a parent has enough prepaid balance to cover the current term, activate them
// and consume one term's worth of credit (extending premium_expires_at by one term).
// Returns true if it activated the current term, false otherwise.
async function autoActivateFromPrepaid(db, phone, activeSchoolId) {
  const termPrice = await getTermPrice(db, phone);
  if (termPrice <= 0) return false;
  const balance = await getPrepaidBalance(db, phone);
  if (balance < termPrice) return false;

  const newExpiry = await extendPremium(db, phone, activeSchoolId, 1);
  await db.execute(
    "UPDATE parent_profiles SET is_premium = TRUE, premium_expires_at = ?, prepaid_balance = prepaid_balance - ? WHERE parent_phone = ?",
    [newExpiry, termPrice, phone]
  );
  await db.execute(
    `INSERT INTO premium_subscriptions
     (school_id, parent_phone, term, year, payment_model, payment_status, amount, activated_at, expires_at)
     VALUES (?, ?, ?, ?, 'parent', 'paid', ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE payment_status = 'paid', activated_at = NOW(), expires_at = VALUES(expires_at)`,
    [activeSchoolId || null, phone, getCurrentTermLabel(), new Date().getFullYear(), termPrice, newExpiry]
  );
  return true;
}
