const axios = require('axios');

const META_API_VERSION = 'v22.0';
const BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

function getConfig() {
  return {
    token: process.env.META_ACCESS_TOKEN,
    phoneNumberId: process.env.PHONE_NUMBER_ID
  };
}

async function sendTemplate(to, templateName, params) {
  const { token, phoneNumberId } = getConfig();
  if (!token || !phoneNumberId) {
    console.warn('[WHATSAPP] META_ACCESS_TOKEN or PHONE_NUMBER_ID not set — skipping send');
    return;
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: to.replace('+', ''),
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'en' },
      components: [{
        type: 'body',
        parameters: params.map(p => ({ type: 'text', text: p }))
      }]
    }
  };

  try {
    const resp = await axios.post(`${BASE_URL}/${phoneNumberId}/messages`, payload, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log(`[WHATSAPP] ${templateName} sent to ${to}: ${resp.data.messages?.[0]?.id}`);
    return resp.data;
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.message;
    console.error(`[WHATSAPP] Failed to send ${templateName} to ${to}: ${detail}`);
    throw err;
  }
}

async function sendAbsenceAlert(parentPhone, studentName, schoolName, date) {
  return sendTemplate(parentPhone, process.env.WHATSAPP_TEMPLATE_ABSENCE || 'absence_alert', [
    studentName, schoolName, date
  ]);
}

async function sendOtp(phone, code) {
  return sendTemplate(phone, process.env.WHATSAPP_TEMPLATE_OTP || 'otp_verification', [code]);
}

module.exports = { sendAbsenceAlert, sendOtp, sendTemplate };
