// Headteacher Terms & Conditions content.
// Single source of truth for the in-app T&C and the emailed copy.
// Bump VERSION when the terms change so an acceptance is required again.

const TERMS = {
  version: '2026.2',
  effective_date: '2026-09-04',
  environment: 'cbcschool.app',
  company_name: 'Smarternow Data Venture',
  product_name: 'cbcSchool App (FreeSchool Platform)',
  support_email: 'support@cbcschool.co.ke',
  sections: [
    {
      id: 'intro',
      heading: '1. Introduction',
      body: `These Terms and Conditions ("Terms") govern the use of the ${'{{PRODUCT}}'} Headteacher Portal ("the Platform") by the Headteacher of a registered school ("you" or the "School Head"). The Platform is operated by ${'{{COMPANY}}'} ("we", "us", or "our"). By creating or accessing a Headteacher account, you confirm that you have read, understood, and agreed to be bound by these Terms on your own behalf and on behalf of your school.`
    },
    {
      id: 'acceptance',
      heading: '2. Acceptance of Terms',
      body: `Access to the Headteacher Portal is conditional on your positive acceptance of these Terms. You will not be able to log in to the Headteacher Portal until you have acknowledged that you have read and accepted these Terms. On acceptance, a copy of these Terms is emailed to you and the acceptance is recorded against your account. If you do not accept these Terms, you must not use the Headteacher Portal.`
    },
    {
      id: 'authority',
      heading: '3. Authority to Bind the School',
      body: `By accepting these Terms you warrant that you have the full authority of your school's management to accept these Terms, to manage the school's account, and to bind the school to the obligations set out in these Terms. Smarternow Data Venture relies on this warranty in granting the school access to the Platform.`
    },
    {
      id: 'services',
      heading: '4. Scope of Services',
      body: `The Platform provides the Headteacher Portal for the management of the school, including staff management, student rosters, attendance oversight, CBC assessment and report cards, fee records, parent communication via WhatsApp, school broadcasts, academic-year promotion, and the Parent Subscription programme described in clause 12. All services are provided in the "as is" state described on the Platform's website (${'{{ENV}}'}).`
    },
    {
      id: 'free',
      heading: '5. Cost to the School',
      body: `The Platform is provided free of charge to schools, teachers, and headteachers. There is no setup fee, no monthly subscription, and no lock-in contract. The school's obligations under these Terms do not include any payment to Smarternow Data Venture.`
    },
    {
      id: 'account',
      heading: '6. Account Security & Access Control',
      body: `You are responsible for safeguarding your account credentials and for the activities carried out under your account. Authentication is by one-time PIN (OTP) sent to your registered email or phone. You must not share credentials, must promptly deactivate the accounts of staff who no longer require access, and must notify us immediately of any suspected unauthorised use.`
    },
    {
      id: 'data',
      heading: '7. School Data Ownership & Confidentiality',
      body: `All data entered into the Platform belongs to the school. We do not sell, rent, or share school data with any third party. Data is stored on encrypted servers with continuous backup. The School Head may export all school data at any time. Reports are retained for a minimum of five (5) years. We process personal data in accordance with the Kenya Data Protection Act, 2019.`
    },
    {
      id: 'records',
      heading: '8. Accuracy of Records',
      body: `You are responsible for ensuring that school, teacher, and student records entered into the Platform are accurate and current. You must promptly update the enrolment status of students and the access rights of staff. Automated reports, parent alerts, and fee records rely on the accuracy of the underlying data.`
    },
    {
      id: 'acceptable-use',
      heading: '9. Acceptable Use',
      body: `You agree not to misuse the Platform, including: tampering with attendance, assessment, or fee records; entering false data; attempting to access another school's data; transmitting harmful or unlawful content; or using the Platform in a manner that breaches the Kenya Data Protection Act, 2019 or any other applicable law.`
    },
    {
      id: 'whatsapp',
      heading: '10. Parent Communication via WhatsApp',
      body: `The Platform sends parents WhatsApp notifications, including absence alerts, assessment result alerts, fee reminders, and school broadcasts, through the official Meta WhatsApp Business API using approved message templates. The school is responsible for ensuring it has the lawful basis, consent, and correct parent contact numbers required to communicate with parents through these channels.`
    },
    {
      id: 'otp',
      heading: '11. Authentication & Phone Numbers',
      body: `Teachers and headteachers who log in with their phone number receive one-time PINs by SMS or WhatsApp. Parents access the Parent Portal by phone-number OTP. The school is responsible for maintaining correct phone numbers for staff and guardians.`
    },
    {
      id: 'subscription',
      heading: '12. Parent Subscription Programme',
      body: `The school operates a mandatory Parent Subscription programme. This programme is provided to the school as a mandated service: the school requires each parent or guardian to subscribe for their child at a charge of KSh 100 per child per term. The subscription charge is paid directly by the parent or guardian via M-Pesa STK Push. The school does not collect the charge and does not owe the charge; parents subscribe directly to Smarternow Data Venture as the service provider. Subscription benefits include WhatsApp absence alerts, assessment result alerts, M-Pesa fee payment, downloadable PDF reports, and access to the school marketplace. The school may, at its discretion, pay for subscriptions on behalf of a parent.`
    },
    {
      id: 'fees',
      heading: '13. Fee Records & M-Pesa',
      body: `The Platform records school fees and payments, enabling the school to issue fee statements and reminders. Fee collection is configured and operated by the school. Where M-Pesa payment is used, transactions are processed through the official Safaricom Daraja API and reconciled automatically into the school's fee ledger.`
    },
    {
      id: 'availability',
      heading: '14. Availability, Offline Use & Support',
      body: `The Platform is designed to work offline on supported devices; data is synchronised automatically when connectivity is available. We use reasonable efforts to maintain service availability but do not guarantee uninterrupted access. Support is provided by email at ${'{{SUPPORT_EMAIL}}'}. Scheduled maintenance may cause temporary interruptions.`
    },
    {
      id: 'intellectual-property',
      heading: '15. Intellectual Property',
      body: `All rights, title, and interest in the Platform, its software, user interfaces, and related technology belong to Smarternow Data Venture. Nothing in these Terms grants the school any ownership interest in the Platform beyond the right to use it in accordance with these Terms.`
    },
    {
      id: 'liability',
      heading: '16. Limitation of Liability',
      body: `To the maximum extent permitted by law, Smarternow Data Venture shall not be liable for any indirect, incidental, special, or consequential loss arising out of or in connection with these Terms or your use of the Platform, including loss of profits, data (except where negligently caused by us), or goodwill. Our total aggregate liability arising out of or in connection with these Terms shall not exceed the amount paid by the school to us in the twelve (12) months preceding the claim — which, given the service is free to schools, is limited to the aggregate of amounts paid by parents of the school during that period relating to the school's Parent Subscription programme.`
    },
    {
      id: 'indemnity',
      heading: '17. Indemnity',
      body: `You agree to indemnify and hold Smarternow Data Venture harmless against any claims, losses, or expenses arising from: (a) your breach of these Terms; (b) your wrongful use of the Platform; or (c) your failure to obtain required consents from parents or staff for the processing of their personal data.`
    },
    {
      id: 'exit',
      heading: '18. Exit, Notice Period & Data Export',
      body: `Either party may exit this agreement by giving not less than ninety (90) days' written notice to the other party. During the notice period, the school retains full access to the Platform for the orderly migration of its records. On exit, the school must request the export of its data, and Smarternow Data Venture will provide the school's data in a structured, commonly used format within thirty (30) days of the export request. Following the exit date, school data is retained for a further six (6) months to allow for final retrieval, after which it is securely deleted in accordance with our data retention policy. The school may also export all data at any time during the term without limitation.`
    },
    {
      id: 'changes',
      heading: '19. Changes to These Terms',
      body: `We may update these Terms from time to time. When the Terms change, a new version is published and headteachers will be required to accept the updated version before continued use of the Headteacher Portal. Material changes will be communicated by email to the school's registered headteacher email address.`
    },
    {
      id: 'termination',
      heading: '20. Suspension & Termination by Us',
      body: `We may suspend or terminate access to the Platform where the school or its headteacher breaches these Terms, engages in fraudulent or unlawful activity, or where continued provision of the service is no longer lawful. Where practicable, we will give the school notice and a reasonable opportunity to remedy a remediable breach before termination.`
    },
    {
      id: 'law',
      heading: '21. Governing Law & Disputes',
      body: `These Terms are governed by the laws of the Republic of Kenya. Any dispute arising out of or in connection with these Terms shall first be referred to negotiation between the parties, and failing resolution, to the courts of Kenya.`
    },
    {
      id: 'contact',
      heading: '22. Contact',
      body: `Questions about these Terms may be sent to ${'{{SUPPORT_EMAIL}}'}.`
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
        requires at least 90 days' notice.
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