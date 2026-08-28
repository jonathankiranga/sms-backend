const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { sendEmailOtp } = require('../services/messaging');

// Express 4 does not catch rejected promises from async handlers — without this
// wrapper any thrown error leaves the request hanging forever.
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Hard cap on email delivery so a wedged provider can never stall a request.
function deliverEmailOtp(email, code) {
  return Promise.race([
    sendEmailOtp(email, code),
    new Promise(resolve => setTimeout(() => resolve({ provider: 'timeout' }), 8000))
  ]);
}

// Accept 07.. / 7.. / +254.. / 254.. and store compare in canonical 254.. form
function normalizePhone(raw) {
  let p = String(raw || '').replace(/[\s-]/g, '').replace(/^\+/, '');
  if (/^0([17]\d{8})$/.test(p)) p = '254' + p.slice(1);
  else if (/^[17]\d{8}$/.test(p)) p = '254' + p;
  return p;
}

// Resolve the premium parent by phone OR email; returns canonical contact row.
async function findPremiumParent(db, phone, email) {
  if (phone) {
    const [rows] = await db.execute(
      "SELECT parent_phone, email FROM parent_profiles WHERE parent_phone = ? AND is_premium = TRUE AND (premium_expires_at IS NULL OR premium_expires_at > NOW())",
      [phone]
    );
    if (rows.length > 0) return rows[0];
  }
  if (email) {
    const [rows] = await db.execute(
      "SELECT parent_phone, email FROM parent_profiles WHERE email = ? AND is_premium = TRUE AND (premium_expires_at IS NULL OR premium_expires_at > NOW())",
      [String(email).trim().toLowerCase()]
    );
    if (rows.length > 0) return rows[0];
  }
  return null;
}

// POST /api/merchants/auto-login — premium parent opens merchant portal without OTP.
// Returns an existing merchant for their phone, or creates one with a default business name.
router.post('/auto-login', wrap(async (req, res) => {
  const normPhone = normalizePhone(req.body.phone);
  if (!normPhone) return res.status(400).json({ error: 'Phone required' });
  const parent = await findPremiumParent(req.db, normPhone, null);
  if (!parent) return res.status(403).json({ error: 'Only premium parents can sell on the School Market.' });

  let [merchant] = await req.db.execute('SELECT merchant_id, business_name FROM merchants WHERE phone = ?', [parent.parent_phone]);
  if (merchant.length === 0) {
    const [pp] = await req.db.execute('SELECT full_name FROM parent_profiles WHERE parent_phone = ?', [parent.parent_phone]);
    const businessName = (pp[0]?.full_name ? pp[0].full_name + ' ' : '') + 'Store';
    const mid = 'MER' + Date.now().toString(36).toUpperCase();
    await req.db.execute(
      'INSERT INTO merchants (merchant_id, business_name, phone, email) VALUES (?, ?, ?, ?)',
      [mid, businessName.slice(0, 140), parent.parent_phone, parent.email || null]
    );
    merchant = [{ merchant_id: mid, business_name: businessName.slice(0, 140) }];
  }
  res.json({ merchant_id: merchant[0].merchant_id, business_name: merchant[0].business_name, auto_created: true });
}));

// POST /api/merchants/register
router.post('/register', wrap(async (req, res) => {
  const { business_name } = req.body;
  const emailInput = String(req.body.email || '').trim();
  const normPhone = normalizePhone(req.body.phone);
  if (!business_name) return res.status(400).json({ error: 'Business name required' });
  if (!normPhone && !emailInput) return res.status(400).json({ error: 'Phone or email required' });

  // Must be a premium parent — identified by phone OR email
  const parent = await findPremiumParent(req.db, normPhone, emailInput);
  if (!parent) return res.status(403).json({ error: 'Only premium parents can register as merchants. Upgrade first.' });

  // Canonical contact number for the listing (what parents will call)
  const phone = parent.parent_phone;

  const [existing] = await req.db.execute('SELECT merchant_id FROM merchants WHERE phone = ?', [phone]);
  if (existing.length > 0) return res.status(409).json({ error: 'Phone already registered' });
  const mid = 'MER' + Date.now().toString(36).toUpperCase();
  await req.db.execute('INSERT INTO merchants (merchant_id, business_name, phone, email) VALUES (?, ?, ?, ?)', [mid, business_name, phone, emailInput || null]);

  const code = Math.floor(1000 + Math.random() * 9000).toString();
  const sid = crypto.randomBytes(32).toString('hex');
  await req.db.execute('INSERT INTO otp_sessions (session_id, phone, code, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))', [sid, phone, code]);
  let delivered = false;
  try {
    const mailTo = emailInput || parent.email || null;
    if (mailTo) { await deliverEmailOtp(mailTo, code); delivered = true; }
  } catch (e) { console.error('[MER:Register] email failed:', e.message); }
  if (!delivered && process.env.NODE_ENV !== 'production') console.log('=== OTP for merchant', phone, ':', code, '===');
  res.json({ merchant_id: mid, session_id: sid, message: delivered ? 'Registered. OTP sent to your email.' : 'Registered. OTP sent.' });
}));

