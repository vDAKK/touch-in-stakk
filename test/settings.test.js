const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { loadSettings, saveSettings, DEFAULT_SETTINGS } = require('../src/main/settings');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tis-'));
}

test('loads defaults when no file exists', () => {
  assert.deepStrictEqual(loadSettings(tmp()), DEFAULT_SETTINGS);
});

test('round-trips saved settings', () => {
  const dir = tmp();
  saveSettings(dir, { muted: true, resolution: { width: 1920, height: 1080 } });
  const s = loadSettings(dir);
  assert.strictEqual(s.muted, true);
  assert.strictEqual(s.resolution.width, 1920);
});

test('merges partial save over defaults', () => {
  const dir = tmp();
  saveSettings(dir, { muted: true });
  const s = loadSettings(dir);
  assert.strictEqual(s.muted, true);
  assert.deepStrictEqual(s.resolution, DEFAULT_SETTINGS.resolution);
});

test('nested resolution falls back to default height when only width given', () => {
  const dir = tmp();
  saveSettings(dir, { resolution: { width: 1920 } });
  const s = loadSettings(dir);
  assert.strictEqual(s.resolution.width, 1920);
  assert.strictEqual(s.resolution.height, DEFAULT_SETTINGS.resolution.height);
});
