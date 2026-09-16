// The renderer has no bundler: src/i18n/strings.js and
// src/shared/account-settings.js are loaded as plain <script> tags, so they
// share one global lexical scope. Two top-level `const` of the same name there
// is a SyntaxError that silently kills whichever script loads second — which
// is exactly how the launcher first came up with no per-account settings.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SHARED_SCRIPTS = ['../src/i18n/strings.js', '../src/shared/account-settings.js', '../src/shared/keys.js'];

function loadAllInOneRealm() {
  // No `module` in the context: that is what the renderer looks like.
  const context = vm.createContext({});
  for (const rel of SHARED_SCRIPTS) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, rel), 'utf-8'), context, { filename: rel });
  }
  return context;
}

test('every script the renderer loads can share one global scope', () => {
  const context = loadAllInOneRealm();
  assert.strictEqual(typeof context.STAKK_I18N, 'object');
  assert.strictEqual(typeof context.STAKK_ACCOUNT_SETTINGS, 'object');
  assert.strictEqual(typeof context.STAKK_KEYS, 'object');
});

test('the renderer scripts expose the API the renderer calls', () => {
  const context = loadAllInOneRealm();
  assert.strictEqual(typeof context.STAKK_I18N.translate, 'function');
  assert.strictEqual(typeof context.STAKK_ACCOUNT_SETTINGS.effectiveSettings, 'function');
  assert.strictEqual(typeof context.STAKK_ACCOUNT_SETTINGS.pickPerAccount, 'function');
});

test('index.html loads each shared script exactly once, before the renderer', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf-8');
  const order = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.deepStrictEqual(order, ['../i18n/strings.js', '../shared/account-settings.js', '../shared/keys.js', 'renderer.js']);
});
