const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PER_ACCOUNT_KEYS, pickPerAccount, effectiveSettings, isCustom } = require('../src/shared/account-settings');
const { addAccount, loadAccounts, setAccountSettings } = require('../src/main/accounts');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tis-acct-'));
}

const GLOBAL = { lang: 'fr', muted: false, noConfirm: true, notifications: true, keybinds: { spells: 'a' } };

test('an account with no settings of its own follows the launcher', () => {
  const out = effectiveSettings(GLOBAL, { id: 1, name: 'Mule' });
  assert.deepStrictEqual(out, GLOBAL);
  assert.strictEqual(isCustom({ id: 1 }), false);
});

test('a custom account overrides only the keys it carries', () => {
  const account = { id: 1, custom: true, settings: { muted: true, keybinds: { spells: 'z' } } };
  const out = effectiveSettings(GLOBAL, account);
  assert.strictEqual(out.muted, true);
  assert.deepStrictEqual(out.keybinds, { spells: 'z' });
  assert.strictEqual(out.noConfirm, true, 'untouched keys still come from the global settings');
  assert.strictEqual(out.lang, 'fr', 'launcher-wide keys are never per account');
});

test('settings stored on an account are ignored until it is made custom', () => {
  const account = { id: 1, custom: false, settings: { muted: true } };
  assert.strictEqual(effectiveSettings(GLOBAL, account).muted, false);
});

test('pickPerAccount keeps only what an account may own', () => {
  const out = pickPerAccount({ ...GLOBAL, lang: 'en', resolution: { width: 1 }, muted: true });
  assert.strictEqual(out.lang, undefined);
  assert.strictEqual(out.resolution, undefined);
  assert.strictEqual(out.muted, true);
  for (const key of Object.keys(out)) assert.ok(PER_ACCOUNT_KEYS.includes(key), key);
});

test('language and window size are never per account', () => {
  for (const key of ['lang', 'resolution', 'resolutionSet', 'tabBarSide', 'muteInactive']) {
    assert.ok(!PER_ACCOUNT_KEYS.includes(key), key + ' must stay launcher-wide');
  }
});

test('setAccountSettings persists a custom account and drops foreign keys', () => {
  const dir = tmpDir();
  const account = addAccount(dir, 'Mule');
  const saved = setAccountSettings(dir, account.id, { custom: true, settings: { muted: true, lang: 'en' } });
  assert.strictEqual(saved.custom, true);
  assert.deepStrictEqual(saved.settings, { muted: true });
  const reloaded = loadAccounts(dir).accounts[0];
  assert.strictEqual(reloaded.custom, true);
  assert.strictEqual(reloaded.settings.muted, true);
});

test('setAccountSettings merges successive patches', () => {
  const dir = tmpDir();
  const account = addAccount(dir, 'Mule');
  setAccountSettings(dir, account.id, { custom: true, settings: { muted: true } });
  const saved = setAccountSettings(dir, account.id, { settings: { noConfirm: false } });
  assert.deepStrictEqual(saved.settings, { muted: true, noConfirm: false });
});

test('going back to the launcher settings drops the account copy', () => {
  const dir = tmpDir();
  const account = addAccount(dir, 'Mule');
  setAccountSettings(dir, account.id, { custom: true, settings: { muted: true } });
  const saved = setAccountSettings(dir, account.id, { custom: false });
  assert.strictEqual(saved.custom, false);
  assert.strictEqual(saved.settings, undefined);
  assert.strictEqual(effectiveSettings(GLOBAL, saved).muted, false);
});

test('setAccountSettings on an unknown account changes nothing', () => {
  const dir = tmpDir();
  addAccount(dir, 'Mule');
  assert.strictEqual(setAccountSettings(dir, 999, { custom: true }), null);
  assert.strictEqual(loadAccounts(dir).accounts[0].custom, undefined);
});
