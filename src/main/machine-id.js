'use strict';

// Hardware fingerprint — reproduces Retouch's machine-id technique for study.
// Retouch reads the Windows registry MachineGuid (survives reinstalls, harder
// to spoof than a random file), hashes it under a versioned namespace, and
// falls back to a persisted random id when the registry read fails.
//
// This is the same fingerprint an anti-cheat / kill-switch uses to identify a
// machine across account changes. It is intentionally self-contained here: the
// id only ever feeds THIS launcher's local flag/ban list (see security.js).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const NAMESPACE = 'stakk-machine-id-v1';

function readRegistryGuid() {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
      { encoding: 'utf8', windowsHide: true, timeout: 4000 }
    );
    const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function fallbackPath(userDataDir) {
  return path.join(userDataDir, 'machine-id-fallback.json');
}

// Stable per-install id when the registry is unavailable (non-Windows, locked
// registry, etc.). Persisted so it stays constant across launches.
function readFallbackId(userDataDir) {
  const file = fallbackPath(userDataDir);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed.id === 'string') return parsed.id;
  } catch {}
  const id = crypto.randomUUID();
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ id }, null, 2), 'utf8');
  } catch {}
  return id;
}

function hash(seed) {
  return crypto.createHash('sha256').update(NAMESPACE + ':' + seed).digest('hex');
}

let cached = null;

// Returns { id, source }. source: 'registry' | 'fallback'.
function getMachineId(userDataDir) {
  if (cached) return cached;
  const guid = readRegistryGuid();
  cached = guid
    ? { id: hash(guid), source: 'registry' }
    : { id: hash(readFallbackId(userDataDir)), source: 'fallback' };
  return cached;
}

module.exports = { getMachineId, _hash: hash, NAMESPACE };
