function getBaseUrl(env) {
  return env === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
}

async function getAccessToken(consumerKey, consumerSecret, env) {
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const resp = await fetch(`${getBaseUrl(env)}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
    signal: AbortSignal.timeout(15000)
  });
  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`M-Pesa OAuth invalid response (${resp.status}): ${text || 'Empty response'}`);
  }
  if (!data?.access_token) {
    throw new Error(data?.errorMessage || data?.error_description || `Failed to acquire M-Pesa access token (${resp.status})`);
  }
  return data.access_token;
}

// STK push uses the vendor's global M-Pesa credentials from env vars.
// If credentials are not set, it gracefully falls back to a simulated dev response.
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

  // In production, missing credentials are a hard error — never simulate success
  const isProduction = process.env.NODE_ENV === 'production' || env === 'production';
  if (!consumerKey || !consumerSecret || !shortcode || !passkey) {
    if (isProduction) {
      throw new Error('[MPESA] Missing M-Pesa credentials in production (MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY required)');
    }
    // Dev/sandbox fallback — simulates a successful STK push locally
    const mockCheckoutId = `ws_CO_DEV_MOCK_${Date.now()}`;
    console.log(`[MPESA][DEV-MOCK] STK push simulated for ${phone} | Amount: KSh ${amount} | Ref: ${reference} | CheckoutID: ${mockCheckoutId}`);
    return {
      MerchantRequestID: 'DEV_MOCK_REQ_' + Date.now(),
      CheckoutRequestID: mockCheckoutId,
      ResponseCode: '0',
      ResponseDescription: 'Success. Request accepted for processing (Simulated Dev Mode)',
      CustomerMessage: `Success. M-Pesa STK push simulated for KSh ${amount}`
    };
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
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerBuyGoodsOnline',
      Amount: Math.round(amount),
      PartyA: cleanPhone,
      PartyB: shortcode,
      PhoneNumber: cleanPhone,
      CallBackURL: callbackUrl,
      AccountReference: reference,
      TransactionDesc: description || 'Education APP'
    })
  });
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return { ResponseCode: '1', errorMessage: text || 'Invalid JSON response from M-Pesa' };
  }
}

async function stkPushQuery(checkoutRequestId) {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  const passkey = process.env.MPESA_PASSKEY;
  const shortcode = process.env.MPESA_SHORTCODE;
  const env = process.env.MPESA_ENV || 'sandbox';

  const isProduction = process.env.NODE_ENV === 'production' || env === 'production';
  if (!consumerKey || !consumerSecret || !shortcode || !passkey) {
    if (isProduction) {
      throw new Error('[MPESA] Missing M-Pesa credentials in production — cannot query STK status');
    }
    console.log(`[MPESA][DEV-MOCK] STK query simulated for ${checkoutRequestId}`);
    return {
      ResponseCode: '0',
      ResponseDescription: 'The service request has been accepted successfully (Simulated Dev Mode)',
      MerchantRequestID: 'DEV_MOCK_REQ_' + Date.now(),
      CheckoutRequestID: checkoutRequestId || 'ws_CO_DEV_MOCK',
      ResultCode: '0',
      ResultDesc: 'The service request is processed successfully (Simulated Dev Mode)'
    };
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

  const resp = await fetch(`${getBaseUrl(env)}/mpesa/stkpushquery/v1/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId
    })
  });
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return { ResultCode: '1', ResultDesc: text || 'Invalid JSON response from M-Pesa' };
  }
}

// C2B URL registration also uses the vendor's global M-Pesa credentials.
async function registerC2BUrls(validationUrl, confirmationUrl) {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  const shortcode = process.env.MPESA_SHORTCODE;
  const env = process.env.MPESA_ENV || 'sandbox';

  const isProduction = process.env.NODE_ENV === 'production' || env === 'production';
  if (!consumerKey || !consumerSecret || !shortcode) {
    if (isProduction) {
      throw new Error('[MPESA] Missing M-Pesa credentials in production — cannot register C2B URLs');
    }
    console.log(`[MPESA][DEV-MOCK] C2B URLs registered (Simulated Dev Mode): ${validationUrl}`);
    return {
      OriginatorCoversationID: 'DEV_MOCK_CONV_' + Date.now(),
      ResponseCode: '0',
      ResponseDescription: 'C2B URLs registered successfully (Simulated Dev Mode)'
    };
  }

  const token = await getAccessToken(consumerKey, consumerSecret, env);
  const resp = await fetch(`${getBaseUrl(env)}/mpesa/c2b/v2/register`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      ShortCode: shortcode,
      ResponseType: 'Completed',
      ConfirmationURL: confirmationUrl,
      ValidationURL: validationUrl
    })
  });
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return { ResponseCode: '1', ResponseDescription: text || 'Invalid JSON response from M-Pesa' };
  }
}

module.exports = { getAccessToken, stkPush, stkPushQuery, registerC2BUrls };


