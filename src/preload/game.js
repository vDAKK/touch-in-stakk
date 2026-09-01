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

  // --- Travel ("Courir ici" across maps) ------------------------------------
  // Walk to a target map one neighbour at a time, waiting for each map to load
  // and the character to stop between hops (the same isoEngine/actorManager
  // fields the mule-follow already uses). Capped so a broken path can't loop
  // forever. nextHopCell() is the one client-specific seam: run `travel-debug`
  // in-game to confirm the map/position field names, then finalize it.
  var TRAVEL_MAX_HOPS = 40;
  var travelAbort = false;

  function tSleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function charIdle() {
    var am = window.actorManager;
    return !!(am && am.userActor && !am.userActor.moving);
  }
  async function waitFor(pred, timeoutMs) {
    var t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try { if (pred()) return true; } catch (e) {}
      await tSleep(150);
    }
    return false;
  }

  // From the current map, choose the border cell to step onto to move one map
  // toward (worldX, worldY). Dofus DIRECTION bit flags: 1=E 2=S 4=W 8=N.
  function nextHopCell(worldX, worldY) {
    try {
      var iso = window.isoEngine;
      var map = iso && iso.mapRenderer && iso.mapRenderer.map;
      var pos = window.gui && window.gui.playerData && window.gui.playerData.position;
      if (!map || !map.cells || !pos) return null;
      var dx = worldX - pos.worldX;
      var dy = worldY - pos.worldY;
      var dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 1 : 4) : (dy > 0 ? 2 : 8);
      for (var i = 0; i < map.cells.length; i++) {
        var c = map.cells[i];
        if (c && (c.mapChangeData & dir)) return i;
      }
    } catch (e) {}
    return null;
  }

  async function travelTo(target) {
    travelAbort = false;
    var iso = window.isoEngine;
    if (!iso || !iso.mapRenderer || typeof iso._movePlayerOnMap !== 'function') {
      return emit({ type: 'travel-done', ok: false, reason: 'no-engine' });
    }
    for (var hop = 0; hop < TRAVEL_MAX_HOPS; hop++) {
      if (travelAbort) return emit({ type: 'travel-done', ok: false, reason: 'aborted' });
      if (iso.mapRenderer.mapId === target.mapId) break;
      var cell = nextHopCell(target.worldX, target.worldY);
      if (cell == null) return emit({ type: 'travel-done', ok: false, reason: 'no-path' });
      var fromMap = iso.mapRenderer.mapId;
      try { iso._movePlayerOnMap(cell, false); } catch (e) {}
      await waitFor(function () {
        return iso.mapRenderer.mapId !== fromMap && iso.mapRenderer.isReady;
      }, 12000);
      await waitFor(charIdle, 8000);
    }
    var arrived = iso.mapRenderer.mapId === target.mapId;
    if (arrived && target.cellId != null) {
      await waitFor(function () { return iso.mapRenderer.isReady && charIdle(); }, 8000);
      try { iso._movePlayerOnMap(target.cellId, false); } catch (e) {}
    }
    emit({ type: 'travel-done', ok: arrived, reason: arrived ? 'arrived' : 'max-hops' });
  }

  // Report the real shape of the client objects travel depends on, so the seam
  // above can be pinned to actual field names from an in-game session.
  function travelDebug() {
    try {
      var iso = window.isoEngine, gui = window.gui;
      var map = iso && iso.mapRenderer && iso.mapRenderer.map;
      var pos = gui && gui.playerData && gui.playerData.position;
      var sample = null;
      if (map && map.cells) {
        for (var i = 0; i < map.cells.length; i++) {
          if (map.cells[i] && map.cells[i].mapChangeData) {
            sample = { cellId: i, mapChangeData: map.cells[i].mapChangeData };
            break;
          }
        }
      }
      return {
        mapId: iso && iso.mapRenderer && iso.mapRenderer.mapId,
        hasMovePlayer: !!(iso && iso._movePlayerOnMap),
        mapKeys: map ? Object.keys(map).slice(0, 40) : null,
        cellCount: map && map.cells ? map.cells.length : null,
        sampleBorderCell: sample,
        position: pos ? { worldX: pos.worldX, worldY: pos.worldY, mapId: pos.mapId } : null,
        posKeys: pos ? Object.keys(pos) : null,
      };
    } catch (e) { return { error: String(e) }; }
  }

  // Diagnostic: the authoritative list of window ids the client actually
  // registers, plus a check of every ACTION_WINDOW id against it — so a wrong
  // id (an interface shortcut that silently does nothing) is obvious. Run
  // window.stakkWindowsDebug() from an in-game account.
  function windowsDebug() {
    try {
      var wm = windowsManager();
      if (!wm) return { error: 'no-window-manager' };
      var reg = wm.windows || wm._windows || wm.windowList || wm._windowList || null;
      var known = reg && typeof reg === 'object' ? Object.keys(reg) : null;
      var check = {};
      for (var a in ACTION_WINDOW) {
        var id = ACTION_WINDOW[a][0];
        var w = null;
        try { w = wm.getWindow(id); } catch (e) {}
        check[a] = { id: id, exists: !!w };
      }
      return { knownWindowIds: known, mgrKeys: Object.keys(wm).slice(0, 80), actionCheck: check };
    } catch (e) { return { error: String(e) }; }
  }

  // Hide the real-money shop button from the HUD.
  var shopStyle = null;
  function setHideShop(on) {
    if (on) {
      if (shopStyle) return;
      shopStyle = document.createElement('style');
      // Only the floating shop toolbar + shop button — not the goultines menu
      // icon (matches Retouch's SHOP_BUTTON_HIDE_CSS).
      shopStyle.textContent = '.shopFloatingToolbar, .shopBtn { display: none !important; }';
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

  // Build a selector from an element's own classes, dropping volatile state
  // classes so it still matches after the toggle flips them.
  var STATE_CLASS = /^(active|on|off|selected|pressed|hover|disabled|hidden|open|opened|closed|show|shown|hide|hidden|enabled|checked|highlight)$/i;
  function cssPathOf(el) {
    if (!el || !el.tagName) return null;
    var c = el.className;
    if (c && c.baseVal !== undefined) c = c.baseVal; // SVG className is an object
    if (typeof c === 'string' && c.trim()) {
      var classes = c.trim().split(/\s+/).filter(function (x) { return x && !STATE_CLASS.test(x); });
      if (classes.length) return el.tagName.toLowerCase() + '.' + classes.join('.');
    }
    return null;
  }

  // One-shot: the next tap in the game records its (stable-classed) target as
  // the toggle. Uses pointerdown so it fires before the game can restyle the
  // button, and walks up to the first ancestor that has a usable class.
  function captureEntitiesButton() {
    var onDown = function (ev) {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
      var node = ev.target, sel = null;
      for (var i = 0; node && i < 4; i++, node = node.parentElement) {
        sel = cssPathOf(node);
        if (sel && document.querySelectorAll(sel).length === 1) break;
      }
      entitiesSelector = sel || cssPathOf(ev.target);
      emit({ type: 'entities-selector', selector: entitiesSelector });
      emit({ type: 'entities-debug', phase: 'capture', selector: entitiesSelector, tag: ev.target.tagName });
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
  }

  // Tap an element the way the touch-first client expects. Real coordinates at
  // the element's centre matter: lindo's fixes.js turns these mouse events into
  // touchstart/touchend, and a (0,0) event lands the touch off the button.
  function tapElement(el) {
    if (!el) return false;
    try {
      var r = el.getBoundingClientRect();
      var x = r.left + r.width / 2;
      var y = r.top + r.height / 2;
      var opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
      return true;
    } catch (e) {}
    return false;
  }

  var entitiesShown = false;
  function clickEntitiesToggle() {
    // "Afficher les entités" is the client's monster-info feature: show/remove
    // every monster-group + NPC tooltip. Drive it through the game API for a
    // clean on/off toggle — the HUD button itself is press-and-hold, so a plain
    // tap would only flash the tooltips on then straight back off.
    try {
      var fg = window.foreground;
      if (fg && typeof fg.showAllMonsterGroupAndNpcTooltips === 'function' &&
          typeof fg.removeAllMonsterGroupAndNpcTooltips === 'function') {
        entitiesShown = !entitiesShown;
        if (entitiesShown) fg.showAllMonsterGroupAndNpcTooltips();
        else fg.removeAllMonsterGroupAndNpcTooltips();
        var btn = document.querySelector('.monsterInfoButton');
        if (btn) btn.classList.toggle('on', entitiesShown);
        return true;
      }
    } catch (e) {}
    // Fallback: tap the real HUD button (hold semantics), or a captured one.
    return tapElement(document.querySelector('.monsterInfoButton') || (entitiesSelector ? document.querySelector(entitiesSelector) : null));
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
  // Each interface is opened by tapping its real HUD menu icon (touch-first
  // client), not by guessing a window-manager id — the class names are the
  // client's own and toggle the window exactly like a finger tap.
  var MENU_ICON = {
    character: 'menuIconCarac',
    spells: 'menuIconSpell',
    inventory: 'menuIconBag',
    quests: 'menuIconBook',
    map: 'menuIconMap',
    jobs: 'menuIconJob',
    market: 'menuIconBidHouse',
    dailyQuest: 'menuIconDailyQuest',
    social: 'menuIconFriend',
    guild: 'menuIconGuild',
    alliance: 'menuIconAlliance',
    bestiary: 'menuIconBestiary',
    achievements: 'menuIconAchievement',
    titles: 'menuIconTitle',
    toa: 'menuIconTOA',
    groupSeeker: 'menuIconGroupSeeker',
    mount: 'menuIconMount',
    zaap: 'menuIconZaap',
    goultines: 'menuIconGoultine',
    directory: 'menuIconDirectory',
    conquest: 'menuIconConquest',
    alignment: 'menuIconAlignment',
    spouse: 'menuIconSpouse',
  };
  function clickMenuIcon(cls) {
    tapElement(document.querySelector('.' + cls));
  }

  // Best-effort character portrait for the tab icon. The character/equipment
  // window draws the avatar; snapshot the most avatar-shaped canvas/img inside
  // an open window (same-origin via the local proxy, so toDataURL is untainted)
  // and crop a square from the top (the head). Returns a 40px PNG data URL, or
  // null when nothing suitable is rendered yet — the host then keeps the dot.
  function capturePortrait() {
    try {
      var best = null, bestArea = 0;
      var nodes = document.querySelectorAll('canvas, img');
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        var r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 40) continue;
        // Ignore the full-window game canvas; we want a UI-sized avatar.
        if (r.width > window.innerWidth * 0.9 && r.height > window.innerHeight * 0.9) continue;
        var area = r.width * r.height;
        if (area > bestArea) { best = el; bestArea = area; }
      }
      if (!best) return null;
      var sw = best.naturalWidth || best.width;
      var sh = best.naturalHeight || best.height;
      if (!sw || !sh) return null;
      var side = Math.min(sw, sh);
      var out = document.createElement('canvas');
      out.width = 40; out.height = 40;
      var ctx = out.getContext('2d');
      ctx.drawImage(best, (sw - side) / 2, 0, side, side, 0, 0, 40, 40);
      // Reject a blank capture (a WebGL canvas without preserveDrawingBuffer
      // reads back transparent); getImageData also throws if tainted -> null.
      var data = ctx.getImageData(0, 0, 40, 40).data;
      var opaque = 0;
      for (var p = 3; p < data.length; p += 4) if (data[p] > 16) opaque++;
      if (opaque < 40) return null;
      return out.toDataURL('image/png');
    } catch (e) { return null; }
  }

  function tryEmitPortrait() {
    var d = capturePortrait();
    if (d) emit({ type: 'portrait', dataUrl: d });
  }

  // Open the window the same way the game's menu button does (no forceToOpen —
  // that opens the shell but skips the content load); re-press closes it.
  function doAction(action) {
    if (MENU_ICON[action]) {
      clickMenuIcon(MENU_ICON[action]);
      // Grab the avatar once the character/inventory panel has rendered: the
      // "capture from the inventory" moment.
      if (action === 'character' || action === 'inventory') setTimeout(tryEmitPortrait, 900);
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
    } else if (p.type === 'capture-portrait') {
      tryEmitPortrait();
    } else if (p.type === 'travel') {
      travelTo(p.target || {});
    } else if (p.type === 'travel-cancel') {
      travelAbort = true;
    } else if (p.type === 'travel-debug') {
      emit({ type: 'travel-debug', data: travelDebug() });
    } else if (p.type === 'windows-debug') {
      emit({ type: 'windows-debug', data: windowsDebug() });
    }
  });

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

    // One-shot: report the client's real window ids to app.log so wrong
    // ACTION_WINDOW ids (dead interface shortcuts) can be corrected. Delayed so
    // the window manager is populated. Remove once ACTION_WINDOW is verified.
    setTimeout(function () { emit({ type: 'windows-debug', data: windowsDebug() }); }, 2500);

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
        } else {
          // A group invite the user has to answer: surface it so a background
          // tab still gets noticed.
          emit({ type: 'party-invite', from: msg.fromName });
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
        } else if (msg && !ownIds[msg.sourceId]) {
          // A challenge from someone who isn't one of the user's own accounts:
          // notify instead of silently auto-accepting.
          emit({ type: 'challenge-invite', from: msg.sourceName || msg.sourceId });
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

// Tap a DOM element at its centre with real coordinates (fixes.js turns these
// into touch events on the touch-first client).
function tapDomAt(el) {
  if (!el) return false;
  try {
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    el.dispatchEvent(new MouseEvent('mousedown', o));
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.dispatchEvent(new MouseEvent('click', o));
    return true;
  } catch (e) { return false; }
}

// Physical keyboard -> the client's on-screen number pad. Detected structurally
// (most of 0-9 as leaf buttons AND a validate/clear button) so it needs no
// class names, can't false-match an item grid, and only fires when the pad is
// actually open — otherwise digits stay free for spell shortcuts.
function findNumpad() {
  const nodes = document.querySelectorAll('div,button,span,a,td');
  const digits = {};
  let count = 0, enter = null, clr = null;
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    if (el.children.length) continue;
    const t = (el.textContent || '').trim();
    if (!t || t.length > 8) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 12 || r.height < 12) continue;
    if (/^[0-9]$/.test(t)) { if (!digits[t]) { digits[t] = el; count++; } }
    else if (/enter|valider|^ok$|✓/i.test(t)) { enter = enter || el; }
    else if (/^(clr|clear|effacer)$/i.test(t)) { clr = clr || el; }
  }
  return count >= 9 && (enter || clr) ? { digits, enter, clr } : null;
}
function routeNumpad(e) {
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  const isDigit = /^[0-9]$/.test(e.key);
  if (!isDigit && e.key !== 'Enter') return false;
  const pad = findNumpad();
  if (!pad) return false;
  if (isDigit && pad.digits[e.key]) return tapDomAt(pad.digits[e.key]);
  if (e.key === 'Enter' && pad.enter) return tapDomAt(pad.enter);
  return false;
}

// Enter validates the active confirmation / action popup (sell, buy, yes/no…).
// The client's primary button carries one of these classes and reacts to a tap;
// pick the last visible, enabled one (the top-most popup) and tap it.
function tapConfirmButton() {
  const sels = ['.yesButton', '.confirmButton', '.validateButton', '.okButton'];
  for (let s = 0; s < sels.length; s++) {
    const els = document.querySelectorAll(sels[s]);
    let best = null;
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (/(^|\s)(disabled|disable|greyed|spinner)(\s|$)/.test(el.className || '')) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) best = el;
    }
    if (best) return tapDomAt(best);
  }
  return false;
}

// Reserved launcher hotkeys. This preload sees keydown even while the game has
// focus, so forward our shortcuts to the host and stop the game from also acting.
window.addEventListener(
  'keydown',
  (e) => {
    // Type into the on-screen number pad with the physical keyboard.
    if (routeNumpad(e)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Enter confirms the active popup (Vendre, Acheter, Oui…), unless typing.
    if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.metaKey && !isTyping() && tapConfirmButton()) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
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
