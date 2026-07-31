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
  var autoAcceptGroup = false;
  var hideShop = false;

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
    toa: ['TOA', { tabId: 'general' }],
    titles: ['grimoire', { tabId: 'ornaments' }],
    options: ['options', undefined],
    mount: ['mount', undefined],
  };

  // Select the spell in shortcut-bar slot `index` exactly as tapping it does:
  // the game then casts it on the next map tap.
  function selectSpellSlot(index) {
    try {
      var pd = window.gui.playerData;
      var mgr = window.gui.shortcutBarManager;
      var bar = mgr && mgr.shortcutBars && mgr.shortcutBars.playerBar;
      var slot = bar && bar.getSpellSlotByIndex ? bar.getSpellSlotByIndex(index) : null;
      var spellId = slot && slot.shortcut && slot.shortcut.spellId;
      if (spellId == null && pd && pd.spellShortcuts) {
        for (var i = 0; i < pd.spellShortcuts.length; i++) {
          if (pd.spellShortcuts[i].slotIndex === index) { spellId = pd.spellShortcuts[i].spellId; break; }
        }
      }
      if (spellId == null) return;
      window.gui.emit('spellSlotSelected', pd.id, spellId);
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

  // Mule follow: mirror the leader's exact cell on the same map (the native
  // party-follow only handles map changes, not intra-map positioning). Uses the
  // client's own _movePlayerOnMap, guarded on map-load state like Retouch does.
  function readPosition() {
    try {
      var iso = window.isoEngine;
      var am = window.actorManager;
      var mapId = iso && iso.mapRenderer ? iso.mapRenderer.mapId : null;
      var cellId = am && am.userActor ? am.userActor.cellId : null;
      return { mapId: mapId, cellId: cellId };
    } catch (e) { return { mapId: null, cellId: null }; }
  }

  function muleFollow(mapId, cellId) {
    try {
      var iso = window.isoEngine;
      var am = window.actorManager;
      if (!iso || !am || !am.userActor || !iso.mapRenderer || !iso.mapRenderer.isReady) return;
      if (iso.mapRenderer.mapId !== mapId) return; // different map -> native party-follow handles it
      if (am.userActor.moving || am.userActor.cellId === cellId) return;
      iso._movePlayerOnMap(cellId, false);
    } catch (e) {}
  }

  // Hide the real-money shop button from the HUD.
  var shopStyle = null;
  function setHideShop(on) {
    if (on) {
      if (shopStyle) return;
      shopStyle = document.createElement('style');
      shopStyle.textContent = '.shopBtn, .menuIconGoultine, .menuIconGoultineAnimated { display: none !important; }';
      (document.head || document.documentElement).appendChild(shopStyle);
    } else if (shopStyle) {
      shopStyle.remove();
      shopStyle = null;
    }
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

  // Click the game's own "show entities" HUD toggle (the one that pops the
  // monster group boxes). Located in the DOM because its label lives in the
  // language files, not the script bundle.
  var entitiesSelector = null;

  function cssPathOf(el) {
    // Build a short, stable selector from the element's own classes.
    var c = el.className;
    if (c && c.baseVal !== undefined) c = c.baseVal;
    if (typeof c === 'string' && c.trim()) {
      return el.tagName.toLowerCase() + '.' + c.trim().split(/\s+/).join('.');
    }
    return null;
  }

  // One-shot: the next click in the game records its target as the toggle.
  function captureEntitiesButton() {
    var onClick = function (ev) {
      document.removeEventListener('click', onClick, true);
      var sel = cssPathOf(ev.target) || (ev.target.parentElement && cssPathOf(ev.target.parentElement));
      if (sel) {
        entitiesSelector = sel;
        emit({ type: 'entities-selector', selector: sel });
      }
    };
    document.addEventListener('click', onClick, true);
  }

  function clickEntitiesToggle() {
    try {
      if (!entitiesSelector) return false;
      var el = document.querySelector(entitiesSelector);
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

  // Some HUD entries aren't plain windows (zaap teleport, goultines shop), so —
  // like Retouch — trigger them by clicking their menu icon, which runs the
  // game's own full flow.
  var MENU_ICON = {
    zaap: 'menuIconZaap',
    goultines: 'menuIconGoultine',
  };
  function clickMenuIcon(cls) {
    try {
      var el = document.querySelector('.' + cls);
      if (!el) return;
      ['mousedown', 'mouseup', 'click'].forEach(function (t) {
        el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
      });
    } catch (e) {}
  }

  // Open the window the same way the game's menu button does (no forceToOpen —
  // that opens the shell but skips the content load); re-press closes it.
  function doAction(action) {
    if (MENU_ICON[action]) {
      clickMenuIcon(MENU_ICON[action]);
      return;
    }
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
    } else if (p.type === 'capture-entities') {
      captureEntitiesButton();
    } else if (p.type === 'entities-selector') {
      entitiesSelector = p.selector || null;
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
      autoAcceptGroup = !!p.autoAcceptGroup;
    } else if (p.type === 'hide-shop') {
      hideShop = !!p.on;
      setHideShop(hideShop);
    } else if (p.type === 'get-position') {
      var pos = readPosition();
      emit({ type: 'position', mapId: pos.mapId, cellId: pos.cellId });
    } else if (p.type === 'mule-follow') {
      muleFollow(p.mapId, p.cellId);
    } else if (p.type === 'auto-harvest') {
      setAutoHarvest(!!p.on);
    }
  });

  // --- HONEYPOT: auto-harvest tripwire ---------------------------------------
  // Retouch's mule auto-collects interactives (__muleInteractive) and travels to
  // a target map on its own — an autonomous farming bot. We ship the feature's
  // SHAPE as bait: the toggle lives in the hidden admin menu, defaults off, and
  // the harvest routine below is DELIBERATELY INERT. It sends no game message
  // (no InteractiveUseRequest), so nothing is ever collected. Enabling it only
  // trips the flag in the admin layer (security:flag) so the operator can ban
  // the machine. Do NOT wire real harvesting here — that would make it a bot.
  var autoHarvestOn = false;
  function setAutoHarvest(on) {
    autoHarvestOn = on;
    if (!on) return;
    // Intentionally does not act. Present so tampering to "make it work" is
    // visible/attributable rather than hidden. Instead of harvesting, capture
    // evidence of WHERE the trip happened — proof the machine was in a position
    // to bot (map, cell, count of harvestable interactives on the map) — and
    // emit it so the admin layer records a rich flag. No game message is sent.
    try {
      var pos = readPosition();
      var mr = window.isoEngine && window.isoEngine.mapRenderer;
      var interactiveCount = mr && mr.interactiveElements ? Object.keys(mr.interactiveElements).length : 0;
      emit({
        type: 'honeypot-trip',
        feature: 'auto-harvest',
        mapId: pos.mapId,
        cellId: pos.cellId,
        interactiveCount: interactiveCount,
      });
      console.warn('[qol] auto-harvest requested — inert stub, no action taken');
    } catch (e) {}
  }

  function onGuiReady(gui) {
    if (noConfirm) applyNoConfirm(true);
    if (showResources) setResourceOverlay(true);
    if (hideShop) setHideShop(true);
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

    // Auto-accept a party invite: always when it's from the expected leader,
    // and (optionally) any incoming group invite.
    gui.on('PartyInvitationMessage', function (msg) {
      try {
        if (!msg) return;
        if (autoAcceptGroup || (expectInviteFrom && msg.fromName === expectInviteFrom)) {
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
