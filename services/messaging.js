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

// OTP sending: Africa's Talking SMS for phone OTP delivery. Falls back to WhatsApp template or console log.
async function sendOtp(phone, code) {
  const msg = process.env.OTP_SMS_TEMPLATE || `Your Education APP verification code is ${code}. Valid for 5 minutes.`;
  // If AT credentials exist, send via Africa's Talking SMS
  if (process.env.AT_API_KEY && process.env.AT_USERNAME) {
    return await sendSms(phone, msg, 'africastalking');
  }
  // If Meta WhatsApp configured, fallback to WhatsApp template
  if (process.env.META_ACCESS_TOKEN && process.env.PHONE_NUMBER_ID) {
    try {
      const result = await sendTemplate(phone, process.env.WHATSAPP_TEMPLATE_OTP || 'otp_verification', [code]);
      return result;
    } catch (e) {
      console.error('[OTP] WhatsApp fallback failed:', e.message);
    }
  }
  // last resort: log the OTP for local dev/testing
  console.log(`[OTP][DEV] To ${phone}: ${code}`);
  return { provider: 'log', status: 'logged', phone, code };
}

// Email OTP support — sends via Resend HTTP API (SMTP is blocked on Render).
// Requires RESEND_API_KEY env var. Falls back to console log for local dev.
async function sendEmailOtp(email, code) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'cbcSchool App <noreply@smarternowapps.co.ke>';

  if (!apiKey) {
    console.log(`[EMAIL][DEV] To ${email}: Your verification code is ${code}`);
    return { provider: 'log', status: 'logged' };
  }

  try {
    const resp = await axios.post(
      'https://api.resend.com/emails',
      {
        from,
        to: [email],
        subject: 'Your Education APP verification code',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;">
            <h2 style="color:#7B4F9B;">Education APP</h2>
            <p>Your verification code is:</p>
            <p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#333;">${code}</p>
            <p style="color:#777;">This code is valid for 5 minutes. Do not share it with anyone.</p>
            <p style="font-size:12px;color:#aaa;">Powered by Smarternow Data Venture</p>
          </div>
        `
      },
      { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 15000 }
    );
    console.log(`[EMAIL] OTP sent to ${email}: ${resp.data?.id || 'ok'}`);
    return { provider: 'resend', status: 'sent', id: resp.data?.id };
  } catch (err) {
    const detail = err.response?.data?.message || err.message;
    console.error(`[EMAIL] Resend failed for ${email}: ${detail}`);
    console.log(`[EMAIL][DEV] To ${email}: Your verification code is ${code}`);
    return { provider: 'resend', status: 'failed', error: detail };
  }
}

// Send the accepted Terms & Conditions copy to the headteacher, with a CC to the platform.
// Uses Resend (SMTP is blocked on Render). Falls back to console log for local dev.
async function sendTermsAcceptanceEmail({ to, cc, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'cbcSchool App <noreply@smarternowapps.co.ke>';

  if (!apiKey) {
    console.log('[EMAIL][DEV] To', to, 'CC', cc || '(none)', '| Subject:', subject);
    if (text) console.log(text.slice(0, 500));
    return { provider: 'log', status: 'logged' };
  }

  try {
    const payload = { from, to: [to], subject };
    if (cc) payload.cc = Array.isArray(cc) ? cc : [cc];
    if (html) payload.html = html;
    if (text) payload.text = text;

    const resp = await axios.post('https://api.resend.com/emails', payload, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 15000
    });
    console.log(`[EMAIL] Terms copy sent to ${to} (cc: ${cc || 'none'}): ${resp.data?.id || 'ok'}`);
    return { provider: 'resend', status: 'sent', id: resp.data?.id };
  } catch (err) {
    const detail = err.response?.data?.message || err.message;
    console.error(`[EMAIL] Resend failed for terms copy to ${to}: ${detail}`);
    return { provider: 'resend', status: 'failed', error: detail };
  }
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

// SMS delivery via Africa's Talking (or log fallback)
async function sendSms(phone, message, providerOverride) {
  const provider = providerOverride || process.env.SMS_PROVIDER || 'africastalking';
  const apiKey = process.env.AT_API_KEY;
  const username = process.env.AT_USERNAME || 'sandbox';
  const senderId = process.env.AT_SENDER_ID;

  // Format phone to E.164 (e.g. +254712345678)
  let formattedPhone = (phone || '').toString().trim().replace(/\s+/g, '');
  if (formattedPhone.startsWith('0')) {
    formattedPhone = '+254' + formattedPhone.slice(1);
  } else if (!formattedPhone.startsWith('+')) {
    formattedPhone = '+' + formattedPhone;
  }

  if (provider === 'log' || !apiKey) {
    console.log(`[SMS][AT-MOCK] To ${formattedPhone}: ${message}`);
    return { provider: 'log', status: 'logged', phone: formattedPhone, message };
  }

  if (provider === 'africastalking') {
    const isSandbox = username.toLowerCase() === 'sandbox';
    const url = isSandbox
      ? 'https://api.sandbox.africastalking.com/version1/messaging'
      : 'https://api.africastalking.com/version1/messaging';

    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('to', formattedPhone);
    formData.append('message', message);
    if (senderId && !isSandbox) {
      formData.append('from', senderId);
    }

    try {
      const resp = await axios.post(url, formData.toString(), {
        headers: {
          'ApiKey': apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        timeout: 10000
      });

      const recipientStatus = resp.data?.SMSMessageData?.Recipients?.[0]?.status;
      console.log(`[SMS][AT] Sent to ${formattedPhone}: ${recipientStatus || 'Success'}`);
      return resp.data;
    } catch (err) {
      const detail = err.response?.data?.SMSMessageData?.Message || err.response?.data || err.message;
      console.error(`[SMS][AT] Failed to send to ${formattedPhone}:`, detail);
      return { error: detail };
    }
  }
  return { provider: 'none', status: 'unsupported' };
}

module.exports = {
  sendAbsenceAlert, sendOtp, sendTemplate, sendSms, sendEmailOtp,
  sendAssessmentAlert, sendFeeReminder,
  sendConsecutiveAbsenceAlert, sendBroadcast, sendTermsAcceptanceEmail
};