// POST /api/merchants/request-otp
router.post('/request-otp', wrap(async (req, res) => {
  const normPhone = normalizePhone(req.body.phone);
  const emailInput = String(req.body.email || '').trim();
  if (!normPhone && !emailInput) return res.status(400).json({ error: 'Phone or email required' });
  let rows;
  if (normPhone) {
    [rows] = await req.db.execute('SELECT merchant_id, phone FROM merchants WHERE phone = ?', [normPhone]);
  }
  if ((!rows || rows.length === 0) && emailInput) {
    [rows] = await req.db.execute('SELECT merchant_id, phone FROM merchants WHERE email = ?', [emailInput]);
  }
  if (!rows || rows.length === 0) return res.status(404).json({ error: 'Merchant not found. Register first.' });
  const phone = rows[0].phone;
  const code = Math.floor(1000 + Math.random() * 9000).toString();
  const sid = crypto.randomBytes(32).toString('hex');
  await req.db.execute('INSERT INTO otp_sessions (session_id, phone, code, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))', [sid, phone, code]);
  let delivered = false;
  try {
    const [mail] = await req.db.execute(
      `SELECT COALESCE(m.email, pp.email) AS email
       FROM merchants m LEFT JOIN parent_profiles pp ON pp.parent_phone = m.phone
       WHERE m.merchant_id = ?`,
      [rows[0].merchant_id]
    );
    if (mail.length > 0 && mail[0].email) { await deliverEmailOtp(mail[0].email, code); delivered = true; }
  } catch (e) { /* fall through */ }
  if (!delivered && process.env.NODE_ENV !== 'production') console.log('=== OTP for merchant', phone, ':', code, '===');
  res.json({ session_id: sid, message: delivered ? 'OTP sent to your email' : 'OTP sent' });
}));

// POST /api/merchants/verify-otp
router.post('/verify-otp', wrap(async (req, res) => {
  const { session_id, code } = req.body;
  if (!session_id || !code) return res.status(400).json({ error: 'Missing session_id or code' });
  const [rows] = await req.db.execute('SELECT phone FROM otp_sessions WHERE session_id = ? AND code = ? AND expires_at > NOW() AND verified = FALSE', [session_id, code]);
  if (rows.length === 0) return res.status(401).json({ error: 'Invalid or expired code' });
  await req.db.execute('UPDATE otp_sessions SET verified = TRUE WHERE session_id = ?', [session_id]);
  const [m] = await req.db.execute('SELECT merchant_id, business_name FROM merchants WHERE phone = ?', [normalizePhone(rows[0].phone)]);
  res.json({ merchant_id: m[0].merchant_id, business_name: m[0].business_name, verified: true });
}));

// GET /api/merchants/campaigns?merchant_id=X
router.get('/campaigns', wrap(async (req, res) => {
  const { merchant_id } = req.query;
  const [rows] = await req.db.execute(
    'SELECT ad_id, merchant_name AS business_name, merchant_phone, message, banner_image_url, target_link, status, start_date, end_date FROM marketplace_campaigns WHERE merchant_name IN (SELECT business_name FROM merchants WHERE merchant_id = ?) ORDER BY created_at DESC',
    [merchant_id]
  );
  res.json({ campaigns: rows });
}));

// POST /api/merchants/campaigns
// Ads run across ALL schools — no targeting. target_school_id stays NULL.
router.post('/campaigns', wrap(async (req, res) => {
  const { merchant_id, message, days } = req.body;
  if (!merchant_id || !message || !days) return res.status(400).json({ error: 'Missing fields' });
  const [m] = await req.db.execute('SELECT business_name, phone FROM merchants WHERE merchant_id = ?', [merchant_id]);
  if (m.length === 0) return res.status(404).json({ error: 'Merchant not found' });
  // Limit duration to a maximum of 60 days (approximately 2 months)
  const duration = Math.min(Math.max(parseInt(days) || 7, 1), 60);
  const startDate = new Date().toISOString().slice(0, 10);
  const endDate = new Date(Date.now() + duration * 86400000).toISOString().slice(0, 10);

  const [result] = await req.db.execute(
    'INSERT INTO marketplace_campaigns (target_school_id, merchant_name, merchant_phone, message, banner_image_url, target_link, status, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [null, m[0].business_name, m[0].phone || null, message, '', '#', 'Active', startDate, endDate]
  );
  const campaignId = result.insertId;

  res.json({ message: 'Campaign created', campaign_id: campaignId, days: duration });
}));

