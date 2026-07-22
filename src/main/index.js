const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { loadSettings, saveSettings } = require('./settings');
const { fetchPatchSet, lindoFilesFromManifest, fetchAppVersion, FALLBACK_APP_VERSION } = require('./patcher');
const { startProxy } = require('./proxy');
const { installSpoofing } = require('./spoof');

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
  proxy = await startProxy({ regexMap, lindoFiles, versions });
  return patchOk;
}

function installDiagnostics() {
  session.defaultSession.webRequest.onErrorOccurred((details) => {
    if (details.error && details.error !== 'net::ERR_ABORTED') {
      logToFile('req-error ' + details.error + ' ' + details.url);
    }
  });
  app.on('web-contents-created', (_e, contents) => {
    if (contents.getType() !== 'webview') return;
    contents.on('did-fail-load', (_e2, code, desc, url) => {
      logToFile('webview did-fail-load ' + code + ' ' + desc + ' ' + url);
    });
    contents.on('console-message', (_e2, level, message, line, sourceId) => {
      logToFile('webview console[' + level + '] ' + message + ' (' + sourceId + ':' + line + ')');
    });
  });
}

async function boot() {
  logToFile('=== boot start ===');
  installSpoofing(session.defaultSession);
  installDiagnostics();
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
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAnkamaHost(url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

ipcMain.handle('settings:get', () => loadSettings(userDataDir()));
ipcMain.handle('settings:set', (_e, partial) => saveSettings(userDataDir(), partial));
ipcMain.handle('game:url', () => `http://127.0.0.1:${proxy.port}/game/index.html`);
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('patch:status', () => patchOk);
ipcMain.handle('patch:retry', () => startOrRestartProxy());
ipcMain.on('window:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('window:toggle-maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow && mainWindow.close());

app.whenReady().then(boot);
app.on('window-all-closed', () => {
  if (proxy) proxy.close();
  if (process.platform !== 'darwin') app.quit();
});
