const test = require('node:test');
const assert = require('node:assert/strict');
const {
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
