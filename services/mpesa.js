const https = require('https');

const MPESA_CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY || '';
const MPESA_CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET || '';
const MPESA_PASSKEY = process.env.MPESA_PASSKEY || '';
const MPESA_SHORTCODE = process.env.MPESA_SHORTCODE || '';
const MPESA_ENV = process.env.MPESA_ENV || 'sandbox';

function getBaseUrl() {
  return MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
}

async function getAccessToken() {
  const auth = Buffer.from(`${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`).toString('base64');
  const resp = await fetch(`${getBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` }
  });
  const data = await resp.json();
  return data.access_token;
}

async function registerC2BUrls(validationUrl, confirmationUrl) {
  const token = await getAccessToken();
  const resp = await fetch(`${getBaseUrl()}/mpesa/c2b/v2/register`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ShortCode: MPESA_SHORTCODE,
      ResponseType: 'Completed',
      ConfirmationURL: confirmationUrl,
      ValidationURL: validationUrl
    })
  });
  return resp.json();
}

module.exports = { getAccessToken, registerC2BUrls };
