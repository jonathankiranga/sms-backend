function normalizeEmail(value) {
  return value ? String(value).trim().toLowerCase() : '';
}

function normalizePhone(value) {
  if (!value) return '';
  const phone = String(value).replace(/[\s-]/g, '').replace(/^\+/, '');
  if (/^0[17]\d{8}$/.test(phone)) return '254' + phone.slice(1);
  if (/^[17]\d{8}$/.test(phone)) return '254' + phone;
  return phone;
}

async function findSchoolMembership(db, { schoolId, role, phone, email }) {
  const normalizedPhone = normalizePhone(phone);
  const normalizedEmail = normalizeEmail(email);
  const [rows] = await db.execute(
    `SELECT t.teacher_id, t.staff_account_id, t.school_id, t.role, t.active,
            m.membership_id, m.status AS membership_status
     FROM teachers t
     JOIN teacher_school_memberships m
       ON m.teacher_id = t.teacher_id AND m.school_id = t.school_id
     WHERE t.school_id = ? AND t.role = ?
       AND (
         (? <> '' AND (
           CASE
             WHEN REPLACE(REPLACE(t.phone, ' ', ''), '-', '') REGEXP '^0[17][0-9]{8}$'
               THEN CONCAT('254', SUBSTRING(REPLACE(REPLACE(t.phone, ' ', ''), '-', ''), 2))
             WHEN REPLACE(REPLACE(t.phone, ' ', ''), '-', '') REGEXP '^[17][0-9]{8}$'
               THEN CONCAT('254', REPLACE(REPLACE(t.phone, ' ', ''), '-', ''))
             ELSE REPLACE(REPLACE(REPLACE(t.phone, ' ', ''), '-', ''), '+', '')
           END
         ) = ?)
         OR (? <> '' AND LOWER(TRIM(t.email)) = ?)
       )
     LIMIT 2`,
    [schoolId, role, normalizedPhone, normalizedPhone, normalizedEmail, normalizedEmail]
  );

  if (rows.length > 1) return { ambiguous: true };
  if (!rows.length) return { membership: null };
  const row = rows[0];
  if (row.active === 0 || row.membership_status === 'inactive' || row.membership_status === 'suspended') {
    return { inactive: true };
  }
  return { membership: row };
}

module.exports = { normalizeEmail, normalizePhone, findSchoolMembership };
