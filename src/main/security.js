'use strict';

// Local flag/ban registry — the defensive half of the Retouch machine-ban study.
//
// Retouch checks each machine-id against a central MySQL `machine_bans` table and
// refuses to launch when banned. We reproduce the SHAPE (fingerprint -> check ->
// block) but keep it self-contained: the store is a JSON file in userData that
// the operator controls. Nothing here touches a live server or bans third-party
// Dofus players — it only gates THIS launcher.
//
// The honeypot ties in here: enabling the (non-functional) auto-harvest toggle in
// the admin menu calls flag(id, 'auto-harvest-enabled'). Flags are the tripwire;
// promoting a flagged machine to `bans` is a manual operator decision.

const fs = require('node:fs');
const path = require('node:path');

function storePath(userDataDir) {
  return path.join(userDataDir, 'security.json');
}

function load(userDataDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(userDataDir), 'utf8'));
    return {
      bans: Array.isArray(parsed.bans) ? parsed.bans : [],
      flags: Array.isArray(parsed.flags) ? parsed.flags : [],
    };
  } catch {
    return { bans: [], flags: [] };
  }
}

function save(userDataDir, store) {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(storePath(userDataDir), JSON.stringify(store, null, 2), 'utf8');
  return store;
}

function isBanned(userDataDir, machineId) {
  return load(userDataDir).bans.some((b) => b.machineId === machineId);
}

// Records a tripwire hit. `at` is injected (main has no Date restriction, but we
// keep it explicit so tests are deterministic). Deduped-append per (id, reason).
function flag(userDataDir, machineId, reason, meta, at) {
  const store = load(userDataDir);
  store.flags.push({ machineId, reason, meta: meta || null, at: at || null });
  return save(userDataDir, store);
}

function ban(userDataDir, machineId, reason, at) {
  const store = load(userDataDir);
  if (!store.bans.some((b) => b.machineId === machineId)) {
    store.bans.push({ machineId, reason: reason || null, at: at || null });
  }
  return save(userDataDir, store);
}

function unban(userDataDir, machineId) {
  const store = load(userDataDir);
  store.bans = store.bans.filter((b) => b.machineId !== machineId);
  return save(userDataDir, store);
}

module.exports = { load, isBanned, flag, ban, unban, storePath };
