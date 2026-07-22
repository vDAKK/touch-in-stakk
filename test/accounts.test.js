const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { loadAccounts, addAccount, renameAccount, removeAccount, reorderAccounts, partitionFor } = require('../src/main/accounts');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tis-acc-'));
}

test('defaults to empty with nextId 1 when no file', () => {
  assert.deepStrictEqual(loadAccounts(tmp()), { nextId: 1, accounts: [] });
});

test('addAccount assigns nextId, defaults the name, and increments', () => {
  const dir = tmp();
  const a = addAccount(dir);
  const b = addAccount(dir, 'Perso B');
  assert.deepStrictEqual(a, { id: 1, name: 'Compte 1' });
  assert.deepStrictEqual(b, { id: 2, name: 'Perso B' });
  assert.strictEqual(loadAccounts(dir).nextId, 3);
  assert.strictEqual(loadAccounts(dir).accounts.length, 2);
});

test('renameAccount updates an existing account, null otherwise', () => {
  const dir = tmp();
  const a = addAccount(dir);
  assert.strictEqual(renameAccount(dir, a.id, 'X').name, 'X');
  assert.strictEqual(loadAccounts(dir).accounts[0].name, 'X');
  assert.strictEqual(renameAccount(dir, 999, 'Y'), null);
});

test('removeAccount removes by id and reports success', () => {
  const dir = tmp();
  const a = addAccount(dir);
  assert.strictEqual(removeAccount(dir, a.id), true);
  assert.strictEqual(loadAccounts(dir).accounts.length, 0);
  assert.strictEqual(removeAccount(dir, a.id), false);
});

test('reorderAccounts persists the given order and keeps unlisted ids', () => {
  const dir = tmp();
  addAccount(dir); // 1
  addAccount(dir); // 2
  addAccount(dir); // 3
  const out = reorderAccounts(dir, [3, 1]);
  assert.deepStrictEqual(out.map((a) => a.id), [3, 1, 2]);
  assert.deepStrictEqual(loadAccounts(dir).accounts.map((a) => a.id), [3, 1, 2]);
});

test('partitionFor builds the persist partition string', () => {
  assert.strictEqual(partitionFor(7), 'persist:acct-7');
});
