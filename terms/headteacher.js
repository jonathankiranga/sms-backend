// Headteacher Terms & Conditions content.
// Single source of truth for the in-app T&C and the emailed copy.
// Combines website general terms with headteacher-specific requirements.
// VERSION is a document label for code updates only — acceptance is
// recorded once per headteacher and is never asked again.

const TERMS = {
  version: '2026.3',
  effective_date: '2026-09-10',
  environment: 'cbcschool.app',
  company_name: 'Smarternow Data Venture',
  product_name: 'cbcSchool App (FreeSchool Platform)',
  support_email: 'jonathankiranga@gmail.com',
  sections: [
    {
      id: 'acceptance',
      heading: '1. Acceptance of Terms',
      body: `By accessing or using the ${'{{PRODUCT}}'} Headteacher Portal ("the Platform"), you agree to be bound by these Terms of Service ("Terms"). If you disagree with any part, you may not use the Platform. Access to the Headteacher Portal is conditional on your positive acceptance of these Terms. You will not be able to log in until you have acknowledged that you have read and accepted these Terms.`
    },
    {
      id: 'authority',
      heading: '2. Authority to Bind the School',
      body: `By accepting these Terms you warrant that you have the full authority of your school's management to accept these Terms, to manage the school's account, and to bind the school to the obligations set out in these Terms. ${'{{COMPANY}}'} relies on this warranty in granting the school access to the Platform.`
    },
    {
      id: 'description',
      heading: '3. Description of Service',
      body: `${'{{PRODUCT}}'} is a free, offline-first Progressive Web App (PWA) for Kenyan schools providing: digital attendance tracking, CBC report card generation, M-Pesa fee collection via STK Push, WhatsApp parent notifications, staff management, student rosters, exam sessions, and portals for teachers, parents, headteachers, and a school marketplace. The Service is provided "as is" and "as available."`,
    },
    {
      id: 'eligibility',
      heading: '4. Eligibility',
      body: `• Schools must be registered educational institutions in Kenya\n• The Headteacher must be at least 18 years old\n• Teachers and staff must be at least 18 years old\n• Parents paying subscriptions must have a valid M-Pesa account`
    },
    {
      id: 'account',
      heading: '5. Account Security & Access Control',
      body: `Schools register via a headteacher; a unique school ID is issued. Teachers and headteachers log in via phone OTP (no passwords required). Parents access the portal via phone OTP; no app install required. You are responsible for keeping your phone number secure. Unauthorised access attempts will result in account suspension. You must not share credentials, must promptly deactivate the accounts of staff who no longer require access, and must notify us immediately of any suspected unauthorised use.`
    },
    {
      id: 'data',
      heading: '6. School Data Ownership & Confidentiality',
      body: `All data entered into the Platform belongs to the school. We do not sell, rent, or share school data with any third party. Data is stored on encrypted servers with continuous backup. The School Head may export all school data at any time (CSV/PDF format). Reports are retained for a minimum of five (5) years. We process personal data in accordance with the Kenya Data Protection Act, 2019. Attendance and assessment data are stored locally (IndexedDB) when offline and auto-sync via Background Sync API when connectivity returns. We are not liable for data loss if a device is lost before sync occurs.`
    },
    {
      id: 'records',
      heading: '7. Accuracy of Records',
      body: `You are responsible for ensuring that school, teacher, and student records entered into the Platform are accurate and current. You must promptly update the enrolment status of students and the access rights of staff. Automated reports, parent alerts, and fee records rely on the accuracy of the underlying data.`
    },
    {
      id: 'pricing',
      heading: '8. Pricing & Payments',
      body: `The Platform is provided free of charge to schools, teachers, and headteachers. There is no setup fee, no monthly subscription, and no lock-in contract. The school's obligations under these Terms do not include any payment to ${'{{COMPANY}}'}.`
    },
    {
      id: 'subscription',
      heading: '9. Parent Subscription Programme',
      body: `The school operates a Parent Subscription programme. This programme is provided to the school as a mandated service: the school requires each parent or guardian to subscribe for their child at a charge of KSh 100 per child per term. The subscription charge is paid directly by the parent or guardian via M-Pesa STK Push. The school does not collect the charge and does not owe the charge; parents subscribe directly to ${'{{COMPANY}}'} as the service provider. Subscription benefits include WhatsApp absence alerts, assessment result alerts, M-Pesa fee payment, downloadable PDF reports, and access to the school marketplace. The school may, at its discretion, pay for subscriptions on behalf of a parent. Payments are processed via M-Pesa STK Push. No refunds for partial terms; premium features activate on confirmed payment.`
    },
    {
      id: 'whatsapp',
      heading: '10. Parent Communication via WhatsApp',
      body: `The Platform sends parents WhatsApp notifications, including absence alerts, assessment result alerts, fee reminders, and school broadcasts, through the official Meta WhatsApp Business API using approved message templates. The school is responsible for ensuring it has the lawful basis, consent, and correct parent contact numbers required to communicate with parents through these channels.`
    },
    {
      id: 'fees',
      heading: '11. Fee Records & M-Pesa',
      body: `The Platform records school fees and payments, enabling the school to issue fee statements and reminders. Fee collection is configured and operated by the school. Where M-Pesa payment is used, transactions are processed through the official Safaricom Daraja API and reconciled automatically into the school's fee ledger. M-Pesa payments depend on Safaricom network availability.`
    },
    {
      id: 'third-party',
      heading: '12. Third-Party Services',
      body: `${'{{PRODUCT}}'} integrates with:\n• Safaricom Daraja API (M-Pesa) — subject to Safaricom terms\n• Meta WhatsApp Business API — subject to Meta terms\n• Africa's Talking (SMS OTP) — subject to their terms\n\nWe are not responsible for downtime, errors, or policy changes by these providers.`
    },
    {
      id: 'acceptable-use',
      heading: '13. Acceptable Use',
      body: `You agree not to misuse the Platform, including: reverse engineering, decompiling, or extracting source code; tampering with attendance, assessment, or fee records; entering false data; sharing login OTPs or impersonating other users; uploading malicious code, spam, or illegal content; attempting to access another school's data; using the Platform in a manner that breaches the Kenya Data Protection Act, 2019 or any other applicable law; or scraping, crawling, or bulk-extracting data without permission.`
    },
    {
      id: 'intellectual-property',
      heading: '14. Intellectual Property',
      body: `All rights, title, and interest in the Platform, its software, user interfaces, and related technology belong to ${'{{COMPANY}}'} and are protected by copyright and applicable law. School data (attendance, reports, fees) belongs to the school. Parents own their payment records. You grant us a licence to process data solely to provide the Service. Nothing in these Terms grants the school any ownership interest in the Platform beyond the right to use it in accordance with these Terms.`
    },
    {
      id: 'disclaimers',
      heading: '15. Disclaimers',
      body: `Except as expressly provided herein, we do not warrant that:\n• The Service will be uninterrupted, error-free, or fully secure\n• CBC report templates comply with all local or international law or regulations (schools must verify compliance)\n• WhatsApp delivery is guaranteed (depends on Meta's infrastructure)\n\nThe Service is provided "as is" and "as available."`,
    },
    {
      id: 'liability',
      heading: '16. Limitation of Liability',
      body: `To the maximum extent permitted by law, ${'{{COMPANY}}'} shall not be liable for any indirect, incidental, special, or consequential loss arising out of or in connection with these Terms or your use of the Platform, including loss of profits, data (except where negligently caused by us), or goodwill. Our total aggregate liability arising out of or in connection with these Terms shall not exceed 50% of the total amount paid by the school to us in the twelve (12) months preceding the event giving rise to the claim — which, given the service is free to schools, is limited to 50% of the aggregate of amounts paid by parents of the school during that period relating to the school's Parent Subscription programme.`
    },
    {
      id: 'indemnity',
      heading: '17. Indemnity',
      body: `You agree to indemnify and hold ${'{{COMPANY}}'} harmless against any claims, losses, or expenses arising from: (a) your breach of these Terms; (b) your wrongful use of the Platform; or (c) your failure to obtain required consents from parents or staff for the processing of their personal data.`
    },
    {
      id: 'availability',
      heading: '18. Availability, Offline Use & Support',
      body: `The Platform is designed to work offline on supported devices; data is synchronised automatically when connectivity is available. We use reasonable efforts to maintain service availability but do not guarantee uninterrupted access. Support is provided by email at ${'{{SUPPORT_EMAIL}}'}. Scheduled maintenance may cause temporary interruptions.`
    },
    {
      id: 'exit',
      heading: '19. Exit, Notice Period & Data Export',
      body: `Either party may exit this agreement by giving not less than ninety (90) days' written notice to the other party. During the notice period, the school retains full access to the Platform for the orderly migration of its records. On exit, the school must request the export of its data, and ${'{{COMPANY}}'} will provide the school's data in a structured, commonly used format within thirty (30) days of the export request. Following the exit date, school data is retained for a further six (6) months to allow for final retrieval, after which it is securely deleted in accordance with our data retention policy. The school may also export all data at any time during the term without limitation. Schools may close their account anytime; data purged within 30 days of account termination.`
    },
    {
      id: 'suspension',
      heading: '20. Suspension & Termination by Us',
      body: `We may suspend or terminate access to the Platform where the school or its headteacher breaches these Terms, engages in fraudulent or unlawful activity, or where continued provision of the service is no longer lawful. ${'{{COMPANY}}'} may also discontinue the Service with 90 days' notice. Where practicable, we will give the school notice and a reasonable opportunity to remedy a remediable breach before termination.`
    },
    {
      id: 'changes',
      heading: '21. Changes to These Terms',
      body: `These Terms may be updated from time to time; the current Terms are always available in the Headteacher Portal. We may update these Terms. Continued use after changes constitutes acceptance. Material changes will be notified via email or in-app banner.`
    },
    {
      id: 'law',
      heading: '22. Governing Law & Disputes',
      body: `These Terms are governed by the laws of the Republic of Kenya. Any dispute arising out of or in connection with these Terms shall first be referred to negotiation between the parties, and failing resolution, to the courts of Kenya.`
    },
    {
      id: 'contact',
      heading: '23. Contact',
      body: `Questions about these Terms may be sent to jonathankiranga@gmail.com or write to ${'{{COMPANY}}'}, Nairobi, Kenya.`
    }
  ]
};

