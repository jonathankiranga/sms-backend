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

// Email OTP support — uses Nodemailer with any SMTP server (Gmail, Outlook, custom)
// Configure via env vars: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
async function sendEmailOtp(email, code) {
  const nodemailer = require('nodemailer');

  const host     = process.env.SMTP_HOST;
  const port     = parseInt(process.env.SMTP_PORT || '587');
  const user     = process.env.SMTP_USER;
  const pass     = process.env.SMTP_PASS;
  const from     = process.env.SMTP_FROM || user;
  const fromName = process.env.SMTP_FROM_NAME || 'FreeSchool';

  // Dev fallback — no SMTP configured
  if (!host || !user || !pass) {
    console.log(`[EMAIL OTP] SMTP not configured — To: ${email} | Code: ${code}`);
    return { provider: 'log', status: 'logged' };
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,          // true for 465 (SSL), false for 587 (STARTTLS)
    auth: { user, pass },
    tls: { rejectUnauthorized: false }  // allow self-signed certs on custom mail servers
  });

  try {
    await transporter.sendMail({
      from: `"${fromName}" <${from}>`,
      to: email,
      subject: 'Your FreeSchool Login Code',
      text: `Your FreeSchool login code is: ${code}\n\nThis code expires in 5 minutes.`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:400px;margin:0 auto;padding:24px">
          <h2 style="color:#7B4F9B;margin-bottom:8px">FreeSchool Login</h2>
          <p style="color:#555;margin-bottom:24px">Your one-time login code is:</p>
          <div style="background:#F3E5F5;border-radius:8px;padding:20px;text-align:center;margin-bottom:24px">
            <span style="font-size:36px;font-weight:bold;color:#7B4F9B;letter-spacing:8px">${code}</span>
          </div>
          <p style="color:#888;font-size:12px">This code expires in 5 minutes. Do not share it with anyone.</p>
        </div>
      `
    });
    console.log(`[EMAIL] OTP sent to ${email} via ${host}`);
    return { provider: 'smtp', status: 'sent' };
  } catch (err) {
    console.error(`[EMAIL] SMTP send failed for ${email}: ${err.message}`);
    throw err;
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
