const fs = require('node:fs');
const path = require('node:path');

const DEFAULT = { nextId: 1, accounts: [] };

function accountsPath(userDataDir) {
  return path.join(userDataDir, 'accounts.json');
}

function loadAccounts(userDataDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(accountsPath(userDataDir), 'utf-8'));
    return {
      nextId: typeof parsed.nextId === 'number' ? parsed.nextId : 1,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
    };
  } catch {
    return { nextId: 1, accounts: [] };
  }
}

function saveAccounts(userDataDir, state) {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(accountsPath(userDataDir), JSON.stringify(state, null, 2), 'utf-8');
  return state;
}

function addAccount(userDataDir, name) {
  const state = loadAccounts(userDataDir);
  const account = { id: state.nextId, name: name || 'Compte ' + state.nextId };
  state.accounts.push(account);
  state.nextId += 1;
  saveAccounts(userDataDir, state);
  return account;
}

function renameAccount(userDataDir, id, name) {
  const state = loadAccounts(userDataDir);
  const account = state.accounts.find((a) => a.id === id);
  if (!account) return null;
  account.name = name;
  saveAccounts(userDataDir, state);
  return account;
}

function removeAccount(userDataDir, id) {
  const state = loadAccounts(userDataDir);
  const before = state.accounts.length;
  state.accounts = state.accounts.filter((a) => a.id !== id);
  if (state.accounts.length === before) return false;
  saveAccounts(userDataDir, state);
  return true;
}

function reorderAccounts(userDataDir, orderedIds) {
  const state = loadAccounts(userDataDir);
  const byId = new Map(state.accounts.map((a) => [a.id, a]));
  const reordered = [];
  for (const id of orderedIds) {
    if (byId.has(id)) {
      reordered.push(byId.get(id));
      byId.delete(id);
    }
  }
  for (const a of byId.values()) reordered.push(a); // keep any id not in the list
  state.accounts = reordered;
  saveAccounts(userDataDir, state);
  return state.accounts;
}

function partitionFor(id) {
  return 'persist:acct-' + id;
}

module.exports = { loadAccounts, saveAccounts, addAccount, renameAccount, removeAccount, reorderAccounts, partitionFor, accountsPath, DEFAULT };
