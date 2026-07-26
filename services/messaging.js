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

// OTP sending: prefer Africa's Talking SMS for OTP delivery. Falls back to WhatsApp template if configured and AT not set, or to logging in dev.
async function sendOtp(phone, code) {
  const msg = process.env.OTP_SMS_TEMPLATE || `Your verification code is ${code}`;
  // If AT credentials exist, use africastalking via sendSms override
  if (process.env.AT_API_KEY && process.env.AT_USERNAME) {
    return await sendSms(phone, msg, 'africastalking');
  }
  // If Meta WhatsApp configured, use WhatsApp template as fallback
  if (process.env.META_ACCESS_TOKEN && process.env.PHONE_NUMBER_ID) {
    try {
      const result = await sendTemplate(phone, process.env.WHATSAPP_TEMPLATE_OTP || 'otp_verification', [code]);
      return result;
    } catch (e) {
      console.error('[OTP] WhatsApp send failed, falling back to log:', e.message);
    }
  }
  // last resort: log the OTP
  console.log(`[OTP] To ${phone}: ${code}`);
  return { provider: 'log', status: 'logged' };
}

// Email OTP support — simple fallback logger. If you configure EMAIL_PROVIDER and implement sending logic, replace this.
async function sendEmailOtp(email, code) {
  const provider = process.env.EMAIL_PROVIDER || 'log';
  if (provider === 'log') {
    console.log(`[EMAIL] To ${email}: Your verification code is ${code}`);
    return { provider: 'log', status: 'logged' };
  }
  // Placeholder: implement real email sending (SMTP, SendGrid, SES...) if desired.
  console.warn('[EMAIL] sendEmailOtp called but no provider implemented; set EMAIL_PROVIDER and add implementation.');
  return { provider: 'none' };
}

async function sendAssessmentAlert(parentPhone, studentName, subject, score, level) {
  return sendTemplate(parentPhone, process.env.WHATSAPP_TEMPLATE_ASSESSMENT || 'assessment_result', [
    studentName, subject, score.toString(), level
  ]);
}

async function sendFeeReminder(parentPhone, studentName, amount, balance) {
  return sendTemplate(parentPhone, process.env.WHATSAPP_TEMPLATE_FEE || 'fee_reminder', [
    studentName, amount, balance
  ]);
}

async function sendConsecutiveAbsenceAlert(parentPhone, studentName, consecutiveDays, schoolName) {
  return sendTemplate(parentPhone, process.env.WHATSAPP_TEMPLATE_CONSEC_ABSENCE || 'consecutive_absence', [
    studentName, consecutiveDays.toString(), schoolName
  ]);
}

async function sendBroadcast(parentPhone, schoolName, message) {
  return sendTemplate(parentPhone, process.env.WHATSAPP_TEMPLATE_BROADCAST || 'school_broadcast', [
    schoolName, message
  ]);
}

// SMS fallback — used when WhatsApp fails
async function sendSms(phone, message, providerOverride) {
  const provider = providerOverride || process.env.SMS_PROVIDER || 'log';
  if (provider === 'log') {
    console.log(`[SMS] To ${phone}: ${message}`);
    return { provider: 'log', status: 'logged' };
  }
  if (provider === 'africastalking') {
    try {
      const resp = await axios.post('https://api.africastalking.com/version1/messaging', null, {
        params: {
          username: process.env.AT_USERNAME || 'sandbox',
          to: phone,
          message: message,
          from: process.env.AT_SENDER_ID || ''
        },
        headers: { 'ApiKey': process.env.AT_API_KEY || '', 'Accept': 'application/json' }
      });
      console.log(`[SMS] Sent to ${phone}: ${resp.data?.SMSMessageData?.Recipients?.[0]?.status}`);
      return resp.data;
    } catch (err) {
      console.error(`[SMS] Failed to send to ${phone}: ${err.message}`);
      return { error: err.message };
    }
  }
  return { provider: 'none', status: 'unsupported' };
}

module.exports = {
  sendAbsenceAlert, sendOtp, sendTemplate, sendSms, sendEmailOtp,
  sendAssessmentAlert, sendFeeReminder,
  sendConsecutiveAbsenceAlert, sendBroadcast
};
