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

const NORMALIZED_PHONE_SQL = `CASE
  WHEN REPLACE(REPLACE(t.phone, ' ', ''), '-', '') REGEXP '^0[17][0-9]{8}$'
    THEN CONCAT('254', SUBSTRING(REPLACE(REPLACE(t.phone, ' ', ''), '-', ''), 2))
  WHEN REPLACE(REPLACE(t.phone, ' ', ''), '-', '') REGEXP '^[17][0-9]{8}$'
    THEN CONCAT('254', REPLACE(REPLACE(t.phone, ' ', ''), '-', ''))
  ELSE REPLACE(REPLACE(REPLACE(t.phone, ' ', ''), '-', ''), '+', '')
END`;

async function findSchoolMembership(db, { schoolId, role, phone, email }) {
  const normalizedPhone = normalizePhone(phone);
  const normalizedEmail = normalizeEmail(email);

  if (!schoolId || !role || (!normalizedPhone && !normalizedEmail)) return { membership: null };

  // If both identifiers are supplied, they must match the SAME staff record.
  // Never allow a known phone number to be paired with an attacker's email.
  let identifierSql;
  let identifierParams;
  if (normalizedPhone && normalizedEmail) {
    identifierSql = `${NORMALIZED_PHONE_SQL} = ? AND LOWER(TRIM(t.email)) = ?`;
    identifierParams = [normalizedPhone, normalizedEmail];
  } else if (normalizedPhone) {
    identifierSql = `${NORMALIZED_PHONE_SQL} = ?`;
    identifierParams = [normalizedPhone];
  } else {
    identifierSql = 'LOWER(TRIM(t.email)) = ?';
    identifierParams = [normalizedEmail];
  }

  const [rows] = await db.execute(
    `SELECT t.teacher_id, t.staff_account_id, t.school_id, t.role, t.active,
            m.membership_id, m.status AS membership_status
     FROM teachers t
     JOIN teacher_school_memberships m
       ON m.teacher_id = t.teacher_id
      AND m.school_id = t.school_id
      AND m.staff_account_id = t.staff_account_id
      AND m.role = t.role
     WHERE t.school_id = ? AND t.role = ?
       AND ${identifierSql}
     LIMIT 2`,
    [schoolId, role, ...identifierParams]
  );

  if (rows.length > 1) return { ambiguous: true };
  if (!rows.length) return { membership: null };
  const row = rows[0];
  if (Number(row.active) !== 1 || row.membership_status !== 'active') return { inactive: true };
  return { membership: row };
}

module.exports = { normalizeEmail, normalizePhone, findSchoolMembership };
