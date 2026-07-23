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
  console.log('=== OTP for merchant', phone, ':', code, '===');
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
  console.log('=== OTP for merchant', phone, ':', code, '===');
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
    'SELECT ad_id, merchant_name AS business_name, message, banner_image_url, target_link, status, start_date, end_date FROM marketplace_campaigns WHERE merchant_name IN (SELECT business_name FROM merchants WHERE merchant_id = ?) ORDER BY created_at DESC',
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
  const duration = Math.min(Math.max(parseInt(days) || 7, 1), 90);
  const startDate = new Date().toISOString().slice(0, 10);
  const endDate = new Date(Date.now() + duration * 86400000).toISOString().slice(0, 10);
  // Get campaign price from settings
  const [setting] = await req.db.execute("SELECT setting_value FROM app_settings WHERE setting_key = ?", ['merchant_' + duration + '_day']);
  const price = parseInt(setting[0]?.setting_value || '0');

  // If M-Pesa is configured and price > 0, create as Pending (requires payment)
  const status = (process.env.MPESA_CONSUMER_KEY && price > 0) ? 'Pending' : 'Active';

  const [result] = await req.db.execute(
    'INSERT INTO marketplace_campaigns (target_school_id, merchant_name, message, banner_image_url, target_link, status, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [target_school_id, m[0].business_name, message, '', '#', status, startDate, endDate]
  );
  const campaignId = result.insertId;

  // If payment required, initiate STK push
  if (status === 'Pending') {
    try {
      const mpesa = require('../services/mpesa');
      const txnRef = 'CAM' + campaignId;
      const pushResult = await mpesa.stkPush(m[0].phone || req.body.phone, price, txnRef, 'Education APP Advert');
      if (pushResult.ResponseCode === '0') {
        return res.json({ message: 'Campaign created. Pay via M-Pesa to activate.', campaign_id: campaignId, checkout_request_id: pushResult.CheckoutRequestID, amount: price, status: 'pending' });
      }
    } catch (err) {
      console.error('[MERCHANT] STK push failed:', err.message);
    }
    return res.json({ message: 'Campaign created. Payment required to activate.', campaign_id: campaignId, amount: price, status: 'pending' });
  }

  res.json({ message: 'Campaign created', campaign_id: campaignId, days: duration });
});

// GET /api/merchants/schools — list schools for targeting
router.get('/schools', async (req, res) => {
  const [rows] = await req.db.execute('SELECT school_id, school_name, region FROM schools ORDER BY school_name');
  res.json({ schools: rows });
});

module.exports = router;
