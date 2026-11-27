const test = require('node:test');
const assert = require('node:assert/strict');

test('identity-related route modules load without syntax or import errors', () => {
  assert.doesNotThrow(() => require('../lib/identity'));
  assert.doesNotThrow(() => require('../lib/staffAuth'));
  assert.doesNotThrow(() => require('../lib/subscriptions'));
  assert.doesNotThrow(() => require('../routes/teachers'));
  assert.doesNotThrow(() => require('../routes/parents'));
});
