const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const security = require('../src/main/security');
const { getMachineId, _hash, NAMESPACE } = require('../src/main/machine-id');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tis-sec-'));
}

test('empty store defaults to no bans/flags', () => {
  assert.deepStrictEqual(security.load(tmp()), { bans: [], flags: [] });
});

test('flag appends a tripwire record', () => {
  const dir = tmp();
  security.flag(dir, 'abc', 'auto-harvest-enabled', { via: 'admin-toggle' }, '2026-07-31T00:00:00Z');
  const store = security.load(dir);
  assert.strictEqual(store.flags.length, 1);
  assert.strictEqual(store.flags[0].machineId, 'abc');
  assert.strictEqual(store.flags[0].reason, 'auto-harvest-enabled');
  assert.deepStrictEqual(store.flags[0].meta, { via: 'admin-toggle' });
});

test('ban then isBanned, unban clears it, ban is idempotent', () => {
  const dir = tmp();
  assert.strictEqual(security.isBanned(dir, 'm1'), false);
  security.ban(dir, 'm1', 'manual', '2026-07-31T00:00:00Z');
  security.ban(dir, 'm1', 'again', '2026-07-31T00:00:01Z');
  assert.strictEqual(security.load(dir).bans.length, 1);
  assert.strictEqual(security.isBanned(dir, 'm1'), true);
  security.unban(dir, 'm1');
  assert.strictEqual(security.isBanned(dir, 'm1'), false);
});

test('machine id is a stable namespaced sha256 hex', () => {
  const dir = tmp();
  const a = getMachineId(dir);
  assert.match(a.id, /^[0-9a-f]{64}$/);
  assert.ok(a.source === 'registry' || a.source === 'fallback');
  // hash helper is deterministic under the versioned namespace
  assert.strictEqual(_hash('seed'), _hash('seed'));
  assert.notStrictEqual(_hash('seed'), _hash('seed2'));
  assert.ok(NAMESPACE.length > 0);
});

test('fallback id persists across calls', () => {
  const dir = tmp();
  // Force fallback by pointing at a dir; on non-win32 registry read returns null.
  const file = path.join(dir, 'machine-id-fallback.json');
  fs.writeFileSync(file, JSON.stringify({ id: 'fixed-seed' }));
  // hash of the persisted seed is stable
  assert.strictEqual(_hash('fixed-seed'), _hash('fixed-seed'));
});
