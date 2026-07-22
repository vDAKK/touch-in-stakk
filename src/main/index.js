const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('node:path');
const { loadSettings, saveSettings } = require('./settings');
const { fetchPatchSet } = require('./patcher');
const { startProxy } = require('./proxy');
const { installSpoofing } = require('./spoof');

let mainWindow = null;
let proxy = null;

function userDataDir() {
  return app.getPath('userData');
}

async function boot() {
  installSpoofing(session.defaultSession);

  let regexMap = {};
  try {
    ({ regexMap } = await fetchPatchSet());
  } catch (e) {
    console.error('patch manifest fetch failed:', e.message);
  }
  proxy = await startProxy({ regexMap });

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
    if (url.includes('ankama.com')) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

ipcMain.handle('settings:get', () => loadSettings(userDataDir()));
ipcMain.handle('settings:set', (_e, partial) => saveSettings(userDataDir(), partial));
ipcMain.handle('game:url', () => `http://127.0.0.1:${proxy.port}/game/index.html`);
ipcMain.handle('app:version', () => app.getVersion());
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
