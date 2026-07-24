const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SETTINGS = { resolution: { width: 1440, height: 800 }, muted: false, switchOnTurn: true, notifications: true, autoAcceptOwn: true, noConfirm: true, keybinds: {} };

function settingsPath(userDataDir) {
  return path.join(userDataDir, 'settings.json');
}

function loadSettings(userDataDir) {
  try {
    const raw = fs.readFileSync(settingsPath(userDataDir), 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      resolution: { ...DEFAULT_SETTINGS.resolution, ...(parsed.resolution || {}) },
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(userDataDir, partial) {
  fs.mkdirSync(userDataDir, { recursive: true });
  const merged = {
    ...DEFAULT_SETTINGS,
    ...partial,
    resolution: { ...DEFAULT_SETTINGS.resolution, ...((partial && partial.resolution) || {}) },
  };
  fs.writeFileSync(settingsPath(userDataDir), JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

module.exports = { loadSettings, saveSettings, settingsPath, DEFAULT_SETTINGS };
