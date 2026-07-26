const express = require('express');
const path = require('path');
const axios = require('axios');
const router = express.Router();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'jonathankiranga@gmail.com';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'admin', 'admin.html'));
});

// Legacy password login (simple admin password via x-admin-key)
router.post('/login', express.json(), (req, res) => {
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
  if (req.body.password && req.body.password === ADMIN_PASSWORD) {
    return res.json({ token: 'authenticated' });
  }

  // If an id_token is provided and GOOGLE_CLIENT_* configured, verify it
  if (req.body.id_token && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
    const idToken = req.body.id_token;
    axios.get('https://oauth2.googleapis.com/tokeninfo', { params: { id_token: idToken } })
      .then(r => {
        const email = r.data.email;
        const verified = r.data.email_verified === 'true' || r.data.email_verified === true;
        if (verified && email && email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
          return res.json({ token: 'authenticated', email });
        }
        return res.status(401).json({ error: 'Google account not authorized' });
      }).catch(err => {
        console.error('Google token verification failed:', err.message);
        res.status(401).json({ error: 'Invalid Google token' });
      });
    return;
  }

  res.status(401).json({ error: 'Invalid credentials' });
});

// Start OAuth flow: if GOOGLE client configured, redirect to Google; otherwise redirect to dev-mode auto-login
router.get('/auth/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    // No secrets configured — use development fallback that auto-authenticates default admin
    return res.redirect(`/admin/auth/google/dev`);
  }
  const redirectUri = `${req.protocol}://${req.get('host')}/admin/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    response_type: 'code',
    scope: 'openid email profile',
    redirect_uri: redirectUri,
    prompt: 'select_account'
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

// Development fallback: immediately redirect back to admin UI with default admin email
// This endpoint is intentionally restricted in production. Set ALLOW_DEV_FALLBACK=true to permit in non-local environments.
router.get('/auth/google/dev', (req, res) => {
  if (process.env.NODE_ENV === 'production' && (process.env.ALLOW_DEV_FALLBACK || '').toLowerCase() !== 'true') {
    return res.status(403).send('Dev fallback disabled in production');
  }
  // WARNING: dev fallback — ONLY for local/dev usage. This does not authenticate with Google.
  return res.redirect(`/admin?admin_email=${encodeURIComponent(ADMIN_EMAIL)}&dev=1`);
});

// OAuth callback - only functional when GOOGLE_CLIENT_ID/SECRET are configured
router.get('/auth/google/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.redirect('/admin?error=missing_code');
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return res.redirect('/admin?error=oauth_not_configured');
  const redirectUri = `${req.protocol}://${req.get('host')}/admin/auth/google/callback`;
  try {
    const tokenResp = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

    const accessToken = tokenResp.data.access_token;
    // fetch userinfo
    const userInfo = await axios.get('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
    const email = userInfo.data.email;
    const emailVerified = userInfo.data.email_verified;
    if (emailVerified && email && email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
      // Successful — redirect back to admin UI with admin_email param
      return res.redirect(`/admin?admin_email=${encodeURIComponent(email)}`);
    }
    return res.redirect('/admin?error=unauthorized');
  } catch (err) {
    console.error('Google OAuth callback error:', err.message);
    return res.redirect('/admin?error=oauth_failed');
  }
});

module.exports = router;
