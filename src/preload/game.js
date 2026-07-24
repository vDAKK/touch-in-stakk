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
  var expectInviteFrom = null;
  var expectTimer = null;
  var ownIds = {};          // character ids of the user's other accounts
  var autoAccept = false;   // auto-accept trades/duels coming from those
  var session = { xp: 0, kamas: 0 };
  var lastKamas = null;
  var noConfirm = false;
  var showResources = false;

  function emit(payload) {
    try {
      window.postMessage({ __qol: 'event', payload }, '*');
    } catch (e) {}
  }

  function send(message, data) {
    try {
      window.dofus.sendMessage(message, data);
    } catch (e) {}
  }

  // The client is touch-first and has no keyboard shortcuts, so actions call the
  // game's own window manager (found in the webpack module cache) directly.
  var _wm = null;
  function windowsManager() {
    if (_wm) return _wm;
    try {
      var cache = window.singletons && window.singletons.c;
      for (var k in cache) {
        var ex = cache[k] && cache[k].exports;
        var wm = ex && ex.open && ex.closeAll ? ex : ex && ex.di ? ex.di : null;
        if (wm && typeof wm.open === 'function' && typeof wm.closeAll === 'function' && typeof wm.getWindow === 'function') {
          _wm = wm;
          return _wm;
        }
      }
    } catch (e) {}
    return null;
  }

  // Window ids taken from the game's own menu feature table. Note the hero*
  // variants (equipEntity) are the mercenary windows and stay locked until the
  // hero feature unlocks — the player's own windows are these.
  var ACTION_WINDOW = {
    inventory: ['equipment', undefined],
    character: ['characteristics', undefined],
    spells: ['grimoire', { tabId: 'spells' }],
    quests: ['grimoire', { tabId: 'quests' }],
    jobs: ['grimoire', { tabId: 'jobs' }],
    bestiary: ['grimoire', { tabId: 'bestiary' }],
    achievements: ['grimoire', { tabId: 'achievements' }],
    map: ['worldMap', undefined],
    social: ['social', { tabId: 'friends' }],
    guild: ['social', { tabId: 'guild' }],
    alliance: ['social', { tabId: 'alliance' }],
    market: ['market', { tabId: 'shop' }],
    koliseum: ['arena', undefined],
    dailyQuest: ['dailyQuest', undefined],
    groupSeeker: ['groupSeeker', undefined],
    options: ['options', undefined],
    mount: ['mount', undefined],
  };

  // Select the spell in shortcut-bar slot `index` exactly as tapping it does:
  // the game then casts it on the next map tap.
  function selectSpellSlot(index) {
    try {
      var bar = window.gui.shortcutBars && window.gui.shortcutBars.playerBar;
      var slot = bar && bar.getSpellSlotByIndex ? bar.getSpellSlotByIndex(index) : null;
      if (!slot || (slot.isEmpty && slot.isEmpty()) || !slot.shortcut) return;
      var fighterId = slot.getFighterId ? slot.getFighterId() : window.gui.playerData.id;
      window.gui.emit('spellSlotSelected', fighterId, slot.shortcut.spellId);
    } catch (e) {}
  }

  // The touch client asks to confirm a move or a spell cast (tap once to aim,
  // again to confirm). On desktop that is just an extra click, so switch those
  // options off: walking confirm is a bool, the cast ones use NEVER = 0.
  var _opts = null;
  function optionsStore() {
    if (_opts) return _opts;
    try {
      var cache = window.singletons && window.singletons.c;
      for (var k in cache) {
        var ex = cache[k] && cache[k].exports;
        if (ex && typeof ex === 'object' && 'confirmBoxWhenWalking' in ex) {
          _opts = ex;
          return _opts;
        }
      }
    } catch (e) {}
    return null;
  }

  function applyNoConfirm(on) {
    var o = optionsStore();
    if (!o) return;
    try {
      o.confirmBoxWhenWalking = !on;
      o.confirmBoxWhenClickCasting = on ? 0 : 1;
      o.confirmBoxWhenDragCasting = on ? 0 : 1;
    } catch (e) {}
  }

  // --- Resource overlay -----------------------------------------------------
  // Labels every interactive element (resource) of the map, kept in place by
  // re-projecting its cell through the game's own scene->screen conversion.
  var resOverlay = { on: false, root: null, timer: null, sampled: false };

  function overlayRoot() {
    if (resOverlay.root && resOverlay.root.isConnected) return resOverlay.root;
    var d = document.createElement('div');
    d.id = 'qol-res-overlay';
    d.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9998;';
    document.body.appendChild(d);
    resOverlay.root = d;
    return d;
  }

  function resourcePoints() {
    var out = [];
    try {
      var mr = window.isoEngine && window.isoEngine.mapRenderer;
      if (!mr) return out;
      var els = mr.interactiveElements || {};
      var ident = mr.identifiedElements || {};
      for (var id in els) {
        var el = els[id];
        if (!el) continue;
        var idn = ident[id];
        var cell = el.elementCellId;
        if (cell == null) cell = el.cellId;
        if (cell == null && idn) cell = idn.elementCellId != null ? idn.elementCellId : idn.cellId;
        if (cell == null) continue;
        var name = '';
        try {
          var sk = el.enabledSkills && el.enabledSkills[0];
          name = (sk && (sk.nameId || sk.name)) || '';
        } catch (e) {}
        out.push({ cell: cell, name: name });
      }
      if (!resOverlay.sampled) {
        resOverlay.sampled = true;
        var k = Object.keys(els)[0];
        console.log('[qol-res] elements=' + Object.keys(els).length +
          ' sampleKeys=' + JSON.stringify(k ? Object.keys(els[k]) : null) +
          ' resolved=' + out.length);
      }
    } catch (e) {}
    return out;
  }

  // Probe: retries until the map engine shows up, and reports the real global
  // names so the overlay can bind to whatever this build exposes.
  function diagOnce() {
    if (diagOnce.started) return;
    diagOnce.started = true;
    var tries = 0;
    var iv = setInterval(function () {
      tries += 1;
      var globals = [];
      try {
        for (var k in window) {
          if (/iso|foreground|mapRender|scene/i.test(k)) globals.push(k);
        }
      } catch (e) {}
      var mr = window.isoEngine && window.isoEngine.mapRenderer;
      console.log('[qol-diag] try=' + tries +
        ' iso=' + typeof window.isoEngine +
        ' fg=' + typeof window.foreground +
        ' mr=' + !!mr +
        ' ie=' + (mr && mr.interactiveElements ? Object.keys(mr.interactiveElements).length : -1) +
        ' globals=' + JSON.stringify(globals.slice(0, 25)));
      if (mr) {
        var pick = [];
        for (var f in window.foreground || {}) { if (/convert|scene|screen/i.test(f)) pick.push(f); }
        var key = Object.keys(mr.interactiveElements || {})[0];
        console.log('[qol-diag] fgConv=' + JSON.stringify(pick) +
          ' elemKeys=' + JSON.stringify(key ? Object.keys(mr.interactiveElements[key]) : null));
      }
      // Short, chunked output so it stays readable in the log file.
      function logChunks(tag, arr) {
        for (var c = 0; c < arr.length; c += 5) {
          console.log('[qol-p] ' + tag + c + '=' + JSON.stringify(arr.slice(c, c + 5)));
        }
      }
      // Resource collections, tracked over time (they fill in after map load).
      try {
        var ieN = mr && mr.interactiveElements ? Object.keys(mr.interactiveElements).length : -1;
        var idN = mr && mr.identifiedElements ? Object.keys(mr.identifiedElements).length : -1;
        var stN = mr && mr.statedElements ? Object.keys(mr.statedElements).length : -1;
        console.log('[qol-p] res try=' + tries + ' ie=' + ieN + ' ident=' + idN + ' stated=' + stN);
      } catch (e) {}
      // Anything whose text/attributes mention "entit" (the toggle's label).
      try {
        var hits = [];
        var all = document.querySelectorAll('div,button,span,a');
        for (var n = 0; n < all.length; n++) {
          var el = all[n];
          if (!el.offsetParent) continue; // visible only -> skips the login DOM
          var blob = (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '') +
            '|' + (el.getAttribute('title') || '') + '|' + (el.getAttribute('aria-label') || '');
          if (/entit/i.test(blob)) hits.push(blob.slice(0, 40));
        }
        logChunks('ent', hits.slice(0, 10));
      } catch (e) {}
      // Visible HUD buttons only (login screen is hidden by then).
      try {
        var seen = {};
        var nodes = document.querySelectorAll('div,button,span,a');
        for (var m = 0; m < nodes.length; m++) {
          var el2 = nodes[m];
          if (!el2.offsetParent) continue;
          var c2 = el2.className;
          if (c2 && c2.baseVal !== undefined) c2 = c2.baseVal;
          if (typeof c2 !== 'string' || !c2) continue;
          if (!/btn|button|icon|toggle/i.test(c2)) continue;
          if (/splash|login|lang|forum|social|discord|beta|continue|playOther/i.test(c2)) continue;
          seen[c2.slice(0, 26)] = 1;
        }
        logChunks('btn', Object.keys(seen).slice(0, 30));
      } catch (e) {}
      var found = mr && mr.interactiveElements && Object.keys(mr.interactiveElements).length > 0;
      if (found || tries > 15) clearInterval(iv);
    }, 3000);
  }

  // Click the game's own "show entities" HUD toggle (the one that pops the
  // monster group boxes). Located in the DOM because its label lives in the
  // language files, not the script bundle.
  function clickEntitiesToggle() {
    try {
      var el =
        document.querySelector('[class*="showEntities" i]') ||
        document.querySelector('[class*="entit" i]');
      if (!el) return false;
      ['mousedown', 'mouseup', 'click'].forEach(function (t) {
        el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
      });
      return true;
    } catch (e) {}
    return false;
  }

  // Session gains read straight from playerData (message names vary by build).
  var base = { xp: null, kamas: null };
  function readGains() {
    try {
      var pd = window.gui && window.gui.playerData;
      if (!pd) return;
      var xp = null;
      if (pd.experience != null) xp = pd.experience;
      else if (pd.characteristics && pd.characteristics.experience != null) xp = pd.characteristics.experience;
      var kamas = null;
      if (pd.kamas != null) kamas = pd.kamas;
      else if (pd.inventory && pd.inventory.kamas != null) kamas = pd.inventory.kamas;
      if (xp == null && kamas == null) return;
      if (base.xp == null) { base.xp = xp; base.kamas = kamas; return; }
      session.xp = xp != null && base.xp != null ? xp - base.xp : session.xp;
      session.kamas = kamas != null && base.kamas != null ? kamas - base.kamas : session.kamas;
      emit({ type: 'stats', xp: session.xp, kamas: session.kamas });
    } catch (e) {}
  }

  function drawResourceOverlay() {
    diagOnce();
    var mr = window.isoEngine && window.isoEngine.mapRenderer;
    var fg = window.foreground;
    if (!mr || !fg || typeof fg.convertSceneToScreenCoordinate !== 'function' || typeof mr.getCellSceneCoordinate !== 'function') return;
    var root = overlayRoot();
    root.innerHTML = '';
    resourcePoints().forEach(function (p) {
      try {
        var sc = mr.getCellSceneCoordinate(p.cell);
        if (!sc) return;
        var s = fg.convertSceneToScreenCoordinate(sc.x, sc.y);
        if (!s || s.x == null) return;
        var tag = document.createElement('div');
        tag.textContent = p.name || '•';
        tag.style.cssText =
          'position:absolute;transform:translate(-50%,-100%);left:' + s.x + 'px;top:' + s.y +
          'px;background:rgba(14,18,22,.82);color:#2fd08a;font:11px/1.4 system-ui,sans-serif;' +
          'padding:1px 5px;border-radius:4px;white-space:nowrap;';
        root.appendChild(tag);
      } catch (e) {}
    });
  }

  function setResourceOverlay(on) {
    resOverlay.on = !!on;
    if (resOverlay.timer) {
      clearInterval(resOverlay.timer);
      resOverlay.timer = null;
    }
    if (!resOverlay.on) {
      if (resOverlay.root) resOverlay.root.innerHTML = '';
      return;
    }
    drawResourceOverlay();
    resOverlay.timer = setInterval(drawResourceOverlay, 300);
  }

  // Open the window the same way the game's menu button does (no forceToOpen —
  // that opens the shell but skips the content load); re-press closes it.
  function doAction(action) {
    if (action === 'entities') {
      clickEntitiesToggle();
      return;
    }
    var spell = /^spell(\d+)$/.exec(action);
    if (spell) {
      selectSpellSlot(Number(spell[1]) - 1);
      return;
    }
    var wm = windowsManager();
    if (!wm) return;
    if (action === 'close') {
      try { wm.closeAll(); } catch (e) {}
      return;
    }
    var w = ACTION_WINDOW[action];
    if (!w) return;
    try {
      var win = wm.getWindow(w[0]);
      if (win && win.openState) wm.close(w[0]);
      else wm.open(w[0], w[1]);
    } catch (e) {}
  }

  // Commands from the renderer host (relayed by the preload as window messages).
  window.addEventListener('message', function (e) {
    if (!e.data || e.data.__qol !== 'cmd') return;
    var p = e.data.payload;
    if (!p) return;
    if (p.type === 'invite' && p.names) {
      p.names.forEach(function (name) {
        send('PartyInvitationRequestMessage', { name: name });
      });
    } else if (p.type === 'expect-invite') {
      // Auto-accept the next party invite from this leader (own account), briefly.
      expectInviteFrom = p.from;
      if (expectTimer) clearTimeout(expectTimer);
      expectTimer = setTimeout(function () { expectInviteFrom = null; }, 20000);
    } else if (p.type === 'follow') {
      // Toggle the game's native party-follow on this member toward the leader.
      try {
        var pd = window.gui && window.gui.playerData && window.gui.playerData.partyData;
        var party = pd && pd.getClassicalParty && pd.getClassicalParty();
        if (party && party.partyId) {
          send('PartyFollowThisMemberRequestMessage', {
            partyId: party.partyId,
            playerId: p.leaderId,
            enabled: p.enabled !== false,
          });
        }
      } catch (e) {}
    } else if (p.type === 'ready') {
      send('GameFightReadyMessage', { isReady: p.value !== false });
    } else if (p.type === 'action') {
      doAction(p.action);
    } else if (p.type === 'resource-overlay') {
      showResources = !!p.on;
      setResourceOverlay(showResources);
    } else if (p.type === 'no-confirm') {
      noConfirm = !!p.on;
      applyNoConfirm(noConfirm);
    } else if (p.type === 'own-accounts') {
      ownIds = {};
      (p.ids || []).forEach(function (id) { ownIds[id] = true; });
      autoAccept = !!p.autoAccept;
    }
  });

  function onGuiReady(gui) {
    if (noConfirm) applyNoConfirm(true);
    if (showResources) setResourceOverlay(true);
    diagOnce();
    readGains();
    setInterval(readGains, 4000);

    // Report this account's character so the host can coordinate accounts.
    try {
      var ci = gui.playerData && gui.playerData.characterBaseInformations;
      if (ci) emit({ type: 'identity', name: ci.name, id: gui.playerData.id });
    } catch (e) {}

    // A fighter's turn started. For our own character the fighter id equals the
    // player id, so tell the host it is this account's turn.
    gui.on('GameFightTurnStartMessage', function (msg) {
      try {
        if (msg && msg.id === gui.playerData.id) emit({ type: 'my-turn' });
      } catch (e) {}
    });

    // Auto-accept a party invite when it comes from the expected leader.
    gui.on('PartyInvitationMessage', function (msg) {
      try {
        if (expectInviteFrom && msg && msg.fromName === expectInviteFrom) {
          send('PartyAcceptInvitationMessage', { partyId: msg.partyId });
          expectInviteFrom = null;
        }
      } catch (e) {}
    });

    // A private message (whisper) was received on this account.
    gui.on('ChatServerMessage', function (msg) {
      try {
        // PSEUDO_CHANNEL_PRIVATE = 9; ignore our own outgoing whispers.
        if (msg && msg.channel === 9 && msg.senderId !== gui.playerData.id) {
          emit({ type: 'whisper', from: msg.senderName });
        }
      } catch (e) {}
    });

    // This account lost its connection to the game server.
    gui.on('disconnect', function () {
      emit({ type: 'disconnected' });
    });

    // Auto-accept a trade coming from one of the user's own accounts.
    gui.on('ExchangeRequestedTradeMessage', function (msg) {
      try {
        if (autoAccept && msg && ownIds[msg.source]) send('ExchangeAcceptMessage', {});
      } catch (e) {}
    });

    // Same for a friendly duel request from one of the user's own accounts.
    gui.on('GameRolePlayPlayerFightFriendlyRequestedMessage', function (msg) {
      try {
        if (autoAccept && msg && ownIds[msg.sourceId]) {
          send('GameRolePlayPlayerFightFriendlyAnswerMessage', { fightId: msg.fightId, accept: true });
        }
      } catch (e) {}
    });

  }

  function ready() {
    return (
      window.gui &&
      typeof window.gui.on === 'function' &&
      window.gui.playerData &&
      window.gui.playerData.characterBaseInformations &&
      window.gui.playerData.characterBaseInformations.name &&
      window.dofus &&
      typeof window.dofus.sendMessage === 'function'
    );
  }

  var tries = 0;
  var iv = setInterval(function () {
    tries += 1;
    if (ready()) {
      clearInterval(iv);
      onGuiReady(window.gui);
    } else if (tries > 600) {
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

// The client draws letterbox bars (.blackStripe) around the play area. Hide them
// so the game fills the window instead of leaving black margins.
function injectLayoutFix() {
  const style = document.createElement('style');
  style.textContent = '.blackStripe { display: none !important; }';
  (document.head || document.documentElement).appendChild(style);
}

// main-world hook -> renderer host
window.addEventListener('message', (e) => {
  if (!e.data || e.data.__qol !== 'event') return;
  ipcRenderer.sendToHost('qol', e.data.payload);
});

// renderer host -> main-world hook
ipcRenderer.on('qol', (_e, payload) => {
  window.postMessage({ __qol: 'cmd', payload }, '*');
});

// Whether this webview is the active broadcast source (set by the host).
let bcastSource = false;
ipcRenderer.on('bcast-mode', (_e, on) => {
  bcastSource = !!on;
});

// User keybinds for this account: triggerKey -> action id.
let keyToAction = {};
ipcRenderer.on('keybinds', (_e, map) => {
  keyToAction = map || {};
});

function isTyping() {
  const el = document.activeElement;
  return !!(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable));
}

// Reserved launcher hotkeys. This preload sees keydown even while the game has
// focus, so forward our shortcuts to the host and stop the game from also acting.
window.addEventListener(
  'keydown',
  (e) => {
    let hk = null;
    if (e.key === 'F2' && !e.ctrlKey && !e.altKey) hk = { name: 'ready-all' };
    else if (e.ctrlKey && e.key >= '1' && e.key <= '9') hk = { name: 'switch', index: Number(e.key) - 1 };
    else if (e.ctrlKey && e.key === 'Tab') hk = { name: 'cycle', dir: e.shiftKey ? -1 : 1 };
    if (hk) {
      e.preventDefault();
      e.stopPropagation();
      ipcRenderer.sendToHost('hotkey', hk);
      return;
    }
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey && !isTyping();
    const action = plain ? keyToAction[e.key] : null;
    // A bound key triggers its game action on this (active) account, and mirrors
    // it to the other accounts when broadcast is on.
    if (action) {
      e.preventDefault();
      e.stopPropagation();
      window.postMessage({ __qol: 'cmd', payload: { type: 'action', action } }, '*');
      if (bcastSource) ipcRenderer.sendToHost('bcast-action', { action });
      return;
    }
    // Broadcast other plain key presses too (some game inputs are key-driven).
    if (bcastSource && plain) {
      ipcRenderer.sendToHost('bcast-key', { key: e.key });
    }
  },
  true
);

function injectAll() {
  injectHook();
  injectLayoutFix();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectAll);
} else {
  injectAll();
}
