const fs = require('node:fs');
const path = require('node:path');

// resolutionSet stays false until the user picks a size themselves; while it
// is false the window opens at the screen's usable area instead of the
// nominal default below.
// lang stays null until the user picks one; while it is null the interface
// follows the system locale (French machine -> French, anything else English).
const DEFAULT_SETTINGS = { lang: null, resolution: { width: 1440, height: 800 }, resolutionSet: false, muted: false, muteInactive: false, switchOnTurn: true, notifications: true, autoAcceptOwn: true, noConfirm: true, showResources: false, entitiesSelector: null, autoAcceptGroup: false, joinLeaderFight: false, hideShop: false, tabBarSide: false, keybinds: {}, android: { enabled: false, adbPath: 'adb.exe', address: '127.0.0.1:58526', packageName: '' } };

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
      android: { ...DEFAULT_SETTINGS.android, ...(parsed.android || {}) },
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
    android: { ...DEFAULT_SETTINGS.android, ...((partial && partial.android) || {}) },
  };
  fs.writeFileSync(settingsPath(userDataDir), JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

module.exports = { loadSettings, saveSettings, settingsPath, DEFAULT_SETTINGS };
