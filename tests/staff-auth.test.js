const test = require('node:test');
const assert = require('node:assert/strict');
const { requireStaffSession, requireAssessmentAccess } = require('../lib/staffAuth');

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

test('parent report access is denied when the selected school subscription is inactive', async () => {
  const req = {
    headers: { authorization: 'Bearer parent-session' },
    method: 'GET',
    path: '/report/STU000001/Term%201',
    params: { student_id: 'STU000001' },
    db: {
      async execute(sql) {
        if (sql.includes('FROM otp_sessions')) {
          return [[{
            phone: '0712345678', parent_account_id: 55, verified: 1,
            expires_at: new Date(Date.now() + 60 * 60 * 1000)
          }]];
        }
        if (sql.includes('FROM parent_student_relationships')) return [[{ student_id: 'STU000001' }]];
        if (sql.includes('FROM students s')) return [[{ school_id: 'SCH000001', premium_payment_model: 'parent' }]];
        if (sql.includes('FROM premium_subscriptions')) return [[]];
        throw new Error('Unexpected query: ' + sql);
      }
    }
  };
  const res = responseRecorder();
  let nextCalled = false;

  await requireAssessmentAccess(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'The subscription for this school is not active');
});

test('parent report access is allowed when the same school subscription is active', async () => {
  const req = {
    headers: { authorization: 'Bearer parent-session' },
    method: 'GET',
    path: '/report/STU000001/Term%201',
    params: { student_id: 'STU000001' },
    db: {
      async execute(sql) {
        if (sql.includes('FROM otp_sessions')) {
          return [[{
            phone: '0712345678', parent_account_id: 55, verified: 1,
            expires_at: new Date(Date.now() + 60 * 60 * 1000)
          }]];
        }
        if (sql.includes('FROM parent_student_relationships')) return [[{ student_id: 'STU000001' }]];
        if (sql.includes('FROM students s')) return [[{ school_id: 'SCH000001', premium_payment_model: 'parent' }]];
        if (sql.includes('FROM premium_subscriptions')) return [[{ 1: 1 }]];
        throw new Error('Unexpected query: ' + sql);
      }
    }
  };
  const res = responseRecorder();
  let nextCalled = false;

  await requireAssessmentAccess(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(req.parentSession, true);
  assert.equal(req.parentAccountId, 55);
});

test('parent report access is allowed when the school pays the subscription', async () => {
  const req = {
    headers: { authorization: 'Bearer parent-session' },
    method: 'GET',
    path: '/report/STU000001/Term%201',
    params: { student_id: 'STU000001' },
    db: {
      async execute(sql) {
        if (sql.includes('FROM otp_sessions')) {
          return [[{
            phone: '0712345678', parent_account_id: 55, verified: 1,
            expires_at: new Date(Date.now() + 60 * 60 * 1000)
          }]];
        }
        if (sql.includes('FROM parent_student_relationships')) return [[{ student_id: 'STU000001' }]];
        if (sql.includes('FROM students s')) return [[{ school_id: 'SCH000001', premium_payment_model: 'school' }]];
        throw new Error('Subscription should not be queried for school-paid access');
      }
    }
  };
  const res = responseRecorder();
  let nextCalled = false;

  await requireAssessmentAccess(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(req.parentSession, true);
});

test('legacy phone-only parent sessions cannot access reports after identity migration', async () => {
  const req = {
    headers: { authorization: 'Bearer old-parent-session' },
    method: 'GET',
    path: '/report/STU000001/Term%201',
    params: { student_id: 'STU000001' },
    db: {
      async execute(sql) {
        if (sql.includes('FROM otp_sessions')) {
          return [[{
            phone: '0712345678', verified: 1,
            expires_at: new Date(Date.now() + 60 * 60 * 1000)
          }]];
        }
        throw new Error('Legacy phone-only parent must not trigger relationship lookup');
      }
    }
  };
  const res = responseRecorder();
  let nextCalled = false;

  await requireAssessmentAccess(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});
