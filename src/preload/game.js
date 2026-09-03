// Preload for each account's game webview. It does two things:
//  1. injects a main-world hook that subscribes to the game's own event bus
//     (window.gui) — the game runs in the page's main world, which this
//     isolated preload cannot touch directly, so we inject a <script>;
//  2. relays messages between that main-world hook and the renderer host
//     (the tab manager) over window.postMessage <-> ipcRenderer.sendToHost.
const { ipcRenderer } = require('electron');

// Make the page itself look like the tablet the HTTP headers already claim.
// Header spoofing alone is not enough: the client reads navigator and screen
// directly, and a Mac desktop signature there contradicts the Android user
// agent it sends. Values come from the same per-account device profile, so a
// tab is internally consistent and distinct from the other accounts'.
function deviceSpoof(profile) {
  var p = profile;
  function def(obj, name, value) {
    try {
      Object.defineProperty(obj, name, { get: function () { return value; }, configurable: true });
    } catch (e) {}
  }
  try {
    def(navigator, 'userAgent', p.userAgent);
    def(navigator, 'appVersion', p.userAgent.replace(/^Mozilla\//, ''));
    def(navigator, 'platform', p.platform);
    def(navigator, 'vendor', 'Google Inc.');
    def(navigator, 'maxTouchPoints', 5);
    def(navigator, 'hardwareConcurrency', p.cores);
    def(navigator, 'deviceMemory', p.mem);
    // userAgentData is structured and would otherwise still report macOS.
    if (navigator.userAgentData) {
      def(navigator, 'userAgentData', {
        mobile: true,
        platform: 'Android',
        brands: navigator.userAgentData.brands || [],
        getHighEntropyValues: function () {
          return Promise.resolve({ platform: 'Android', mobile: true, model: p.model });
        },
      });
    }
    def(screen, 'width', p.width);
    def(screen, 'height', p.height);
    def(screen, 'availWidth', p.width);
    def(screen, 'availHeight', p.height);
    def(window, 'devicePixelRatio', p.dpr);
    def(window, 'orientation', 0);
    // Touch feature-detection: the client branches on these to pick its
    // touch UI, and they are absent on a desktop build.
    if (!('ontouchstart' in window)) {
      try { window.ontouchstart = null; } catch (e) {}
    }
  } catch (e) {}
}

// Background tabs: Chromium is already told not to throttle, but the client
// itself drops its frame rate when the page reports hidden or loses focus (a
// battery habit from the tablet build). Present it as always visible and
// focused, and keep those events from reaching it.
function keepAlive() {
  function def(obj, name, value) {
    try { Object.defineProperty(obj, name, { get: function () { return value; }, configurable: true }); } catch (e) {}
  }
  try {
    def(document, 'hidden', false);
    def(document, 'visibilityState', 'visible');
    def(document, 'webkitHidden', false);
    try { document.hasFocus = function () { return true; }; } catch (e) {}
    // A guest view whose layer is not composited stops receiving frame
    // callbacks, which freezes anything driven by requestAnimationFrame. Race
    // the native callback against a timer so the loop keeps ticking at ~40fps
    // even when the compositor skips this tab.
    var nativeRaf = window.requestAnimationFrame.bind(window);
    var nativeCaf = window.cancelAnimationFrame.bind(window);
    var pending = {};
    var seq = 0;
    window.requestAnimationFrame = function (cb) {
      var id = ++seq, done = false;
      var run = function () {
        if (done) return;
        done = true;
        delete pending[id];
        try { cb(performance.now()); } catch (e) {}
      };
      var r = nativeRaf(function () { clearTimeout(t); run(); });
      var t = setTimeout(function () { nativeCaf(r); run(); }, 25);
      pending[id] = { r: r, t: t };
      return id;
    };
    window.cancelAnimationFrame = function (id) {
      var p = pending[id];
      if (!p) return;
      nativeCaf(p.r); clearTimeout(p.t); delete pending[id];
    };
    ['visibilitychange', 'webkitvisibilitychange', 'pagehide', 'blur', 'freeze'].forEach(function (ev) {
      var stop = function (e) { e.stopImmediatePropagation(); };
      window.addEventListener(ev, stop, true);
      document.addEventListener(ev, stop, true);
    });
  } catch (e) {}
}

// Runs in the page's MAIN world. No node/ipc access here — it talks to the
// preload only through window.postMessage, so the game keeps no privileged refs.
function gameHook() {
  var expectInviteFrom = null;
  var expectTimer = null;
  var ownIds = {};          // character ids of the user's other accounts
  var ownNames = {};        // their character names, for messages lacking an id
  var autoAccept = false;   // auto-accept trades/duels coming from those
  var session = { xp: 0, kamas: 0 };
  var lastKamas = null;
  var noConfirm = false;
  var showResources = false;
  var autoAcceptGroup = false;
  var hideShop = false;
  var joinLeaderFight = false;   // join any fight the party leader is in

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
      // While a summon is controlled the shortcut bar shows its spells, and a
      // cast must be attributed to it, not to the player.
      window.gui.emit('spellSlotSelected', controlledId(pd), spellId);
    } catch (e) {}
  }

  // The entity currently under the player's control: their character, or a
  // summon/controlled creature during its turn.
  function controlledId(pd) {
    try {
      var ch = pd.characters;
      if (ch) {
        if (typeof ch.getControlledCharacterId === 'function') {
          var cid = ch.getControlledCharacterId();
          if (cid != null) return cid;
        }
        if (ch.controlledCharacterId != null) return ch.controlledCharacterId;
      }
      var fm = window.gui.fightManager;
      if (fm && typeof fm.getControlledFighterId === 'function') {
        var fid = fm.getControlledFighterId();
        if (fid != null) return fid;
      }
    } catch (e) {}
    return pd.id;
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
  // The in-game party leader's player id, or null when not grouped. The field
  // name is resolved loosely (leaderId / leader / leaderPlayerId) since the
  // party object's exact shape was not pinned from a session.
  function partyLeaderId() {
    try {
      var pd = window.gui.playerData.partyData;
      var party = pd && pd.getClassicalParty && pd.getClassicalParty();
      if (!party) return null;
      // Own fields are underscore-prefixed (_leaderId, _partyId); accessor
      // names without it may or may not exist, so check both.
      if (party._leaderId != null) return party._leaderId;
      if (party.leaderId != null) return party.leaderId;
    } catch (e) {}
    return null;
  }
  function isPartyLeader() {
    try { return partyLeaderId() != null && partyLeaderId() === window.gui.playerData.id; }
    catch (e) { return false; }
  }

  function readPosition() {
    try {
      var iso = window.isoEngine;
      var am = window.actorManager;
      var mapId = iso && iso.mapRenderer ? iso.mapRenderer.mapId : null;
      var cellId = am && am.userActor ? am.userActor.cellId : null;
      // World coordinates too: a follower on another map needs them to travel.
      var c = mapCoords();
      return { mapId: mapId, cellId: cellId, x: c ? c.x : null, y: c ? c.y : null };
    } catch (e) { return { mapId: null, cellId: null, x: null, y: null }; }
  }

  // Travel started to rejoin a leader on another map. Tracked so repeated
  // position updates don't stack trips on top of each other.
  var muleTravelling = false;

  // Grid distance between two cells on the 14-wide isometric map.
  function cellDist(a, b) {
    var W = 14;
    var ra = Math.floor(a / W), ca = a % W, rb = Math.floor(b / W), cb = b % W;
    var ua = ca + Math.floor(ra / 2), va = Math.floor((ra + 1) / 2) - ca;
    var ub = cb + Math.floor(rb / 2), vb = Math.floor((rb + 1) / 2) - cb;
    return Math.abs(ua - ub) + Math.abs(va - vb);
  }

  // A free walkable cell next to `around`, never `around` itself: followers
  // must not stack on the leader (or on each other — occupied cells are
  // skipped, and each account prefers a different candidate so they spread).
  function freeCellNear(around) {
    try {
      var mr = window.isoEngine.mapRenderer, am = window.actorManager;
      var cells = mr.map.cells;
      var occupied = {};
      try { (am.getOccupiedCells() || []).forEach(function (c) { occupied[c] = true; }); } catch (e) {}
      var cand = [];
      for (var i = 0; i < cells.length; i++) {
        if (i === around || !cells[i] || !(cells[i].l & 1) || occupied[i]) continue;
        var d = cellDist(i, around);
        if (d >= 1 && d <= 3) cand.push({ cell: i, d: d });
      }
      if (!cand.length) return null;
      cand.sort(function (a, b) { return a.d - b.d || a.cell - b.cell; });
      var pick = Math.abs(window.gui.playerData.id || 0) % Math.min(4, cand.length);
      return cand[pick].cell;
    } catch (e) { return null; }
  }

  // Direction in which `mapId` is a direct neighbour of the current map.
  function neighbourDir(mapId) {
    try {
      var map = window.isoEngine.mapRenderer.map;
      var dirs = ['top', 'bottom', 'left', 'right'];
      for (var i = 0; i < dirs.length; i++) if (map[dirs[i] + 'NeighbourId'] === mapId) return dirs[i];
    } catch (e) {}
    return null;
  }

  function muleFollow(mapId, cellId, x, y) {
    try {
      var iso = window.isoEngine;
      var am = window.actorManager;
      if (!iso || !am || !am.userActor || !iso.mapRenderer || !iso.mapRenderer.isReady) return;
      if (inFight()) return;

      if (iso.mapRenderer.mapId !== mapId) {
        if (muleTravelling) return;
        muleTravelling = true;
        var done = function () { muleTravelling = false; };

        // Leader one map over (the usual case): hop straight through that
        // border. Needs nothing but this map's own neighbour ids, so it works
        // whether or not the world map was ever opened.
        var dir = neighbourDir(mapId);
        if (dir) {
          beginSelf();
          hopToward(0, 0, [dir]).then(function () { endSelf(); done(); },
                                        function () { endSelf(); done(); });
          return;
        }
        // Further away: plan a route by coordinates.
        if (x == null || y == null) return done();
        var c = mapCoords();
        if (c && c.x === x && c.y === y) return done();   // same coords, map still loading
        travelTo({ worldX: x, worldY: y }).then(done, done);
        return;
      }

      if (am.userActor.moving) return;
      // Close enough already: don't shuffle on every position report.
      if (cellDist(am.userActor.cellId, cellId) <= 3) return;
      var target = freeCellNear(cellId);
      if (target == null) return;
      asSelf(function () { iso._movePlayerOnMap(target, false); });
    } catch (e) {}
  }

  // --- Travel ("Courir ici" across maps) ------------------------------------
  // Walk to a target map by world coordinates, one neighbour map at a time.
  //
  // All the hard parts are the client's own: getChangeMapFlags(cellId) marks
  // which cells exit toward which neighbour, and gotoNeighbourMap() walks to
  // such a cell (via the client pathfinder, so obstacles are handled) and fires
  // the map change on arrival. We only decide the direction each hop and wait
  // for the map to settle. Capped so a broken path cannot loop forever.
  var TRAVEL_MAX_HOPS = 60;
  var EXIT_CELLS_TRIED = 5;      // fallback ladder outward from the best cell
  var EXIT_CELL_RETRIES = 3;     // the server sometimes refuses a valid crossing
  var CROSS_POLL_MS = 150;
  var CROSS_IDLE_FAIL_MS = 1000; // stopped moving, map unchanged -> refused
  var CROSS_RETRY_DELAY_MS = 1000;
  var CROSS_TIMEOUT_MS = 15000;
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

  // Current map coordinates on the world grid. posY grows southward.
  function mapCoords() {
    try {
      var c = window.gui.playerData.position.coordinates;
      return c && c.posX != null ? { x: c.posX, y: c.posY } : null;
    } catch (e) { return null; }
  }

  // Cells that exit the current map toward `dir`, nearest first from the
  // player's cell. Uses the client's own border flags — cell objects only carry
  // an `l` bitfield, the exit data lives in getChangeMapFlags(cellId).
  // --- World pathfinding -----------------------------------------------------
  // A* over map coordinates. Whether a coordinate holds a real map is answered
  // by the client itself (getSubAreaAtGridCoordinate): the raw coordinate table
  // is sparse and the client fills its gaps by walking backwards, so asking it
  // is the only reliable test. Routing this way goes around water, walls and
  // dead ends instead of walking blindly along the dominant axis.
  var _subAreaCache = {};

  function subAreaAt(x, y) {
    var k = x + ',' + y;
    if (k in _subAreaCache) return _subAreaCache[k];
    var v = null;
    try {
      var m = worldMapView();
      if (m && typeof m.getSubAreaAtGridCoordinate === 'function') {
        var r = m.getSubAreaAtGridCoordinate(x, y);
        v = r ? (r.id != null ? r.id : true) : null;
      }
    } catch (e) {}
    _subAreaCache[k] = v;
    return v;
  }

  function mapExists(x, y) { return subAreaAt(x, y) != null; }

  var PATH_MAX_NODES = 6000;
  var PATH_MAX_SPREAD = 40; // don't wander further than this off the bounding box

  function findWorldPath(sx, sy, tx, ty) {
    if (sx === tx && sy === ty) return [];
    if (!mapExists(tx, ty)) return null;

    var key = function (x, y) { return x + ',' + y; };
    var startK = key(sx, sy), goalK = key(tx, ty);
    var open = [{ x: sx, y: sy, g: 0, f: Math.abs(tx - sx) + Math.abs(ty - sy) }];
    var came = {}, gScore = {};
    gScore[startK] = 0;
    // Keep the search inside a padded box around start/goal: without it a
    // blocked route would crawl over the entire world.
    var minX = Math.min(sx, tx) - PATH_MAX_SPREAD, maxX = Math.max(sx, tx) + PATH_MAX_SPREAD;
    var minY = Math.min(sy, ty) - PATH_MAX_SPREAD, maxY = Math.max(sy, ty) + PATH_MAX_SPREAD;
    var seen = 0;

    while (open.length && seen++ < PATH_MAX_NODES) {
      var bi = 0;
      for (var i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      var cur = open.splice(bi, 1)[0];
      var curK = key(cur.x, cur.y);

      if (curK === goalK) {
        var path = [], k = goalK;
        while (k !== startK) {
          var c = came[k];
          if (!c) return null;
          path.unshift({ x: c.x, y: c.y });
          k = c.from;
        }
        return path;
      }

      var neigh = [
        { x: cur.x + 1, y: cur.y }, { x: cur.x - 1, y: cur.y },
        { x: cur.x, y: cur.y + 1 }, { x: cur.x, y: cur.y - 1 },
      ];
      for (var n = 0; n < neigh.length; n++) {
        var nx = neigh[n].x, ny = neigh[n].y;
        if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;
        if (!mapExists(nx, ny)) continue;
        if (edgeBlocked(cur.x, cur.y, dirBetween(cur.x, cur.y, nx, ny))) continue;
        var nk = key(nx, ny), tentative = cur.g + 1;
        if (gScore[nk] != null && tentative >= gScore[nk]) continue;
        gScore[nk] = tentative;
        came[nk] = { from: curK, x: nx, y: ny };
        open.push({ x: nx, y: ny, g: tentative,
                    f: tentative + Math.abs(tx - nx) + Math.abs(ty - ny) });
      }
    }
    return null;
  }

  // Edges the client declares as neighbours but that cannot actually be walked
  // (no border exit cell: a wall, cliff or non-standard transition). Learned at
  // run time and fed back into A* so a replan routes around them.
  var blockedEdges = {};
  function edgeKey(x, y, dir) { return x + ',' + y + '>' + dir; }
  function markEdgeBlocked(x, y, dir) { blockedEdges[edgeKey(x, y, dir)] = true; }
  function edgeBlocked(x, y, dir) { return !!blockedEdges[edgeKey(x, y, dir)]; }

  function dirBetween(fx, fy, tx, ty) {
    if (tx > fx) return 'right';
    if (tx < fx) return 'left';
    if (ty > fy) return 'bottom';
    if (ty < fy) return 'top';
    return null;
  }

  // Record, for the map we are standing on, which declared neighbours have no
  // usable border exit. Doing this on arrival means A* plans with real data
  // instead of discovering walls by walking into them. Only runs on a fully
  // loaded map: a premature scan would wrongly blacklist every direction.
  function learnCurrentMapEdges() {
    try {
      var mr = window.isoEngine.mapRenderer;
      var here = mapCoords();
      if (!here || !mr.map || !mr.map.cells || !mr.isReady) return;
      ['top', 'bottom', 'left', 'right'].forEach(function (dir) {
        if (!mr.map[dir + 'NeighbourId']) {
          markEdgeBlocked(here.x, here.y, dir);   // no neighbour at all
        } else if (!exitCells(dir).length) {
          markEdgeBlocked(here.x, here.y, dir);   // neighbour declared, no way through
        }
      });
    } catch (e) {}
  }

  // Exit cells toward `dir`, best candidate first.
  //
  // A border's transition cells are not one contiguous block: walls split them
  // into several runs, and the index stride between neighbours on the same
  // border differs per direction (a full row apart for left/right, adjacent for
  // top/bottom on the 14-wide grid). So infer the stride from the most common
  // gap, group the cells into runs at that stride, take the longest run — the
  // widest opening — and aim at its middle, which is the least likely to be
  // blocked. The rest follow, ordered outward, as fallbacks.
  function exitCells(dir) {
    try {
      var mr = window.isoEngine.mapRenderer;
      var fn = mr.getChangeMapFlags || Object.getPrototypeOf(mr).getChangeMapFlags;
      if (typeof fn !== 'function' || !mr.map || !mr.map.cells) return [];

      var cand = [];
      for (var i = 0; i < mr.map.cells.length; i++) {
        var cell = mr.map.cells[i];
        if (!cell || !(cell.l & 1)) continue;      // must be walkable to be reachable
        var f = fn.call(mr, i);
        if (f && f[dir]) cand.push(i);
      }
      if (cand.length < 2) return cand;
      cand.sort(function (a, b) { return a - b; });

      var counts = {}, stride = cand[1] - cand[0], best = 0;
      for (var d = 1; d < cand.length; d++) {
        var gap = cand[d] - cand[d - 1];
        counts[gap] = (counts[gap] || 0) + 1;
        if (counts[gap] > best) { best = counts[gap]; stride = gap; }
      }

      var runs = [], run = [cand[0]];
      for (var j = 1; j < cand.length; j++) {
        if (cand[j] - run[run.length - 1] === stride) run.push(cand[j]);
        else { runs.push(run); run = [cand[j]]; }
      }
      runs.push(run);

      var longest = runs[0];
      for (var r = 1; r < runs.length; r++) if (runs[r].length > longest.length) longest = runs[r];
      var mid = longest[Math.floor(longest.length / 2)];

      cand.sort(function (a, b) { return Math.abs(a - mid) - Math.abs(b - mid); });
      return cand;
    } catch (e) { return []; }
  }

  // Directions to try this hop, best first: the larger coordinate gap leads,
  // and the perpendicular axis is the fallback when a border has no exit.
  function hopDirections(dx, dy) {
    var h = dx > 0 ? 'right' : dx < 0 ? 'left' : null;
    var v = dy > 0 ? 'bottom' : dy < 0 ? 'top' : null;
    var dirs = Math.abs(dx) >= Math.abs(dy) ? [h, v] : [v, h];
    return dirs.filter(Boolean);
  }

  // One hop toward the target. Returns true if the map actually changed.
  //
  // gotoNeighbourMap() only sends the map change if the character lands exactly
  // on the requested cell (its arrival callback checks that), so a blocked or
  // unreachable exit silently walks and stops. Worse, a border cell the server
  // rejects rolls the character back to where it started. So: try each exit
  // cell, confirm the map really changed, and move on to the next one if not.
  async function hopToward(dx, dy, onlyDirs) {
    var iso = window.isoEngine;
    var dirs = onlyDirs || hopDirections(dx, dy);
    var here = mapCoords();
    for (var i = 0; i < dirs.length; i++) {
      var dir = dirs[i];
      var neighbourId = iso.mapRenderer.map[dir + 'NeighbourId'];
      // No neighbour registered that way — don't bother walking to the border.
      if (!neighbourId) continue;
      var cells = exitCells(dir);

      // Declared neighbour with no border exit at all: a wall, a cliff or a
      // non-standard transition. Ask the server directly once — it refuses if
      // the move is not legal — then remember the edge so A* routes around it.
      if (!cells.length) {
        var fromDirect = iso.mapRenderer.mapId;
        try { asSelf(function () { iso._requestMapChange(neighbourId, dir); }); } catch (e) {}
        var jumped = await waitFor(function () {
          return iso.mapRenderer.mapId !== fromDirect && iso.mapRenderer.isReady;
        }, 6000);
        if (jumped) { await waitFor(charIdle, 8000); return true; }
        if (here) markEdgeBlocked(here.x, here.y, dir);
        continue;
      }

      for (var j = 0; j < cells.length && j < EXIT_CELLS_TRIED; j++) {
        for (var attempt = 0; attempt < EXIT_CELL_RETRIES; attempt++) {
          if (travelAbort) return false;

          // Never stack a request on top of a transition still in flight.
          await waitFor(function () {
            return iso.mapRenderer.isReady && !iso.isMapChanging && !iso.changeMapTimeout;
          }, 10000);

          var fromMap = iso.mapRenderer.mapId;
          try { asSelf(function () { iso.gotoNeighbourMap(dir, cells[j], 0, 0); }); } catch (e) { break; }

          // Poll for the crossing. A character that stops moving without the
          // map having changed means the walk finished but the transition was
          // refused — detect that instead of waiting out the full timeout.
          var t0 = Date.now(), idleSince = null, crossed = false;
          while (Date.now() - t0 < CROSS_TIMEOUT_MS) {
            if (travelAbort) return false;
            if (iso.mapRenderer.mapId !== fromMap) { crossed = true; break; }
            if (charIdle()) {
              if (idleSince === null) idleSince = Date.now();
              else if (Date.now() - idleSince >= CROSS_IDLE_FAIL_MS) break;
            } else {
              idleSince = null;
            }
            await tSleep(CROSS_POLL_MS);
          }

          if (crossed) {
            // Let the new map finish loading and the character settle before
            // the next hop, or the following move lands on a half-loaded map.
            await waitFor(function () { return iso.mapRenderer.isReady; }, 8000);
            await waitFor(charIdle, 8000);
            return true;
          }
          await tSleep(CROSS_RETRY_DELAY_MS);
        }
      }
      // Every exit in this direction failed: don't plan through it again.
      if (here) markEdgeBlocked(here.x, here.y, dir);
    }
    return false;
  }

  async function travelTo(target) {
    travelAbort = false;
    installManualWatch();
    if (!onManualAction) onManualAction = abortAutomation;
    beginSelf();
    try {
      return await travelToInner(target);
    } finally { endSelf(); }
  }

  async function travelToInner(target) {
    var iso = window.isoEngine;
    if (!iso || !iso.mapRenderer || typeof iso.gotoNeighbourMap !== 'function') {
      return emit({ type: 'travel-done', ok: false, reason: 'no-engine' });
    }
    if (target.worldX == null || target.worldY == null) {
      return emit({ type: 'travel-done', ok: false, reason: 'no-target' });
    }

    var here = mapCoords();
    if (!here) return emit({ type: 'travel-done', ok: false, reason: 'no-position' });

    // Plan a real route first: A* over the world coordinate table routes around
    // water and dead ends that a greedy axis walk would get stuck against.
    // The coordinate lookup lives on the world map view, which only exists once
    // that window has been opened. Without it there is no route to plan.
    if (!(await ensureWorldMapView())) {
      return emit({ type: 'travel-done', ok: false, reason: 'no-world-map-data' });
    }
    learnCurrentMapEdges();
    var route = findWorldPath(here.x, here.y, target.worldX, target.worldY);
    if (route === null) {
      return emit({ type: 'travel-done', ok: false,
                    reason: mapExists(target.worldX, target.worldY) ? 'no-route' : 'no-such-map' });
    }
    emit({ type: 'travel-plan', steps: route.length, x: here.x, y: here.y });

    var stuck = 0, replans = 0;
    for (var step = 0; step < route.length && step < TRAVEL_MAX_HOPS; step++) {
      if (travelAbort) return emit({ type: 'travel-done', ok: false, reason: 'aborted' });
      await waitFor(function () { return iso.mapRenderer.isReady; }, 10000);

      var c = mapCoords();
      if (!c) return emit({ type: 'travel-done', ok: false, reason: 'no-position' });
      if (c.x === target.worldX && c.y === target.worldY) break;

      var want = route[step];
      var dx = want.x - c.x, dy = want.y - c.y;
      // Drifted off the plan (server moved us, or a hop overshot): replan.
      if (Math.abs(dx) + Math.abs(dy) !== 1) {
        var again = findWorldPath(c.x, c.y, target.worldX, target.worldY);
        if (!again || !again.length) {
          return emit({ type: 'travel-done', ok: false, reason: 'no-route', x: c.x, y: c.y });
        }
        route = again; step = -1;
        continue;
      }

      if (!(await hopToward(dx, dy))) {
        // hopToward has just recorded why this edge failed; replan around it.
        var detour = findWorldPath(c.x, c.y, target.worldX, target.worldY);
        if (!detour || !detour.length) {
          return emit({ type: 'travel-done', ok: false, reason: 'blocked', x: c.x, y: c.y });
        }
        if (++replans > 8) {
          return emit({ type: 'travel-done', ok: false, reason: 'blocked', x: c.x, y: c.y });
        }
        emit({ type: 'travel-replan', x: c.x, y: c.y, steps: detour.length });
        route = detour; step = -1;
        continue;
      }

      var after = mapCoords() || c;
      learnCurrentMapEdges();
      emit({ type: 'travel-progress', x: after.x, y: after.y, hop: step });
      if (after.x === c.x && after.y === c.y) {
        if (++stuck >= 3) {
          return emit({ type: 'travel-done', ok: false, reason: 'stuck', x: after.x, y: after.y });
        }
      } else {
        stuck = 0;
      }
    }

    var at = mapCoords();
    var arrived = !!at && at.x === target.worldX && at.y === target.worldY;
    // Final step to the exact cell, if one was asked for and it is walkable.
    if (arrived && target.cellId != null) {
      await waitFor(function () { return iso.mapRenderer.isReady && charIdle(); }, 8000);
      try {
        var cell = iso.mapRenderer.map.cells[target.cellId];
        if (cell && (cell.l & 1)) asSelf(function () { iso._movePlayerOnMap(target.cellId, false); });
      } catch (e) {}
    }
    if (!arrived) toast('Voyage interrompu', 'warn');
    emit({ type: 'travel-done', ok: arrived, reason: arrived ? 'arrived' : 'max-hops',
           x: at ? at.x : null, y: at ? at.y : null });
  }

  // --- Right-click on the world map -> "Courir ici" -------------------------
  // The world map view owns the pixel -> grid-coordinate transform
  // (convertCanvasToGridCoordinate), so a right-click on its canvas maps
  // straight onto the coordinates travelTo() already walks toward.
  var travelHooked = false;

  function worldMapView() {
    try {
      var w = windowsManager() && windowsManager().getWindow('worldMap');
      return w && (w._worldMap || (w.getWorldMap && w.getWorldMap())) || null;
    } catch (e) { return null; }
  }

  // The coordinate lookup the pathfinder needs lives on the world map view,
  // which the client only builds when that window is first opened. Build it
  // ourselves so travel works without the player ever opening the map: ask the
  // window to create its view, and fall back to a blink open/close if it has
  // no such method. Then wait for the coordinate table to load.
  function worldMapReady() {
    var m = worldMapView();
    if (!m) return false;
    try {
      var t = m._subAreaIdPerCoordinate;
      return !!(t && Object.keys(t).length && typeof m.getSubAreaAtGridCoordinate === 'function');
    } catch (e) { return false; }
  }

  async function ensureWorldMapView() {
    if (worldMapReady()) return true;
    var wm = windowsManager();
    var w = wm && wm.getWindow('worldMap');
    if (!w) return false;
    try {
      if (!worldMapView() && typeof w._createWorldMap === 'function') w._createWorldMap();
    } catch (e) {}
    if (!worldMapView()) {
      // No builder to call: open and immediately close, which creates the view.
      try { wm.open('worldMap'); } catch (e) {}
      await tSleep(50);
      try { wm.close('worldMap'); } catch (e) {}
    }
    // Map data is fetched asynchronously after creation.
    return waitFor(worldMapReady, 8000);
  }

  // Minimal context menu drawn over the map; the client's own menus are touch
  // widgets and not reusable for a desktop right-click.
  function travelMenu(px, py, label, onGo) {
    var old = document.getElementById('stakk-travel-menu');
    if (old) old.remove();
    var el = document.createElement('div');
    el.id = 'stakk-travel-menu';
    el.style.cssText = [
      'position:fixed', 'left:' + px + 'px', 'top:' + py + 'px', 'z-index:99999',
      'background:#2b2118', 'border:1px solid #7a6a4f', 'border-radius:3px',
      'color:#e8dcc0', 'font:12px sans-serif', 'padding:4px 0', 'cursor:pointer',
      'box-shadow:0 2px 8px rgba(0,0,0,.6)', 'user-select:none',
    ].join(';');
    var item = document.createElement('div');
    item.textContent = 'Courir ici ' + label;
    item.style.cssText = 'padding:5px 14px;white-space:nowrap';
    item.onmouseenter = function () { item.style.background = '#40311f'; };
    item.onmouseleave = function () { item.style.background = ''; };
    item.onclick = function (ev) { ev.stopPropagation(); el.remove(); onGo(); };
    el.appendChild(item);
    document.body.appendChild(el);
    setTimeout(function () {
      document.addEventListener('mousedown', function close() {
        el.remove();
        document.removeEventListener('mousedown', close);
      });
    }, 0);
  }

  var lastPointer = null;

  // Screen point -> world coordinates -> menu. Shared by the left-click tap
  // handler and the right-click handler.
  function openTravelMenu(clientX, clientY) {
    var map = worldMapView();
    var canvas = map && map.canvas;
    if (!canvas || typeof map.convertCanvasToGridCoordinate !== 'function') return;
    var r = canvas.getBoundingClientRect();
    // Canvas backing store can differ from its CSS size — scale the click.
    var cx = (clientX - r.left) * (canvas.width / r.width);
    var cy = (clientY - r.top) * (canvas.height / r.height);
    var g;
    try { g = map.convertCanvasToGridCoordinate(cx, cy); } catch (e) { return; }
    if (!g || g.i == null) return;
    travelMenu(clientX, clientY, '(' + g.i + ',' + g.j + ')', function () {
      emit({ type: 'travel-started', x: g.i, y: g.j });
      travelTo({ worldX: g.i, worldY: g.j });
    });
  }

  // The client's own world-map context menu (the one with "Placer un point de
  // repère") is a generic .contextContent popup whose entries are plain
  // .cmButton divs, and whose header already prints the clicked coordinates as
  // "Coord. x,y". So rather than drawing our own menu, watch for that popup and
  // splice a "Courir ici" button into it, styled like its siblings.
  var COORD_RE = /Coord\.\s*(-?\d+)\s*,\s*(-?\d+)/;

  // The client keeps ~30 recycled .entryList nodes in the DOM and only ever
  // shows one, so target the visible one — picking any match gives stale
  // coordinates from a previous open.
  function visibleEntryList() {
    var lists = document.querySelectorAll('.entryList');
    for (var i = 0; i < lists.length; i++) {
      var l = lists[i];
      if (l.getBoundingClientRect().width > 0 && listCoords(l)) return l;
    }
    return null;
  }

  // Read the coordinates from the client's own tooltip block, not from the
  // whole list: our injected label also contains an "(x,y)" pair, and matching
  // that would feed the entry its own stale text.
  function listCoords(list) {
    var tip = list.querySelector('.worldMapTooltip, .WorldMapTooltip') || list;
    var m = COORD_RE.exec(tip.textContent || '');
    return m ? { x: parseInt(m[1], 10), y: parseInt(m[2], 10) } : null;
  }

  function injectTravelEntry() {
    try {
      var list = visibleEntryList();
      if (!list) return;
      var c = listCoords(list);
      if (!c) return;

      // These nodes are recycled: an entry added on a previous open is still
      // here, showing stale coordinates. Refresh its label rather than bailing
      // out because one already exists.
      var want = 'Courir ici (' + c.x + ',' + c.y + ')';
      var existing = list.querySelector('.stakk-travel-entry');
      if (existing) {
        if (existing.textContent !== want) existing.textContent = want;
        return;
      }

      // Match the client's own entries so it looks native.
      var model = list.querySelector('.cmButton');
      var btn = document.createElement('div');
      btn.className = (model ? model.className : 'cmButton Button scaleOnPress') + ' stakk-travel-entry';
      btn.textContent = want;
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        // Re-read at click time: this node is recycled, and the coordinates it
        // showed when injected may belong to an earlier open.
        var now = listCoords(list);
        if (!now) return;
        emit({ type: 'travel-started', x: now.x, y: now.y });
        travelTo({ worldX: now.x, worldY: now.y });
        var cancel = null;
        list.querySelectorAll('.cmButton').forEach(function (b) {
          if (/annuler|cancel/i.test(b.textContent || '')) cancel = b;
        });
        if (cancel) cancel.click();
      }, true);

      if (model) list.insertBefore(btn, model);
      else list.appendChild(btn);
    } catch (e) {}
  }

  // The popup is shown by toggling recycled nodes rather than inserting new
  // ones, so a childList observer alone misses it — watch attributes and style
  // changes too, and re-check on each mutation batch.
  function watchContextMenus() {
    try {
      var pending = false;
      var obs = new MutationObserver(function () {
        if (pending) return;
        pending = true;
        setTimeout(function () { pending = false; injectTravelEntry(); }, 30);
      });
      obs.observe(document.body, {
        childList: true, subtree: true,
        attributes: true, attributeFilter: ['style', 'class'],
      });
    } catch (e) {}
  }

  function installTravelHook() {
    if (travelHooked) return;
    var map = worldMapView();
    var canvas = map && map.canvas;
    if (!canvas || typeof map.convertCanvasToGridCoordinate !== 'function') return;

    // Left click is left alone: the client's own context menu already opens on
    // tap, and watchContextMenus() adds "Courir ici" to it. Right click keeps
    // our own menu as a fallback for spots where that popup does not appear.
    canvas.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var r = canvas.getBoundingClientRect();
      // Canvas backing store can differ from its CSS size — scale the click.
      var cx = (e.clientX - r.left) * (canvas.width / r.width);
      var cy = (e.clientY - r.top) * (canvas.height / r.height);
      openTravelMenu(e.clientX, e.clientY);
    }, true);

    travelHooked = true;
    emit({ type: 'travel-hook', ok: true });
  }

  // In-game toast, styled like the client's own transient messages, so an
  // interruption is visible where the player is actually looking instead of
  // only in the launcher console.
  function toast(text, kind) {
    try {
      var root = document.getElementById('stakk-toasts');
      if (!root) {
        root = document.createElement('div');
        root.id = 'stakk-toasts';
        root.style.cssText = [
          'position:fixed', 'top:64px', 'left:50%', 'transform:translateX(-50%)',
          'z-index:99998', 'display:flex', 'flex-direction:column', 'gap:6px',
          'align-items:center', 'pointer-events:none',
        ].join(';');
        document.body.appendChild(root);
      }
      var colors = {
        warn:  { bg: 'rgba(120,72,20,.95)',  bd: '#d79a3c' },
        info:  { bg: 'rgba(30,42,60,.95)',   bd: '#6f9bd1' },
        good:  { bg: 'rgba(32,72,40,.95)',   bd: '#79c06a' },
      };
      var c = colors[kind] || colors.info;
      var el = document.createElement('div');
      el.textContent = text;
      el.style.cssText = [
        'background:' + c.bg, 'border:1px solid ' + c.bd, 'border-radius:4px',
        'color:#f2e9d6', 'font:13px/1.3 sans-serif', 'padding:7px 14px',
        'box-shadow:0 2px 10px rgba(0,0,0,.5)', 'opacity:0',
        'transition:opacity .18s, transform .18s', 'transform:translateY(-6px)',
        'max-width:80vw', 'text-align:center',
      ].join(';');
      root.appendChild(el);
      requestAnimationFrame(function () {
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      });
      setTimeout(function () {
        el.style.opacity = '0';
        el.style.transform = 'translateY(-6px)';
        setTimeout(function () { el.remove(); }, 220);
      }, 2600);
    } catch (e) {}
  }

  // --- Auto-harvest ----------------------------------------------------------
  // Gather every resource the character can actually use on the current map,
  // then travel to the next point of a user-defined circuit and repeat.
  //
  // Timings are deliberately randomised: a fixed cadence is the most obvious
  // signature a gathering loop can have. This does not make the behaviour
  // undetectable — a loop that never rests still looks like a loop.
  // Any move or interaction the player triggers themselves cancels whatever the
  // launcher is doing. The client funnels both through isoEngine, so patch
  // those two entry points and flag calls that did not come from us.
  // True while the launcher is driving the character. A fixed release delay was
  // wrong: the client re-enters _movePlayerOnMap for the whole walk to a
  // resource, which outlasts any timeout, and those internal calls then looked
  // like the player acting and cancelled the run. So the flag stays up for as
  // long as our operation does, and only a call arriving while nothing of ours
  // is running counts as manual.
  var selfDriving = 0;
  function beginSelf() { selfDriving++; }
  function endSelf() { if (selfDriving > 0) selfDriving--; }
  function asSelf(fn) {
    beginSelf();
    try { return fn(); } finally {
      // Cover the client's synchronous re-entry, then hand control back.
      setTimeout(endSelf, 400);
    }
  }

  var onManualAction = null;   // set by the features that want interrupting
  function installManualWatch() {
    try {
      var iso = window.isoEngine;
      if (!iso || iso.__stakkManualWatch) return;
      iso.__stakkManualWatch = true;
      ['_movePlayerOnMap', '_useInteractive'].forEach(function (name) {
        var orig = iso[name];
        if (typeof orig !== 'function') return;
        iso[name] = function () {
          if (!selfDriving && typeof onManualAction === 'function') {
            try { onManualAction(name); } catch (e) {}
          }
          return orig.apply(this, arguments);
        };
      });
    } catch (e) {}
  }

  // Cursors seen on non-gathering interactions: 0 is the generic "use" and 8 is
  // a door. Everything else is treated as gatherable — an allow-list of cursor
  // ids was tried and wrongly rejected ore ("Collecter"), so exclude only what
  // is known not to be a resource.
  var NON_HARVEST_CURSORS = [0, 8];

  var harvest = {
    on: false,
    stage: 'idle',      // what the loop is doing right now
    since: 0,           // when that stage started, to spot a stall
    circuit: [],        // [{x, y}] world coordinates to cycle through
    index: 0,
    busy: false,
    paused: false,      // set while in a fight
    gathered: 0,
    lastError: null,
  };

  function rnd(min, max) { return min + Math.random() * (max - min); }
  function jitter(ms, spread) { return Math.round(ms * rnd(1 - spread, 1 + spread)); }

  // Fight state, from whichever of the client's flags is present: isFighting
  // alone was not reliable here (followers kept mirroring during a fight).
  // Fight events set fightSeen as a belt-and-braces signal too.
  var fightSeen = false;
  function inFight() {
    try {
      // Pinned from a live fight: playerData.isFighting is true and
      // fightManager.fightState is 1 once it runs.
      var gui = window.gui, pd = gui && gui.playerData;
      if (pd && pd.isFighting) return true;
      var fm = gui && gui.fightManager;
      if (fm && fm.fightState > 0) return true;
      if (fightSeen) return true;
    } catch (e) {}
    return false;
  }

  // Resources the client itself says this character can use right now:
  // enabledSkills is already filtered on job level and tool, so no whitelist
  // of our own is needed.
  // An element's position lives on its graphic in identifiedElements, as
  // `_position` — a cell number, not an object (statedElements is empty on
  // gathering maps). Scene x/y are there too and give a truer distance than
  // grid coordinates, since the isometric grid is not square.
  var _elemPos = {};
  function elementPos(id) {
    if (id in _elemPos) return _elemPos[id];
    var p = null;
    try {
      var g = window.isoEngine.mapRenderer.identifiedElements[id];
      if (g) {
        p = {
          cell: typeof g._position === 'number' ? g._position
              : (g._position && g._position.cellId != null ? g._position.cellId : null),
          x: typeof g._x === 'number' ? g._x : g.x,
          y: typeof g._y === 'number' ? g._y : g.y,
        };
        if (p.cell == null && p.x == null) p = null;
      }
    } catch (e) {}
    _elemPos[id] = p;
    return p;
  }

  function elementCell(id) {
    var p = elementPos(id);
    return p ? p.cell : null;
  }

  function harvestables() {
    var out = [];
    try {
      var mr = window.isoEngine && window.isoEngine.mapRenderer;
      if (!mr || !mr.isReady) return out;
      var els = mr.interactiveElements || {};
      // Interactive elements carry no cell of their own here (their keys are
      // _type/elementId/elementTypeId/enabledSkills/disabledSkills/_name/_isDoor);
      // position lives in statedElements. _useInteractive walks the character
      // there by itself, so a cell is only useful for ordering — never require it.
      var stated = mr.statedElements || {};
      for (var id in els) {
        var el = els[id];
        if (!el) continue;
        var skills = el.enabledSkills || [];
        if (!skills.length) continue;      // nothing this character can do with it
        if (el._isDoor) continue;          // doors are interactive, not resources
        // Pick the gathering skill, if any. Two filters, because neither alone
        // is enough: job id 1 ("Base") covers doors and generic "Utiliser", but
        // workshops and paddocks carry a real job id while still not being
        // resources. The cursor is what the client itself uses to decide which
        // interaction icon to draw, so it separates gathering from operating.
        var sk = null;
        for (var s = 0; s < skills.length; s++) {
          var c = skills[s];
          if (!c || !c._parentJobId || c._parentJobId === 1) continue;
          if (NON_HARVEST_CURSORS.indexOf(c._cursor) !== -1) continue;
          sk = c;
          break;
        }
        if (!sk) continue;
        var st = stated[id];
        var cell = st && (st.elementCellId != null ? st.elementCellId : st.cellId);
        out.push({
          elementId: el.elementId != null ? el.elementId : Number(id),
          cell: cell == null ? null : cell,
          skillUid: sk.skillInstanceUid != null ? sk.skillInstanceUid : sk.skillId,
          name: sk._name || sk.nameId || '',
          job: sk._parentJobName || '',
        });
      }
    } catch (e) {}
    return out;
  }

  // Trigger one resource the way tapping it does. The client walks the
  // character there itself and runs the job animation.
  function useResource(r) {
    try {
      asSelf(function () { window.isoEngine._useInteractive(r.elementId, r.skillUid); });
      return true;
    } catch (e) {
      harvest.lastError = String(e);
      return false;
    }
  }

  // A gather is done when the element stops being usable (it turns into its
  // depleted state) or the character has been idle for a while.
  // The character's animation says exactly what it is doing: the job animations
  // ("AnimPioche", "AnimFaux", ...) play for the whole gather, and idle is
  // "AnimStatique". Watching stillness alone detected the START of a gather,
  // not its end, since the character stands still while harvesting.
  function animBase() {
    try {
      var s = window.actorManager.userActor.animSymbol;
      return (s && s.base) || '';
    } catch (e) { return ''; }
  }
  function isGatherAnim() {
    var b = animBase();
    return !!b && !/statique|marche|course|run|walk/i.test(b);
  }

  async function waitGatherDone(r, timeoutMs) {
    var t0 = Date.now();
    var started = false, movingSince = null;

    while (Date.now() - t0 < timeoutMs) {
      if (!harvest.on || inFight()) return false;

      // Phase 1: the client walks the character over. Cap it — an unreachable
      // resource would otherwise keep it walking until the timeout.
      if (!charIdle()) {
        if (movingSince === null) movingSince = Date.now();
        else if (Date.now() - movingSince > 12000) return false;
      } else {
        movingSince = null;
      }

      // Phase 2: the job animation runs, then returns to idle -> gathered.
      // Require stillness too: whatever the walk animation is called in this
      // client, it only plays while moving, so it cannot be mistaken for work.
      if (charIdle() && isGatherAnim()) {
        started = true;
      } else if (started) {
        return true;
      }

      // Gone from the usable list: harvested (or taken by someone else).
      if (!harvestables().some(function (h) { return h.elementId === r.elementId; })) return true;

      // Never walked and never animated: the request was refused.
      if (!started && charIdle() && Date.now() - t0 > 4000) return false;

      await tSleep(jitter(180, 0.3));
    }
    return started;
  }

  async function harvestCurrentMap() {
    var done = {};
    for (var pass = 0; pass < 40; pass++) {
      if (!harvest.on || inFight()) return;
      var list = harvestables().filter(function (r) { return !done[r.elementId]; });
      if (!list.length) return;

      // Nearest first, recomputed every pass: the character moves with each
      // gather, so a distance measured once at the start goes stale immediately.
      // Distance on the isometric grid. Dofus cells alternate half-step rows,
      // so a cell id converts to map coordinates as:
      //   row = floor(id / 14), col = id % 14
      //   x = col + (row - (row & 1)) / 2 ... expressed below via the standard
      //   (u, v) diagonal axes, on which straight-line distance is exact.
      // Scene x/y are not usable here: the actor's are tweened mid-animation
      // and some element graphics have none at all.
      var W = 14;
      var toUV = function (cell) {
        var row = Math.floor(cell / W), col = cell % W;
        var x = col + Math.floor(row / 2);
        var y = Math.floor((row + 1) / 2) - col + (W - 1);
        return { u: x, v: y };
      };
      var actor = window.actorManager.userActor;
      var me = toUV(actor.cellId);
      // Scene distance separates cells that tie on the grid (two elements can
      // both be 3 cells away yet 77 vs 207 pixels away), so prefer it and fall
      // back to the grid when a graphic carries no coordinates.
      var mx = typeof actor._x === 'number' ? actor._x : null;
      var my = typeof actor._y === 'number' ? actor._y : null;
      var dist = function (r) {
        var p = elementPos(r.elementId);
        if (!p || p.cell == null) return 1e6;   // unknown position: take it last
        if (mx != null && typeof p.x === 'number' && typeof p.y === 'number') {
          return Math.sqrt((p.x - mx) * (p.x - mx) + (p.y - my) * (p.y - my));
        }
        var t = toUV(p.cell);
        return (Math.abs(t.u - me.u) + Math.abs(t.v - me.v)) * 60;   // ~px per cell
      };
      list.sort(function (a, b) { return dist(a) - dist(b); });

      var r = list[0];
      done[r.elementId] = true;
      harvest.stage = 'use:' + r.elementId;
      harvest.since = Date.now();
      if (!useResource(r)) continue;
      // Held across the walk + animation: every engine call in between is ours.
      beginSelf();
      var ok;
      try { ok = await waitGatherDone(r, 15000); } finally { endSelf(); }
      harvest.stage = ok ? 'gathered' : 'skipped';
      if (ok) {
        harvest.gathered++;
        emit({ type: 'harvest-progress', gathered: harvest.gathered,
               name: r.name, job: r.job });
      } else {
        emit({ type: 'harvest-skip', name: r.name, id: r.elementId });
      }
      await tSleep(jitter(350, 0.5));
    }
  }

  async function harvestLoop() {
    if (harvest.busy) return;
    harvest.busy = true;
    try {
      while (harvest.on) {
        // A fight interrupts everything: wait it out rather than spinning.
        if (inFight()) {
          harvest.paused = true;
          toast('Combat — récolte en pause', 'warn');
          emit({ type: 'harvest-state', state: 'fight' });
          while (harvest.on && inFight()) await tSleep(2000);
          harvest.paused = false;
          if (!harvest.on) break;
          await tSleep(jitter(3000, 0.4));   // settle after the fight
          continue;
        }

        await waitFor(function () {
          return window.isoEngine.mapRenderer.isReady;
        }, 10000);
        _elemPos = {};   // element graphics are per-map
        harvest.stage = 'harvesting';
        harvest.since = Date.now();
        await harvestCurrentMap();
        if (!harvest.on) break;

        if (!harvest.circuit.length) {
          // No circuit: nothing left here, so wait for respawns. Poll rather
          // than sleeping through it, or a resource popping back looks like a
          // stall until the full delay elapses.
          harvest.stage = 'waiting-respawn';
          harvest.since = Date.now();
          for (var w = 0; w < 40 && harvest.on; w++) {
            await tSleep(jitter(1500, 0.3));
            if (inFight()) break;
            if (harvestables().length) break;
          }
          continue;
        }

        // Next point of the circuit, wrapping around.
        harvest.index = (harvest.index + 1) % harvest.circuit.length;
        var next = harvest.circuit[harvest.index];
        harvest.stage = 'travel:' + next.x + ',' + next.y;
        harvest.since = Date.now();
        emit({ type: 'harvest-state', state: 'travel', x: next.x, y: next.y });
        await tSleep(jitter(1500, 0.5));
        await travelTo({ worldX: next.x, worldY: next.y });
        await tSleep(jitter(1200, 0.5));
      }
    } catch (e) {
      harvest.lastError = String(e);
    }
    harvest.busy = false;
    toast('Récolte terminée — ' + harvest.gathered + ' ressource(s)', 'info');
    emit({ type: 'harvest-state', state: 'stopped', gathered: harvest.gathered });
  }

  // Join a fight another account just started. The join request is only valid
  // from the fight's map during placement, so travel there first if needed —
  // placement lasts long enough for a few map hops.
  async function joinFight(p) {
    try {
      if (inFight() || p.fightId == null) return;
      var iso = window.isoEngine;
      if (iso.mapRenderer.mapId !== p.mapId) {
        toast('Rejoint le combat du chef…', 'info');
        var dir = neighbourDir(p.mapId);
        if (dir) {
          // Adjacent map: one border hop, no world-map data needed.
          beginSelf();
          try { await hopToward(0, 0, [dir]); } finally { endSelf(); }
        } else {
          if (p.x == null) return;
          await travelTo({ worldX: p.x, worldY: p.y });
        }
        await waitFor(function () { return iso.mapRenderer.mapId === p.mapId && iso.mapRenderer.isReady; }, 5000);
        if (iso.mapRenderer.mapId !== p.mapId) return;
      }
      await tSleep(jitter(900, 0.4));
      // The challenge message usually joined already; only ask if it did not.
      if (!inFight()) send('GameFightJoinRequestMessage', { fighterId: p.playerId, fightId: p.fightId });
    } catch (e) {}
  }

  // Stop everything the launcher is driving. Called when the player acts.
  function abortAutomation(what) {
    var stopped = [];
    if (harvest.on) { harvest.on = false; stopped.push('récolte'); }
    if (!travelAbort) { travelAbort = true; stopped.push('trajet'); }
    if (stopped.length) {
      harvest.stage = 'interrupted:' + what;
      harvest.since = Date.now();
      toast(stopped.join(' + ') + ' interrompu' + (stopped.length > 1 ? 's' : '') +
            ' (action manuelle)', 'warn');
      emit({ type: 'automation-interrupted', by: what, stopped: stopped });
    }
  }

  function harvestStart(circuit) {
    if (Array.isArray(circuit)) harvest.circuit = circuit.filter(function (p) {
      return p && typeof p.x === 'number' && typeof p.y === 'number';
    });
    if (harvest.on) return;
    harvest.on = true;
    harvest.gathered = 0;
    harvest.index = 0;
    _elemPos = {};
    installManualWatch();
    onManualAction = abortAutomation;
    toast('Récolte auto activée' + (harvest.circuit.length
      ? ' — circuit de ' + harvest.circuit.length + ' points' : ''), 'good');
    emit({ type: 'harvest-state', state: 'started', points: harvest.circuit.length });
    harvestLoop();
  }

  function harvestStop() {
    harvest.on = false;
    travelAbort = true;
  }

  function travelDebug() {
    var out = { ping: 'alive' };
    function probe(name, fn) {
      try { out[name] = fn(); } catch (e) { out[name] = 'ERR: ' + String(e); }
    }
    probe('here', function () { return mapCoords(); });
    probe('lookupWorks', function () {
      var h = mapCoords();
      return h ? { at: subAreaAt(h.x, h.y), north3: subAreaAt(h.x, h.y - 3) } : 'no-pos';
    });
    // Real routes of increasing length, with timing.
    probe('routes', function () {
      var h = mapCoords();
      if (!h) return 'no-pos';
      var res = {};
      [[0,-3],[0,-8],[5,-10],[-6,4]].forEach(function (d) {
        var tx = h.x + d[0], ty = h.y + d[1];
        var t0 = Date.now();
        var p = findWorldPath(h.x, h.y, tx, ty);
        res[tx + ',' + ty] = p === null
          ? 'no-route (' + (Date.now() - t0) + 'ms)'
          : { steps: p.length, ms: Date.now() - t0, first: p.slice(0, 3) };
      });
      return res;
    });
    probe('menuHook', function () { return travelHooked; });
    return out;
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
    return tapElement(document.querySelector('.monsterInfoButton'));
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
      emit({ type: 'party-debug', what: 'invites envoyées', data: p.names });
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
        var partyId = party && (party._partyId != null ? party._partyId : party.partyId);
        if (partyId) {
          send('PartyFollowThisMemberRequestMessage', {
            partyId: partyId,
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
      ownNames = {};
      (p.names || []).forEach(function (n) { ownNames[n] = true; });
      autoAccept = !!p.autoAccept;
      autoAcceptGroup = !!p.autoAcceptGroup;
      joinLeaderFight = !!p.joinLeaderFight;
    } else if (p.type === 'hide-shop') {
      hideShop = !!p.on;
      setHideShop(hideShop);
    } else if (p.type === 'get-position') {
      var pos = readPosition();
      emit({ type: 'position', mapId: pos.mapId, cellId: pos.cellId, x: pos.x, y: pos.y,
             isPartyLeader: isPartyLeader(), inParty: partyLeaderId() != null,
             inFight: inFight() });
    } else if (p.type === 'mule-follow') {
      muleFollow(p.mapId, p.cellId, p.x, p.y);
    } else if (p.type === 'capture-portrait') {
      tryEmitPortrait();
    } else if (p.type === 'travel') {
      travelTo(p.target || {});
    } else if (p.type === 'travel-cancel') {
      travelAbort = true;
    } else if (p.type === 'eval') {
      // Run a snippet inside the game's main world and report the result, so
      // client internals can be inspected without reloading the account.
      var r;
      try { r = { ok: true, value: eval(p.code) }; } catch (e) { r = { ok: false, error: String(e) }; }
      try { JSON.stringify(r); } catch (e) { r = { ok: r.ok, value: String(r.value) }; }
      emit({ type: 'eval-result', data: r });
    } else if (p.type === 'harvest-start') {
      harvestStart(p.circuit);
    } else if (p.type === 'harvest-stop') {
      harvestStop();
    } else if (p.type === 'join-fight') {
      joinFight(p);
    } else if (p.type === 'harvest-toggle') {
      if (harvest.on) harvestStop(); else harvestStart(p.circuit);
    } else if (p.type === 'harvest-status') {
      emit({ type: 'harvest-status', data: {
        on: harvest.on, paused: harvest.paused, gathered: harvest.gathered,
        circuit: harvest.circuit, index: harvest.index,
        available: harvestables().length, lastError: harvest.lastError,
        stage: harvest.stage,
        stageAgeMs: harvest.since ? Date.now() - harvest.since : null,
        busy: harvest.busy, inFight: inFight(),
        charMoving: !charIdle(), mapReady: (function () {
          try { return window.isoEngine.mapRenderer.isReady; } catch (e) { return null; }
        })(),
      } });
    } else if (p.type === 'travel-debug') {
      emit({ type: 'travel-debug', data: travelDebug() });
    } else if (p.type === 'windows-debug') {
      emit({ type: 'windows-debug', data: windowsDebug() });
    }
  });

  function onGuiReady(gui) {
    // The world map canvas only exists once the window has been opened once.
    try {
      gui.on('worldMapOpened', installTravelHook);
    } catch (e) {}
    watchContextMenus();
    setInterval(installTravelHook, 3000);

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
    // The leader started a fight: tell the host so the other accounts can
    // join it during the placement phase. Coordinates travel with it so a
    // follower on another map can come over first.
    // A fight became visible on this map (the swords). If the party leader is
    // in it, join: local to the follower, nothing needed from the host. The
    // leader's own start event only serves to bring a remote follower onto the
    // map, after which this fires on arrival.
    gui.on('GameRolePlayShowChallengeMessage', function (msg) {
      try {
        if (!joinLeaderFight || inFight()) return;
        var leader = partyLeaderId();
        if (leader == null || leader === gui.playerData.id) return;
        var info = msg && (msg.commonsInfos || msg.commonInfos || msg);
        var teams = (info && info.fightTeams) || [];
        var found = false;
        for (var t = 0; t < teams.length && !found; t++) {
          var members = teams[t].teamMembers || [];
          for (var m = 0; m < members.length; m++) {
            if (members[m] && members[m].id === leader) { found = true; break; }
          }
          if (!found && teams[t].leaderId === leader) found = true;
        }
        emit({ type: 'join-fight-seen', fightId: info && info.fightId, leaderInIt: found });
        if (!found) return;
        setTimeout(function () {
          send('GameFightJoinRequestMessage', { fighterId: leader, fightId: info.fightId });
          toast('Rejoint le combat du chef', 'info');
        }, jitter(700, 0.5));
      } catch (e) {}
    });

    ['PartyCannotJoinErrorMessage', 'PartyInvitationCancelledForGuestMessage', 'PartyRefuseInvitationNotificationMessage'].forEach(function (name) {
      gui.on(name, function (m) { emit({ type: 'party-debug', what: name, data: m && (m.reason != null ? m.reason : '') }); });
    });
    // Robust join path: the client keeps every fight in placement on this map
    // in fightManager.notStartedFightList (pinned from a live session: entries
    // are FightCommonInformations with fightTeams[].leaderId / teamMembers[]).
    // Poll it — the challenge event never fired here — and join the one led
    // by the party leader, once per fight id.
    var joinedFights = {};
    setInterval(function () {
      try {
        if (!joinLeaderFight || inFight()) return;
        var leader = partyLeaderId();
        if (leader == null || leader === gui.playerData.id) return;
        var list = gui.fightManager && gui.fightManager.notStartedFightList;
        if (!list || !list.length) return;
        for (var i = 0; i < list.length; i++) {
          var f = list[i];
          if (!f || f.fightId == null || joinedFights[f.fightId]) continue;
          var teams = f.fightTeams || [], hit = false;
          for (var t = 0; t < teams.length && !hit; t++) {
            if (teams[t].leaderId === leader) hit = true;
            var mem = teams[t].teamMembers || [];
            for (var m = 0; m < mem.length && !hit; m++) if (mem[m] && mem[m].id === leader) hit = true;
          }
          if (!hit) continue;
          joinedFights[f.fightId] = true;
          (function (fid) {
            setTimeout(function () {
              if (inFight()) return;
              send('GameFightJoinRequestMessage', { fighterId: leader, fightId: fid });
              toast('Rejoint le combat du chef', 'info');
              emit({ type: 'party-debug', what: 'join-fight envoyé', data: { fightId: fid, leader: leader } });
            }, jitter(250, 0.6));
          })(f.fightId);
        }
      } catch (e) {}
    }, 300);

    // Placement: the server broadcasts every fighter's ready flag to the whole
    // fight. When the party leader's flips on, follow suit.
    // Placement: the server broadcasts every fighter's ready flag to the whole
    // fight as GameFightHumanReadyStateMessage {characterId, isReady}. The
    // client handles it on its connection manager (not re-emitted on gui) and
    // then calls actorManager.setReadyIconOnActor(id, isReady) — so hook that
    // call, which fires for every fighter whatever the message path.
    function onFighterReady(id, isReady) {
      try {
        if (!joinLeaderFight || !isReady) return;
        var leader = partyLeaderId();
        if (leader == null || id !== leader || id === gui.playerData.id) return;
        emit({ type: 'party-debug', what: 'chef prêt -> je me mets prêt', data: { leader: leader } });
        setTimeout(function () { send('GameFightReadyMessage', { isReady: true }); }, jitter(350, 0.6));
      } catch (e) {}
    }
    try {
      var am = window.actorManager;
      if (am && typeof am.setReadyIconOnActor === 'function' && !am.__stakkReadyHook) {
        am.__stakkReadyHook = true;
        var origReady = am.setReadyIconOnActor;
        am.setReadyIconOnActor = function (id, isReady) {
          onFighterReady(id, isReady);
          return origReady.apply(this, arguments);
        };
      }
    } catch (e) {}
    // Also listen on the connection manager directly (window.dofus.connectionManager).
    try {
      var cm = window.dofus && window.dofus.connectionManager;
      if (cm && typeof cm.on === 'function') {
        cm.on('GameFightHumanReadyStateMessage', function (e) { onFighterReady(e && e.characterId, e && e.isReady); });
      }
    } catch (e) {}

    gui.on('GameFightStartMessage', function () { fightSeen = true; });
    gui.on('GameFightEndMessage', function () { fightSeen = false; });
    gui.on('GameContextDestroyMessage', function () { fightSeen = false; });
    gui.on('GameFightStartingMessage', function (msg) {
      fightSeen = true;
      try {
        var c = mapCoords();
        emit({ type: 'fight-started', fightId: msg && msg.fightId,
               playerId: gui.playerData.id,
               isPartyLeader: isPartyLeader(), inParty: partyLeaderId() != null,
               mapId: window.isoEngine.mapRenderer.mapId,
               x: c ? c.x : null, y: c ? c.y : null });
      } catch (e) {}
    });

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
        emit({ type: 'party-debug', what: 'invitation reçue', data: {
          from: msg.fromName, fromId: msg.fromId, expect: expectInviteFrom,
          own: !!(ownIds[msg.fromId] || (msg.fromName && ownNames[msg.fromName])), autoGroup: autoAcceptGroup } });
        // Auto-accept only invites coming from another of the launcher's own
        // accounts (by player id, or name as a fallback), never from strangers.
        var fromOwn = !!(ownIds[msg.fromId] || (msg.fromName && ownNames[msg.fromName]));
        if ((autoAcceptGroup && fromOwn) || (expectInviteFrom && msg.fromName === expectInviteFrom)) {
          send('PartyAcceptInvitationMessage', { partyId: msg.partyId });
          // Cancel the expiry too: an orphan timer would later null out the
          // expectation armed by a second grouping within its 20s window.
          expectInviteFrom = null;
          if (expectTimer) { clearTimeout(expectTimer); expectTimer = null; }
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

// Must run before the client reads navigator/screen, so it is injected as
// early as the preload runs rather than waiting for the gui hook.
function injectDeviceSpoof(profile) {
  if (!profile) {
    ipcRenderer.sendToHost('qol', { type: 'spoof-error', error: 'no-profile' });
    return;
  }
  const run = () => {
    try {
      const root = document.head || document.documentElement;
      if (!root) return false;
      const script = document.createElement('script');
      script.textContent = '(' + deviceSpoof.toString() + ')(' + JSON.stringify(profile) + ');' +
        '(' + keepAlive.toString() + ')();';
      root.appendChild(script);
      script.remove();
      return true;
    } catch (err) {
      ipcRenderer.sendToHost('qol', { type: 'spoof-error', error: String(err) });
      return true;   // reported; don't spin
    }
  };
  // The preload can run before <html> exists, in which case appendChild would
  // throw and the spoof would silently never apply — retry until the document
  // is there, and no later than DOM ready.
  if (run()) return;
  const iv = setInterval(() => { if (run()) clearInterval(iv); }, 5);
  document.addEventListener('DOMContentLoaded', () => { clearInterval(iv); run(); }, { once: true });
}

ipcRenderer.invoke('spoof:profile').then(injectDeviceSpoof, (err) => {
  ipcRenderer.sendToHost('qol', { type: 'spoof-error', error: String(err) });
});

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
    // Auto-repeat while a key is held would re-fire a toggle (show/hide/show…).
    if (e.repeat) return;
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