// ---------- School Market: searchable product catalog. The platform only
// surfaces listings with the seller's contact; all dealing is direct. ----------
let marketTablesReady = false;
async function ensureMarketTables(db) {
  if (marketTablesReady) return;
  await db.execute(`CREATE TABLE IF NOT EXISTS products (
    product_id VARCHAR(24) PRIMARY KEY,
    merchant_id VARCHAR(24) NOT NULL,
    name VARCHAR(140) NOT NULL,
    description TEXT NULL,
    category VARCHAR(60) NOT NULL DEFAULT 'Other',
    price DECIMAL(10,2) NOT NULL DEFAULT 0,
    image_url TEXT NULL,
    target_school_id CHAR(9) NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_products_merchant (merchant_id),
    INDEX idx_products_category (category),
    INDEX idx_products_active (active)
  )`);
  marketTablesReady = true;
}

// GET /api/market/products?q=&category= — searchable catalog for parents
router.get('/market/products', wrap(async (req, res) => {
  await ensureMarketTables(req.db);
  const q = String(req.query.q || '').trim();
  const category = String(req.query.category || '').trim();
  let sql = `SELECT p.product_id, p.name, p.description, p.category, p.price, p.image_url,
                    m.business_name, m.phone AS merchant_phone
             FROM products p JOIN merchants m ON p.merchant_id = m.merchant_id
             WHERE p.active = TRUE`;
  const params = [];
  if (category && category !== 'All') { sql += ' AND p.category = ?'; params.push(category); }
  if (q) {
    sql += ' AND (p.name LIKE ? OR p.description LIKE ? OR p.category LIKE ? OR m.business_name LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  sql += ' ORDER BY p.created_at DESC LIMIT 100';
  const [rows] = await req.db.execute(sql, params);
  res.json({ products: rows });
}));

// POST /api/merchants/products — merchant adds a listing
router.post('/products', wrap(async (req, res) => {
  await ensureMarketTables(req.db);
  const { merchant_id, name, description, category, price, image_url } = req.body;
  if (!merchant_id || !name) return res.status(400).json({ error: 'Merchant and product name required' });
  const [m] = await req.db.execute('SELECT merchant_id FROM merchants WHERE merchant_id = ?', [merchant_id]);
  if (m.length === 0) return res.status(404).json({ error: 'Merchant not found' });
  const pid = 'PRD' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 36).toString(36).toUpperCase();
  await req.db.execute(
    'INSERT INTO products (product_id, merchant_id, name, description, category, price, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [pid, merchant_id, String(name).slice(0, 140), (description || '').slice(0, 2000) || null,
     String(category || 'Other').slice(0, 60), Math.max(0, parseFloat(price) || 0), image_url || null]
  );
  res.json({ message: 'Product listed', product_id: pid });
}));

// GET /api/merchants/products?merchant_id=X — merchant's own listings
router.get('/products', wrap(async (req, res) => {
  await ensureMarketTables(req.db);
  const { merchant_id } = req.query;
  if (!merchant_id) return res.status(400).json({ error: 'merchant_id required' });
  const [rows] = await req.db.execute(
    'SELECT product_id, name, description, category, price, active, created_at FROM products WHERE merchant_id = ? ORDER BY created_at DESC',
    [merchant_id]
  );
  res.json({ products: rows });
}));

// POST /api/merchants/products/deactivate — merchant hides a listing
router.post('/products/deactivate', wrap(async (req, res) => {
  await ensureMarketTables(req.db);
  const { merchant_id, product_id } = req.body;
  if (!merchant_id || !product_id) return res.status(400).json({ error: 'Missing fields' });
  const [r] = await req.db.execute('UPDATE products SET active = FALSE WHERE product_id = ? AND merchant_id = ?', [product_id, merchant_id]);
  if (r.affectedRows === 0) return res.status(404).json({ error: 'Product not found' });
  res.json({ message: 'Listing hidden' });
}));

module.exports = router;
