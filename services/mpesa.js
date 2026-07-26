const https = require('https');

function getBaseUrl(env) {
  return env === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
}

async function getAccessToken(consumerKey, consumerSecret, env) {
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const resp = await fetch(`${getBaseUrl(env)}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` }
  });
  const data = await resp.json();
  return data.access_token;
}

async function stkPush(phone, amount, reference, description, schoolCreds) {
  const consumerKey = schoolCreds?.mpesa_consumer_key || process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = schoolCreds?.mpesa_consumer_secret || process.env.MPESA_CONSUMER_SECRET;
  const passkey = schoolCreds?.mpesa_passkey || process.env.MPESA_PASSKEY;
  const shortcode = schoolCreds?.mpesa_paybill || process.env.MPESA_SHORTCODE;
  const env = schoolCreds?.mpesa_environment || process.env.MPESA_ENV || 'sandbox';
  const schoolId = schoolCreds?.school_id || 'default';

  const token = await getAccessToken(consumerKey, consumerSecret, env);
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const timestamp = `${year}${month}${day}${hours}${minutes}${seconds}`;
  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

  const cleanPhone = phone.replace(/^0+/, '254').replace(/^\+/, '');
  const baseUrl = process.env.BASE_URL || 'https://sms-backend-r0tn.onrender.com';
  const callbackUrl = `${baseUrl}/v1/payments/${schoolId}/callback`;

  const resp = await fetch(`${getBaseUrl(env)}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      PartyA: cleanPhone,
      PartyB: shortcode,
      PhoneNumber: cleanPhone,
      CallBackURL: callbackUrl,
      AccountReference: reference,
      TransactionDesc: description || 'Education APP'
    })
  });
  return resp.json();
}

async function stkPushQuery(checkoutRequestId, schoolCreds) {
  const consumerKey = schoolCreds?.mpesa_consumer_key || process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = schoolCreds?.mpesa_consumer_secret || process.env.MPESA_CONSUMER_SECRET;
  const passkey = schoolCreds?.mpesa_passkey || process.env.MPESA_PASSKEY;
  const shortcode = schoolCreds?.mpesa_paybill || process.env.MPESA_SHORTCODE;
  const env = schoolCreds?.mpesa_environment || process.env.MPESA_ENV || 'sandbox';

  const token = await getAccessToken(consumerKey, consumerSecret, env);
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const timestamp = `${year}${month}${day}${hours}${minutes}${seconds}`;
  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

  const resp = await fetch(`${getBaseUrl(env)}/mpesa/stkpushquery/v1/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId
    })
  });
  return resp.json();
}

async function registerC2BUrls(validationUrl, confirmationUrl, schoolCreds) {
  const consumerKey = schoolCreds?.mpesa_consumer_key || process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = schoolCreds?.mpesa_consumer_secret || process.env.MPESA_CONSUMER_SECRET;
  const shortcode = schoolCreds?.mpesa_paybill || process.env.MPESA_SHORTCODE;
  const env = schoolCreds?.mpesa_environment || process.env.MPESA_ENV || 'sandbox';

  const token = await getAccessToken(consumerKey, consumerSecret, env);
  const resp = await fetch(`${getBaseUrl(env)}/mpesa/c2b/v2/register`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ShortCode: shortcode,
      ResponseType: 'Completed',
      ConfirmationURL: confirmationUrl,
      ValidationURL: validationUrl
    })
  });
  return resp.json();
}

module.exports = { getAccessToken, stkPush, stkPushQuery, registerC2BUrls };
