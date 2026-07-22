const { test } = require('node:test');
const assert = require('node:assert');
const { prepareSession } = require('../src/main/session-prep');

function mockSession() {
  const calls = { send: 0, before: 0, error: 0 };
  return {
    calls,
    webRequest: {
      onBeforeSendHeaders: () => { calls.send += 1; },
      onBeforeRequest: () => { calls.before += 1; },
      onErrorOccurred: () => { calls.error += 1; },
    },
  };
}

test('prepareSession installs all three handlers once', () => {
  const s = mockSession();
  assert.strictEqual(prepareSession(s, () => {}), true);
  assert.deepStrictEqual(s.calls, { send: 1, before: 1, error: 1 });
});

test('prepareSession is idempotent per session', () => {
  const s = mockSession();
  prepareSession(s, () => {});
  assert.strictEqual(prepareSession(s, () => {}), false);
  assert.deepStrictEqual(s.calls, { send: 1, before: 1, error: 1 });
});
