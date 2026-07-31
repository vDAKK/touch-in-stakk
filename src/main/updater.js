'use strict';

// Auto-update (Retouch reproduction). Retouch pulls releases from GitHub via
// electron-updater and notifies the user. We do the same, pointed at a public
// releases repo (build.publish in package.json). No-op in dev / unpackaged.
//
// Status is pushed to the renderer over the 'updater:status' channel so the UI
// can surface "update available / downloading / ready to install".

let started = false;

function initAutoUpdate(app, sendToRenderer, log) {
  if (started) return;
  started = true;

  // Only meaningful for an installed build; skip when running from source.
  if (!app.isPackaged) {
    log && log('updater: skipped (not packaged)');
    return;
  }

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    log && log('updater: electron-updater unavailable — ' + e.message);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const push = (status, extra) => sendToRenderer && sendToRenderer('updater:status', { status, ...(extra || {}) });

  autoUpdater.on('checking-for-update', () => push('checking'));
  autoUpdater.on('update-available', (info) => { log && log('updater: available ' + info.version); push('available', { version: info.version }); });
  autoUpdater.on('update-not-available', () => push('none'));
  autoUpdater.on('download-progress', (p) => push('downloading', { percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => { log && log('updater: downloaded ' + info.version); push('ready', { version: info.version }); });
  autoUpdater.on('error', (err) => { log && log('updater: error ' + (err && err.message)); push('error', { message: err && err.message }); });

  autoUpdater.checkForUpdatesAndNotify().catch((e) => log && log('updater: check failed ' + e.message));

  return {
    quitAndInstall: () => {
      try { autoUpdater.quitAndInstall(); } catch (e) { log && log('updater: install failed ' + e.message); }
    },
  };
}

module.exports = { initAutoUpdate };
