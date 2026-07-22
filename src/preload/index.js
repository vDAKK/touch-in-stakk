const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('touch', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),
  getGameUrl: () => ipcRenderer.invoke('game:url'),
  getPatchStatus: () => ipcRenderer.invoke('patch:status'),
  retryPatch: () => ipcRenderer.invoke('patch:retry'),
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  windowClose: () => ipcRenderer.send('window:close'),
});
