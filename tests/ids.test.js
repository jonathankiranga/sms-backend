const test = require('node:test');
const assert = require('node:assert/strict');
const { genId, generateUniqueId } = require('../lib/ids');

test('school and learner identifiers fit CHAR(9)', () => {
  for (const prefix of ['SCH', 'STU', 'TCH']) {
    const id = genId(prefix);
    assert.equal(id.length, 9);
    assert.match(id, new RegExp('^' + prefix + '[A-Z0-9]{6}$'));
  }
});

test('ID generator rejects prefixes that leave too little entropy', () => {
  assert.throws(() => genId('SCHOOL'), /between 1 and 3 letters/);
});

test('generateUniqueId checks the candidate against the target table', async () => {
  const calls = [];
  const db = {
    execute: async (sql, params) => {
      calls.push({ sql, params });
      return [[]];
    }
  };
  const id = await generateUniqueId(db, 'SCH', 'schools', 'school_id');
  assert.equal(id.length, 9);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [id]);
});
