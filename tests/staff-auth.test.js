const test = require('node:test');
const assert = require('node:assert/strict');
const { requireStaffSession } = require('../lib/staffAuth');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('staff session resolves only its selected active school membership', async () => {
  const calls = [];
  const req = {
    headers: { authorization: 'Bearer session-token' },
    params: {},
    query: {},
    body: {},
    db: {
      async execute(sql, params) {
        calls.push({ sql, params });
        if (calls.length === 1) {
          return [[{
            phone: '254712345678',
            email: 'teacher@example.com',
            teacher_id: 'TCH000001',
            school_id: 'SCH000001',
            login_role: 'teacher',
            verified: 1,
            expires_at: new Date(Date.now() + 60 * 60 * 1000)
          }]];
        }
        return [[{
          teacher_id: 'TCH000001',
          school_id: 'SCH000001',
          role: 'teacher',
          active: 1,
          membership_id: 7,
          staff_account_id: 12,
          membership_status: 'active'
        }]];
      }
    }
  };
  const res = responseRecorder();
  let nextCalled = false;

  await requireStaffSession(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(req.staff.school_id, 'SCH000001');
  assert.equal(calls.length, 2);
  assert.ok(calls[1].sql.includes('t.school_id = ?'));
  assert.ok(calls[1].sql.includes("m.status = 'active'"));
  assert.deepEqual(calls[1].params, ['TCH000001', 'SCH000001', 'teacher']);
});

test('legacy unscoped staff sessions are rejected instead of guessing a school', async () => {
  let calls = 0;
  const req = {
    headers: { authorization: 'Bearer old-session' },
    params: {},
    query: {},
    body: {},
    db: {
      async execute() {
        calls += 1;
        return [[{
          phone: '254712345678',
          email: 'teacher@example.com',
          teacher_id: 'TCH000001',
          school_id: null,
          login_role: null,
          verified: 1,
          expires_at: new Date(Date.now() + 60 * 60 * 1000)
        }]];
      }
    }
  };
  const res = responseRecorder();
  let nextCalled = false;

  await requireStaffSession(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(calls, 1);
});
