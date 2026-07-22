// Preload for each account's game webview. It does two things:
//  1. injects a main-world hook that subscribes to the game's own event bus
//     (window.gui) — the game runs in the page's main world, which this
//     isolated preload cannot touch directly, so we inject a <script>;
//  2. relays messages between that main-world hook and the renderer host
//     (the tab manager) over window.postMessage <-> ipcRenderer.sendToHost.
const { ipcRenderer } = require('electron');

// Runs in the page's MAIN world. No node/ipc access here — it talks to the
// preload only through window.postMessage, so the game keeps no privileged refs.
function gameHook() {
  function emit(payload) {
    try {
      window.postMessage({ __qol: 'event', payload }, '*');
    } catch (e) {}
  }

  function onGuiReady(gui) {
    // A fighter's turn started. For our own character the fighter id equals the
    // player id, so tell the host it is this account's turn.
    gui.on('GameFightTurnStartMessage', function (msg) {
      try {
        var myId = gui.playerData && gui.playerData.id;
        if (msg && msg.id === myId) emit({ type: 'my-turn' });
      } catch (e) {}
    });
  }

  var tries = 0;
  var iv = setInterval(function () {
    tries += 1;
    if (window.gui && typeof window.gui.on === 'function' && window.gui.playerData) {
      clearInterval(iv);
      onGuiReady(window.gui);
    } else if (tries > 240) {
      clearInterval(iv);
    }
  }, 500);
}

function injectHook() {
  const script = document.createElement('script');
  script.textContent = '(' + gameHook.toString() + ')();';
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

// main-world hook -> renderer host
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.__qol !== 'event') return;
  ipcRenderer.sendToHost('qol', e.data.payload);
});

// renderer host -> main-world hook
ipcRenderer.on('qol', (_e, payload) => {
  window.postMessage({ __qol: 'cmd', payload }, '*');
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectHook);
} else {
  injectHook();
}
