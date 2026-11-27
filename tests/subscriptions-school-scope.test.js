const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePhone,
  resolveParentSchool,
  getTermPrice,
  applyParentPayment
} = require('../lib/subscriptions');

function parentDb(schoolIds, childCount = 2) {
  const calls = [];
  return {
    calls,
    async execute(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('FROM parent_profiles p')) {
        return [[{
          parent_phone: '0712345678',
          parent_account_id: 77,
          canonical_parent_phone: '0712345678'
        }]];
      }
      if (sql.includes('SELECT DISTINCT s.school_id')) {
        return [schoolIds.map(school_id => ({ school_id }))];
      }
      if (sql.includes("setting_key = 'premium_price'")) {
        return [[{ setting_value: '200' }]];
      }
      if (sql.includes('COUNT(DISTINCT s.student_id)')) {
        return [[{ child_count: childCount }]];
      }
      return [{ affectedRows: 1 }];
    }
  };
}

test('subscription phone normalization accepts legacy Kenyan formats', () => {
  assert.equal(normalizePhone('0712 345 678'), '254712345678');
  assert.equal(normalizePhone('+254 712-345-678'), '254712345678');
  assert.equal(normalizePhone('712345678'), '254712345678');
});

test('multi-school parent must select a school for subscription allocation', async () => {
  const db = parentDb(['SCH000001', 'SCH000002']);
  await assert.rejects(
    resolveParentSchool(db, '254712345678'),
    /Select a school/
  );
});

test('selected school must be linked to an active billable child', async () => {
  const db = parentDb(['SCH000001', 'SCH000002']);
  await assert.rejects(
    resolveParentSchool(db, '254712345678', 'SCH000003'),
    /no active, billable children/
  );
});

test('single-school parent resolves without an explicit school id', async () => {
  const db = parentDb(['SCH000001']);
  const resolved = await resolveParentSchool(db, '254712345678');
  assert.deepEqual(resolved, {
    accountId: 77,
    parentPhone: '0712345678',
    schoolId: 'SCH000001'
  });
});

test('term price counts only children at the selected school', async () => {
  const db = parentDb(['SCH000001', 'SCH000002'], 3);
  const pricing = await getTermPrice(db, '254712345678', 'SCH000002');
  assert.deepEqual(pricing, {
    schoolId: 'SCH000002',
    accountId: 77,
    parentPhone: '0712345678',
    amount: 600
  });
});

test('underpayment cannot activate a subscription or update a parent profile', async () => {
  const db = parentDb(['SCH000001'], 2);
  await assert.rejects(
    applyParentPayment(db, '254712345678', 200, 'SCH000001'),
    /Insufficient subscription payment: KSh 400/
  );
  assert.equal(
    db.calls.some(call => /UPDATE parent_profiles|INSERT INTO premium_subscriptions/.test(call.sql)),
    false
  );
});

test('full payment updates the canonical profile and selected school subscription', async () => {
  const db = parentDb(['SCH000001'], 2);
  const originalExecute = db.execute.bind(db);
  db.execute = async (sql, params = []) => {
    if (sql.includes('SELECT MIN(start_date) AS next_start')) {
      db.calls.push({ sql, params });
      return [[{ next_start: '2027-01-01' }]];
    }
    return originalExecute(sql, params);
  };

  const result = await applyParentPayment(db, '254712345678', 400, 'SCH000001');
  assert.equal(result.school_id, 'SCH000001');
  assert.equal(result.terms_activated, 1);
  const profileUpdate = db.calls.find(call => call.sql.includes('UPDATE parent_profiles SET is_premium'));
  assert.ok(profileUpdate.sql.includes('WHERE parent_account_id = ?'));
  assert.equal(profileUpdate.params[1], 77);
  const subscriptionInsert = db.calls.find(call => call.sql.includes('INSERT INTO premium_subscriptions'));
  assert.equal(subscriptionInsert.params[0], 'SCH000001');
  assert.equal(subscriptionInsert.params[1], '0712345678');
});

test('early renewal extends from the existing school expiry date', async () => {
  const db = parentDb(['SCH000001'], 2);
  const originalExecute = db.execute.bind(db);
  let renewalPivot = null;
  db.execute = async (sql, params = []) => {
    if (sql.includes('SELECT MAX(expires_at) AS current_expiry')) {
      db.calls.push({ sql, params });
      return [[{ current_expiry: '2027-05-01T00:00:00.000Z' }]];
    }
    if (sql.includes('SELECT MIN(start_date) AS next_start')) {
      db.calls.push({ sql, params });
      renewalPivot = params[1];
      return [[{ next_start: '2027-09-01' }]];
    }
    return originalExecute(sql, params);
  };

  const result = await applyParentPayment(db, '254712345678', 400, 'SCH000001');
  assert.equal(renewalPivot, '2027-05-01');
  assert.equal(new Date(result.expires_at).toISOString().slice(0, 10), '2027-09-01');
});
