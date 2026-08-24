const express = require('express');
const crypto = require('crypto');
const router = express.Router();

// POST /api/merchants/register
router.post('/register', async (req, res) => {
  const { business_name, phone, email } = req.body;
  if (!business_name || !phone) return res.status(400).json({ error: 'Business name and phone required' });

  // Must be a premium parent
  const [parentCheck] = await req.db.execute(
    "SELECT is_premium, premium_expires_at FROM parent_profiles WHERE parent_phone = ? AND is_premium = TRUE AND (premium_expires_at IS NULL OR premium_expires_at > NOW())",
    [phone]
  );
  if (parentCheck.length === 0) return res.status(403).json({ error: 'Only premium parents can register as merchants. Upgrade first.' });

  const [existing] = await req.db.execute('SELECT merchant_id FROM merchants WHERE phone = ?', [phone]);
  if (existing.length > 0) return res.status(409).json({ error: 'Phone already registered' });
  const mid = 'MER' + Date.now().toString(36).toUpperCase();
  await req.db.execute('INSERT INTO merchants (merchant_id, business_name, phone, email) VALUES (?, ?, ?, ?)', [mid, business_name, phone, email || null]);

  const code = Math.floor(1000 + Math.random() * 9000).toString();
  const sid = crypto.randomBytes(32).toString('hex');
  await req.db.execute('INSERT INTO otp_sessions (session_id, phone, code, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))', [sid, phone, code]);
  if (process.env.NODE_ENV !== 'production') console.log('=== OTP for merchant', phone, ':', code, '===');
  res.json({ merchant_id: mid, session_id: sid, message: 'Registered. OTP sent.' });
});

// POST /api/merchants/request-otp
router.post('/request-otp', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone required' });
  const [merchant] = await req.db.execute('SELECT merchant_id FROM merchants WHERE phone = ?', [phone]);
  if (merchant.length === 0) return res.status(404).json({ error: 'Merchant not found. Register first.' });
  const code = Math.floor(1000 + Math.random() * 9000).toString();
  const sid = crypto.randomBytes(32).toString('hex');
  await req.db.execute('INSERT INTO otp_sessions (session_id, phone, code, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))', [sid, phone, code]);
  if (process.env.NODE_ENV !== 'production') console.log('=== OTP for merchant', phone, ':', code, '===');
  res.json({ session_id: sid, message: 'OTP sent' });
});

// POST /api/merchants/verify-otp
router.post('/verify-otp', async (req, res) => {
  const { session_id, code } = req.body;
  if (!session_id || !code) return res.status(400).json({ error: 'Missing session_id or code' });
  const [rows] = await req.db.execute('SELECT phone FROM otp_sessions WHERE session_id = ? AND code = ? AND expires_at > NOW() AND verified = FALSE', [session_id, code]);
  if (rows.length === 0) return res.status(401).json({ error: 'Invalid or expired code' });
  await req.db.execute('UPDATE otp_sessions SET verified = TRUE WHERE session_id = ?', [session_id]);
  const [m] = await req.db.execute('SELECT merchant_id, business_name FROM merchants WHERE phone = ?', [rows[0].phone]);
  res.json({ merchant_id: m[0].merchant_id, business_name: m[0].business_name, verified: true });
});

// GET /api/merchants/campaigns?merchant_id=X
router.get('/campaigns', async (req, res) => {
  const { merchant_id } = req.query;
  const [rows] = await req.db.execute(
    'SELECT ad_id, merchant_name AS business_name, merchant_phone, message, banner_image_url, target_link, status, start_date, end_date FROM marketplace_campaigns WHERE merchant_name IN (SELECT business_name FROM merchants WHERE merchant_id = ?) ORDER BY created_at DESC',
    [merchant_id]
  );
  res.json({ campaigns: rows });
});

// POST /api/merchants/campaigns
router.post('/campaigns', async (req, res) => {
  const { merchant_id, message, target_school_id, days } = req.body;
  if (!merchant_id || !message || !target_school_id || !days) return res.status(400).json({ error: 'Missing fields' });
  const [m] = await req.db.execute('SELECT business_name, phone FROM merchants WHERE merchant_id = ?', [merchant_id]);
  if (m.length === 0) return res.status(404).json({ error: 'Merchant not found' });
  // Limit duration to a maximum of 60 days (approximately 2 months)
  const duration = Math.min(Math.max(parseInt(days) || 7, 1), 60);
  const startDate = new Date().toISOString().slice(0, 10);
  const endDate = new Date(Date.now() + duration * 86400000).toISOString().slice(0, 10);

  const [result] = await req.db.execute(
    'INSERT INTO marketplace_campaigns (target_school_id, merchant_name, merchant_phone, message, banner_image_url, target_link, status, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [target_school_id, m[0].business_name, m[0].phone || null, message, '', '#', 'Active', startDate, endDate]
  );
  const campaignId = result.insertId;

  res.json({ message: 'Campaign created', campaign_id: campaignId, days: duration });
});

// GET /api/merchants/schools — list schools for targeting
router.get('/schools', async (req, res) => {
  const [rows] = await req.db.execute('SELECT school_id, school_name, region FROM schools ORDER BY school_name');
  res.json({ schools: rows });
});

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
router.get('/market/products', async (req, res) => {
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
});

// POST /api/merchants/products — merchant adds a listing
router.post('/products', async (req, res) => {
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
});

// GET /api/merchants/products?merchant_id=X — merchant's own listings
router.get('/products', async (req, res) => {
  await ensureMarketTables(req.db);
  const { merchant_id } = req.query;
  if (!merchant_id) return res.status(400).json({ error: 'merchant_id required' });
  const [rows] = await req.db.execute(
    'SELECT product_id, name, description, category, price, active, created_at FROM products WHERE merchant_id = ? ORDER BY created_at DESC',
    [merchant_id]
  );
  res.json({ products: rows });
});

// POST /api/merchants/products/deactivate — merchant hides a listing
router.post('/products/deactivate', async (req, res) => {
  await ensureMarketTables(req.db);
  const { merchant_id, product_id } = req.body;
  if (!merchant_id || !product_id) return res.status(400).json({ error: 'Missing fields' });
  const [r] = await req.db.execute('UPDATE products SET active = FALSE WHERE product_id = ? AND merchant_id = ?', [product_id, merchant_id]);
  if (r.affectedRows === 0) return res.status(404).json({ error: 'Product not found' });
  res.json({ message: 'Listing hidden' });
});

module.exports = router;