// Renders the terms as a plain-text (email) body with the template placeholders replaced.
function renderText(replacements) {
  const pad = '   ';
  let out = '';
  out += `${TERMS.product_name}\n`;
  out += `Headteacher Terms & Conditions — v${TERMS.version}\n`;
  out += `Effective ${TERMS.effective_date}\n\n`;
  out += `This agreement is between the school (by its Headteacher) and ${TERMS.company_name}.\n`;
  out += `A parent subscription charge of KSh 100 per child per term applies to the Parent Subscription programme.\n`;
  out += `Exit from this agreement requires not less than 90 days' notice.\n\n`;
  for (const s of TERMS.sections) {
    out += `${s.heading}\n`;
    out += `${render(s.body, replacements).replace(/\n/g, `\n${pad}`)}\n\n`;
  }
  out += `${TERMS.company_name}\n`;
  out += `Established 2004 · ${replacements.ENV || TERMS.environment}\n`;
  return out;
}

// Renders the terms as HTML for the in-app display and the emailed copy.
function renderHtml(replacements) {
  const sections = TERMS.sections.map(s => `
    <div style="margin:0 0 18px 0;">
      <h3 style="margin:0 0 6px 0;font-size:15px;color:#7B4F9B;">${escapeHtml(s.heading)}</h3>
      <div style="font-size:13px;color:#444;line-height:1.7;white-space:pre-line;">${escapeHtml(render(s.body, replacements))}</div>
    </div>`).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;background:#F5F3F7;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:620px;margin:0 auto;padding:24px 16px;">
    <div style="background:#7B4F9B;border-radius:10px 10px 0 0;padding:18px 24px;">
      <h1 style="margin:0;color:#fff;font-size:18px;">Headteacher Terms &amp; Conditions</h1>
      <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:12px;">v${TERMS.version} · Effective ${TERMS.effective_date}</p>
    </div>
    <div style="background:#fff;border:1px solid #E5DCEB;border-top:none;border-radius:0 0 10px 10px;padding:20px 24px;">
      <p style="margin:0 0 14px;font-size:13px;color:#444;line-height:1.6;">
        Dear ${escapeHtml(replacements.HEADTEACHER_NAME || 'School Head')},<br /><br />
        This confirms your acceptance of the Headteacher Terms &amp; Conditions for
        <strong>${escapeHtml(replacements.SCHOOL_NAME || 'your')}</strong> on
        ${replacements.ACCEPTED_AT || ''}.
      </p>
      <div style="background:#F3E7FA;border-left:3px solid #7B4F9B;padding:10px 14px;margin:0 0 18px;font-size:12px;color:#5C3D76;line-height:1.6;">
        <strong>Summary:</strong> The service is free to schools. Parents subscribe at KSh 100
        per child per term via M-Pesa (mandatory parent subscription). Exiting this agreement
        requires at least 90 days' notice. Your data is yours; you can export it anytime.
      </div>
      ${sections}
      <p style="margin:16px 0 0;font-size:12px;color:#777;">
        This acceptance was recorded against your Headteacher account. A copy is retained by
        ${escapeHtml(TERMS.company_name)}.
      </p>
    </div>
  </div>
</body>
</html>`;
}

function render(body, replacements) {
  let out = body;
  for (const [k, v] of Object.entries(replacements || {})) {
    out = out.split(`{{${k}}}`).join(v);
  }
  return out;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { TERMS, renderText, renderHtml };