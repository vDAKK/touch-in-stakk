const { app, BrowserWindow, ipcMain, session, shell, webContents } = require('electron');

// Same reason as backgroundThrottling below, at the process level: without
// these Chromium still freezes timers and rendering for occluded/background
// pages, so an unfocused account stops moving.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { loadSettings, saveSettings } = require('./settings');
const { fetchPatchSet, lindoFilesFromManifest, fetchAppVersion, FALLBACK_APP_VERSION } = require('./patcher');
const { startProxy } = require('./proxy');
const { prepareSession } = require('./session-prep');
const { loadAccounts, addAccount, renameAccount, removeAccount, reorderAccounts } = require('./accounts');
const { initAutoUpdate } = require('./updater');

let updater = null;

// Fixed so the game's origin (http://127.0.0.1:<port>) is stable across
// launches and the saved session (cookies/localStorage) is found on relaunch.
const GAME_PROXY_PORT = 28590;

let mainWindow = null;
let proxy = null;
let patchOk = false;

function userDataDir() {
  return app.getPath('userData');
}

function logToFile(message) {
  try {
    const dir = path.join(userDataDir(), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const line = '[' + new Date().toISOString() + '] ' + message + '\n';
    fs.appendFileSync(path.join(dir, 'app.log'), line, 'utf-8');
  } catch {
    // logging must never crash the app
  }
}

const ANKAMA_HOSTS = ['ankama.com', 'ankama-games.com'];
function isAnkamaHost(url) {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return ANKAMA_HOSTS.some((h) => host === h || host.endsWith('.' + h));
}

// Fetches the community patch set and (re)starts the local proxy with it.
// On failure the proxy still starts (with no patches) so the app never hangs;
// patchOk lets the renderer surface the problem and offer a retry.
async function startOrRestartProxy() {
  let regexMap = {};
  let lindoFiles = {};
  try {
    const patchSet = await fetchPatchSet();
    regexMap = patchSet.regexMap;
    lindoFiles = lindoFilesFromManifest(patchSet.manifest);
    patchOk = true;
    logToFile('patch fetch OK, files=' + Object.keys(lindoFiles).join(','));
  } catch (e) {
    patchOk = false;
    logToFile('patch fetch FAILED: ' + e.message + ' | code=' + (e.code || '') + ' | ' + String(e.stack || '').split('\n')[0]);
  }
  const appVersion = await fetchAppVersion().catch(() => FALLBACK_APP_VERSION);
  const versions = { appVersion, buildVersion: appVersion };
  if (proxy) proxy.close();
  proxy = await startProxy({ regexMap, lindoFiles, versions, port: GAME_PROXY_PORT });
  return patchOk;
}

// --- Auth callback capture ---------------------------------------------------
// The game opens the Ankama login in a popup. On success Ankama redirects the
// popup to `dofustouch://...?code=<code>` (a custom scheme the browser cannot
// load). We intercept that navigation, close the popup, and hand the code back
// to the game by invoking its own deep-link entry point, exactly as the Android
// wrapper would.
const AUTH_CALLBACK_SCHEME = 'dofustouch://';

function isAuthCallbackUrl(url) {
  return typeof url === 'string' && url.startsWith(AUTH_CALLBACK_SCHEME);
}

function parseAuthCallback(url) {
  const qs = url.split('?')[1] || '';
  const params = new URLSearchParams(qs);
  return { code: params.get('code') || undefined, error: params.get('error') || undefined };
}

function buildAuthCompletionScript(payload) {
  return (
    '(function(){' +
    'var cache=window.singletons&&window.singletons.c;' +
    'if(!cache)return false;' +
    'for(var m in cache){' +
    'var c=cache[m]&&cache[m].exports;' +
    "if(c&&typeof c.connectThroughIonicDeepLink==='function'){" +
    'c.connectThroughIonicDeepLink(' + JSON.stringify(payload) + ');return true;}' +
    '}return false;})();'
  );
}

function interceptAuthRedirect(popupContents, deliver) {
  const handle = (url, via, prevent) => {
    if (!isAuthCallbackUrl(url)) return;
    prevent();
    logToFile('captured auth callback via ' + via + ' ' + url);
    deliver(url);
  };
  popupContents.on('will-frame-navigate', (e) => handle(e.url, 'will-frame-navigate', () => e.preventDefault()));
  popupContents.on('will-redirect', (e) => handle(e.url, 'will-redirect', () => e.preventDefault()));
  popupContents.on('will-navigate', (e) => handle(e.url, 'will-navigate', () => e.preventDefault()));
}

function installGameWebviewHandlers() {
  app.on('web-contents-created', (_e, contents) => {
    if (contents.getType() !== 'webview') return;

    contents.on('did-fail-load', (_e2, code, desc, url) => {
      logToFile('webview did-fail-load ' + code + ' ' + desc + ' ' + url);
    });
    contents.on('console-message', (_e2, level, message, line, sourceId) => {
      logToFile('webview console[' + level + '] ' + message + ' (' + sourceId + ':' + line + ')');
    });

    contents.setWindowOpenHandler(({ url }) => {
      if (isAnkamaHost(url)) return { action: 'allow' };
      shell.openExternal(url);
      return { action: 'deny' };
    });

    contents.on('did-create-window', (popup) => {
      logToFile('auth popup created');
      interceptAuthRedirect(popup.webContents, (callbackUrl) => {
        if (!popup.isDestroyed()) popup.close();
        contents.executeJavaScript(buildAuthCompletionScript(parseAuthCallback(callbackUrl)));
      });
    });
  });
}

async function boot() {
  logToFile('=== boot start ===');
  // Spoofing/blocking/logging is installed per session so every account
  // partition is covered, not just the default session.
  app.on('session-created', (sess) => prepareSession(sess, logToFile));
  prepareSession(session.defaultSession, logToFile);
  installGameWebviewHandlers();
  await startOrRestartProxy();
  logToFile('boot: patchOk=' + patchOk + ' proxyPort=' + (proxy && proxy.port));

  const settings = loadSettings(userDataDir());
  mainWindow = new BrowserWindow({
    width: settings.resolution.width,
    height: settings.resolution.height,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    backgroundColor: '#14161c',
    title: 'Touch in STAKK',
    icon: path.join(__dirname, '../../stakk.ico'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      // Chromium throttles timers and rendering in background windows, which
      // stalls anything time-based in the game (travel hops, follow, timers)
      // whenever the launcher is not focused.
      backgroundThrottling: false,
    },
  });

  // Keep the game area at the client's aspect ratio (the chrome — titlebar +
  // tab bar — is the fixed extra height), so resizing does not letterbox it.
  mainWindow.setAspectRatio(1440 / 800, { width: 0, height: 80 });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAnkamaHost(url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  updater = initAutoUpdate(app, (ch, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ch, payload);
  }, logToFile);
}

ipcMain.handle('settings:get', () => loadSettings(userDataDir()));
ipcMain.handle('settings:set', (_e, partial) => {
  const saved = saveSettings(userDataDir(), partial);
  // Apply a new window size on the spot (unless the window is maximized or
  // fullscreen, where a fixed size would make no sense).
  if (
    partial && partial.resolution && mainWindow && !mainWindow.isDestroyed() &&
    !mainWindow.isMaximized() && !mainWindow.isFullScreen()
  ) {
    mainWindow.setSize(saved.resolution.width, saved.resolution.height);
  }
  return saved;
});
ipcMain.handle('game:url', () => `http://127.0.0.1:${proxy.port}/game/index.html`);
ipcMain.handle('game:preload-path', () => pathToFileURL(path.join(__dirname, '../preload/game.js')).href);
ipcMain.handle('app:version', () => app.getVersion());
// Open a link in the user's default browser. Restricted to https so a
// compromised renderer can't launch arbitrary schemes/executables.
ipcMain.handle('app:open-external', (_e, url) => {
  if (typeof url === 'string' && /^https:\/\//i.test(url)) shell.openExternal(url);
  return true;
});
ipcMain.handle('patch:status', () => patchOk);
ipcMain.handle('patch:retry', () => startOrRestartProxy());
ipcMain.handle('accounts:list', () => loadAccounts(userDataDir()));
ipcMain.handle('accounts:add', (_e, name) => addAccount(userDataDir(), name));
ipcMain.handle('accounts:rename', (_e, id, name) => renameAccount(userDataDir(), id, name));
ipcMain.handle('accounts:remove', (_e, id) => removeAccount(userDataDir(), id));
ipcMain.handle('accounts:reorder', (_e, ids) => reorderAccounts(userDataDir(), ids));
// Inject a real key event into each target account's game webview (multibox
// broadcast). sendInputEvent produces trusted input the game acts on.
ipcMain.handle('broadcast:key', (_e, wcIds, key) => {
  for (const id of wcIds) {
    const wc = webContents.fromId(id);
    if (!wc || wc.isDestroyed()) continue;
    wc.sendInputEvent({ type: 'keyDown', keyCode: key });
    if (typeof key === 'string' && key.length === 1) wc.sendInputEvent({ type: 'char', keyCode: key });
    wc.sendInputEvent({ type: 'keyUp', keyCode: key });
  }
  return true;
});
ipcMain.handle('session:prepare', (_e, partition) => {
  prepareSession(session.fromPartition(partition), logToFile);
  return true;
});
// Renderer-side diagnostics (window-id/travel probes) land in app.log so they
// can be read back off disk without the game console.
ipcMain.on('debug:log', (_e, tag, data) => {
  try { logToFile(String(tag) + ' ' + JSON.stringify(data)); } catch { logToFile(String(tag) + ' <unserializable>'); }
});
ipcMain.on('window:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('window:toggle-maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow && mainWindow.close());
ipcMain.on('window:toggle-fullscreen', () => {
  if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
});
// An account needs attention (combat turn, whisper) while the launcher isn't
// focused: flash the taskbar entry so the user notices without stealing focus.
ipcMain.on('window:attention', () => {
  if (mainWindow && !mainWindow.isFocused()) mainWindow.flashFrame(true);
});
ipcMain.handle('updater:install', () => {
  if (updater) updater.quitAndInstall();
});

app.whenReady().then(boot);
app.on('window-all-closed', () => {
  if (proxy) proxy.close();
  if (process.platform !== 'darwin') app.quit();
});
