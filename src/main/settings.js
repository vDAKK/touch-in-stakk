const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SETTINGS = { resolution: { width: 1440, height: 800 }, muted: false };

function settingsPath(userDataDir) {
  return path.join(userDataDir, 'settings.json');
}

function loadSettings(userDataDir) {
  try {
    const raw = fs.readFileSync(settingsPath(userDataDir), 'utf-8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(userDataDir, partial) {
  fs.mkdirSync(userDataDir, { recursive: true });
  const merged = { ...DEFAULT_SETTINGS, ...partial };
  fs.writeFileSync(settingsPath(userDataDir), JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

module.exports = { loadSettings, saveSettings, settingsPath, DEFAULT_SETTINGS };
