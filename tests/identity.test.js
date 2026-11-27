const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEmail, normalizePhone, findSchoolMembership } = require('../lib/identity');

test('normalizes Kenyan phone numbers consistently', () => {
  assert.equal(normalizePhone('0712 345 678'), '254712345678');
  assert.equal(normalizePhone('+254 712-345-678'), '254712345678');
  assert.equal(normalizePhone('712345678'), '254712345678');
  assert.equal(normalizePhone('254712345678'), '254712345678');
});

test('normalizes email addresses', () => {
  assert.equal(normalizeEmail('  TEACHER@Example.COM '), 'teacher@example.com');
  assert.equal(normalizeEmail(''), '');
});

test('staff lookup is explicitly scoped to selected school and role', async () => {
  let captured;
  const db = {
    async execute(sql, params) {
      captured = { sql, params };
      return [[{
        teacher_id: 'TCH000001',
        staff_account_id: 12,
        school_id: 'SCH000001',
        role: 'teacher',
        active: 1,
        membership_id: 8,
        membership_status: 'active'
      }]];
    }
  };

  const result = await findSchoolMembership(db, {
    schoolId: 'SCH000001',
    role: 'teacher',
    phone: '0712345678',
    email: ''
  });

  assert.equal(captured.params[0], 'SCH000001');
  assert.equal(captured.params[1], 'teacher');
  assert.match(captured.sql, /t\.school_id = \?/);
  assert.equal(result.membership.teacher_id, 'TCH000001');
});

test('ambiguous staff matches are rejected', async () => {
  const db = { async execute() { return [[{ teacher_id: 'A' }, { teacher_id: 'B' }]]; } };
  const result = await findSchoolMembership(db, {
    schoolId: 'SCH000001', role: 'teacher', email: 'shared@example.com'
  });
  assert.equal(result.ambiguous, true);
});

test('inactive school memberships cannot authenticate', async () => {
  const db = {
    async execute() {
      return [[{
        teacher_id: 'TCH000001',
        school_id: 'SCH000001',
        role: 'teacher',
        active: 1,
        membership_status: 'suspended'
      }]];
    }
  };
  const result = await findSchoolMembership(db, {
    schoolId: 'SCH000001', role: 'teacher', email: 'teacher@example.com'
  });
  assert.equal(result.inactive, true);
});

test('phone and email supplied together must match the same staff record', async () => {
  let captured;
  const db = {
    async execute(sql, params) {
      captured = { sql, params };
      return [[]];
    }
  };

  const result = await findSchoolMembership(db, {
    schoolId: 'SCH000001',
    role: 'teacher',
    phone: '0712345678',
    email: 'attacker@example.com'
  });

  assert.equal(result.membership, null);
  assert.match(captured.sql, / = \\? AND LOWER\\(TRIM\\(t\\.email\\)\\) = \\?/);
  assert.equal(captured.params[2], '254712345678');
  assert.equal(captured.params[3], 'attacker@example.com');
  assert.doesNotMatch(captured.sql, /\\sOR\\s/);
});
