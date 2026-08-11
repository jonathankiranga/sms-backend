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

// STK push always uses the vendor's global M-Pesa credentials from env vars.
// A callbackKey can be passed so the resulting STK push callback routes to a school-specific notification handler.
async function stkPush(phone, amount, reference, description, options = {}) {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  const passkey = process.env.MPESA_PASSKEY;
  const shortcode = process.env.MPESA_SHORTCODE;
  const env = process.env.MPESA_ENV || 'sandbox';
  const callbackKey = options.callbackKey;
  const baseUrl = process.env.BASE_URL || 'https://sms-backend-r0tn.onrender.com';
  let callbackUrl = `${baseUrl}/v1/payments/callback`;
  if (callbackKey) {
    callbackUrl = `${baseUrl}/v1/payments/secret/${callbackKey}/s`;
  }

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

  const resp = await fetch(`${getBaseUrl(env)}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: {
      Authorization: Bearer ,
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

async function stkPushQuery(checkoutRequestId) {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  const passkey = process.env.MPESA_PASSKEY;
  const shortcode = process.env.MPESA_SHORTCODE;
  const env = process.env.MPESA_ENV || 'sandbox';

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
      Authorization: Bearer ,
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

// C2B URL registration also uses the vendor's global M-Pesa credentials.
async function registerC2BUrls(validationUrl, confirmationUrl) {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  const shortcode = process.env.MPESA_SHORTCODE;
  const env = process.env.MPESA_ENV || 'sandbox';

  const token = await getAccessToken(consumerKey, consumerSecret, env);
  const resp = await fetch(`${getBaseUrl(env)}/mpesa/c2b/v2/register`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Authorization: Bearer ,
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


