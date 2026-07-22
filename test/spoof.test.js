const { test } = require('node:test');
const assert = require('node:assert');
const { spoofHeaders, pickUserAgent, UA_SUFFIX, ANDROID_USER_AGENTS } = require('../src/main/spoof');

test('strips client-hint and fetch-metadata headers (case-insensitive)', () => {
  const input = { 'sec-ch-ua': 'x', 'Sec-Fetch-Dest': 'y', 'Accept': 'z' };
  const out = spoofHeaders(input, 'https://static.ankama.com/a.js', 0);
  assert.strictEqual(out['sec-ch-ua'], undefined);
  assert.strictEqual(out['Sec-Fetch-Dest'], undefined);
  assert.strictEqual(out['Accept'], 'z');
});

test('sets an Android User-Agent with client suffix', () => {
  const out = spoofHeaders({}, 'https://auth.ankama.com/', 0);
  assert.ok(out['User-Agent'].includes('Android'));
  assert.ok(out['User-Agent'].endsWith(UA_SUFFIX));
});

test('strips Referer only on configured hosts', () => {
  const kept = spoofHeaders({ Referer: 'r' }, 'https://auth.ankama.com/x', 0);
  assert.strictEqual(kept['Referer'], 'r');
  const stripped = spoofHeaders({ Referer: 'r' }, 'https://static.ankama.com/x', 0);
  assert.strictEqual(stripped['Referer'], undefined);
});

test('pickUserAgent stays within the list', () => {
  for (let i = 0; i < 20; i++) {
    const ua = pickUserAgent(i);
    assert.ok(ANDROID_USER_AGENTS.some((base) => ua.startsWith(base)));
  }
});
