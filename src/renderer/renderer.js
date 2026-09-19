const $ = (id) => document.getElementById(id);

// The launcher's own console is not visible unless its devtools are open, so a
// broken renderer looked like "nothing happens". Send failures to app.log.
window.addEventListener('error', (e) => {
  try {
    window.touch.logDebug('[renderer-error]', { message: String(e.message), source: e.filename, line: e.lineno });
  } catch (err) {}
});
window.addEventListener('unhandledrejection', (e) => {
  try {
    window.touch.logDebug('[renderer-rejection]', { reason: String((e.reason && e.reason.message) || e.reason) });
  } catch (err) {}
});

// --- Language ----------------------------------------------------------------
// Dictionaries come from ../i18n/strings.js, loaded by a <script> tag before
// this file (the renderer has no bundler and no node integration, so it reads
// the copy the file registers on globalThis).
const I18N = globalThis.STAKK_I18N;
const KEYS = globalThis.STAKK_KEYS;
let lang = 'fr';
// What the Automatic setting resolves to on this machine, from the OS locale.
let autoLang = 'en';
const t = (key, params) => I18N.translate(lang, key, params);

// Fill every data-i18n hook in the markup. Called once at startup and again
// whenever the user switches language, so nothing needs a restart.
function applyI18n(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  document.documentElement.lang = lang;
  // The toolbar tooltips are drawn in CSS from data-tip (the native ones do not
  // show in a frameless window), so they are re-mirrored after each pass.
  for (const b of document.querySelectorAll('.bar-btn[title]')) {
    b.dataset.tip = b.getAttribute('title');
    b.removeAttribute('title');
  }
}

let gameUrl = null;
let gamePreloadUrl = null;
let settings = null;
let accounts = [];
let activeId = null;
const identities = {}; // accountId -> { name, id } reported by each game hook
const portraits = {}; // accountId -> data URL of the captured character portrait
const sessionStats = {}; // accountId -> { xp, kamas } gained since launch

// In-game actions the launcher can trigger (the touch client has no native
// keyboard shortcuts, so each opens the game's own window). The user assigns a
// trigger key to each; it applies to the active account.
const KEYBIND_ACTIONS = [
  { id: 'inventory', key: 'action.inventory', defaultKey: 'i' },
  { id: 'character', key: 'action.character', defaultKey: 'c' },
  { id: 'spells', key: 'action.spells', defaultKey: 's' },
  { id: 'quests', key: 'action.quests', defaultKey: 'q' },
  { id: 'jobs', key: 'action.jobs', defaultKey: 'j' },
  { id: 'bestiary', key: 'action.bestiary', defaultKey: 'b' },
  { id: 'achievements', key: 'action.achievements', defaultKey: 'y' },
  { id: 'map', key: 'action.map', defaultKey: 'm' },
  { id: 'social', key: 'action.social', defaultKey: 'f' },
  { id: 'guild', key: 'action.guild', defaultKey: 'g' },
  { id: 'alliance', key: 'action.alliance', defaultKey: 'a' },
  { id: 'market', key: 'action.market', defaultKey: 'h' },
  { id: 'koliseum', key: 'action.koliseum', defaultKey: 'k' },
  { id: 'dailyQuest', key: 'action.dailyQuest', defaultKey: 'd' },
  { id: 'groupSeeker', key: 'action.groupSeeker', defaultKey: 'r' },
  { id: 'toa', key: 'action.toa', defaultKey: 't' },
  { id: 'titles', key: 'action.titles', defaultKey: 'n' },
  { id: 'zaap', key: 'action.zaap', defaultKey: 'w' },
  { id: 'goultines', key: 'action.goultines', defaultKey: 'x' },
  { id: 'options', key: 'action.options', defaultKey: 'o' },
  { id: 'mount', key: 'action.mount', defaultKey: 'p' },
  { id: 'directory', key: 'action.directory', defaultKey: 'e' },
  { id: 'conquest', key: 'action.conquest', defaultKey: 'l' },
  { id: 'alignment', key: 'action.alignment', defaultKey: 'u' },
  { id: 'spouse', key: 'action.spouse', defaultKey: 'v' },
  { id: 'entities', key: 'action.entities', defaultKey: 'z' },
  { id: 'passTurn', key: 'action.passTurn', defaultKey: ' ' },
  { id: 'close', key: 'action.close', defaultKey: 'Escape' },
  // Spells sit on the number row, whose characters change with the layout
  // (AZERTY types & é " ' ( - è _ there), so they are bound to the position.
  { id: 'spell1', key: 'action.spell', keyParams: { n: 1 }, defaultKey: 'code:Digit1' },
  { id: 'spell2', key: 'action.spell', keyParams: { n: 2 }, defaultKey: 'code:Digit2' },
  { id: 'spell3', key: 'action.spell', keyParams: { n: 3 }, defaultKey: 'code:Digit3' },
  { id: 'spell4', key: 'action.spell', keyParams: { n: 4 }, defaultKey: 'code:Digit4' },
  { id: 'spell5', key: 'action.spell', keyParams: { n: 5 }, defaultKey: 'code:Digit5' },
  { id: 'spell6', key: 'action.spell', keyParams: { n: 6 }, defaultKey: 'code:Digit6' },
  { id: 'spell7', key: 'action.spell', keyParams: { n: 7 }, defaultKey: 'code:Digit7' },
  { id: 'spell8', key: 'action.spell', keyParams: { n: 8 }, defaultKey: 'code:Digit8' },
];

// Drives the platform rules in style.css: macOS runs a native window, so its
// own controls replace the custom ones in the brand bar.
document.documentElement.dataset.platform = window.touch.platform;

$('min').onclick = () => window.touch.windowMinimize();
$('max').onclick = () => window.touch.windowToggleMaximize();
$('close').onclick = () => window.touch.windowClose();

// Support link, opened in the default browser (main restricts app:open-external
// to https).
const STAKK_KOFI_URL = 'https://ko-fi.com/touchinstakk';
$('kofi').onclick = () => window.touch.openExternal(STAKK_KOFI_URL);
const STAKK_DISCORD_URL = 'https://discord.gg/7R2tFcAkMy';
$('discord').onclick = () => window.touch.openExternal(STAKK_DISCORD_URL);

const DONATION_STORAGE_KEY = 'stakk-donation-dismissed';
const CHANGELOG_STORAGE_KEY = 'stakk-changelog-dismissed-version';
let appVersion = '';
function closeDonation() {
  if ($('donation-dismiss').checked) localStorage.setItem(DONATION_STORAGE_KEY, '1');
  $('donation-modal').hidden = true;
  showChangelogIfNeeded();
}
function showDonationIfNeeded() {
  if (localStorage.getItem(DONATION_STORAGE_KEY) !== '1') $('donation-modal').hidden = false;
  else showChangelogIfNeeded();
}
function openChangelog() {
  $('changelog-version').textContent = appVersion || '—';
  $('changelog-dismiss').checked = localStorage.getItem(CHANGELOG_STORAGE_KEY) === appVersion;
  $('changelog-modal').hidden = false;
}
function closeChangelog() {
  if ($('changelog-dismiss').checked && appVersion) localStorage.setItem(CHANGELOG_STORAGE_KEY, appVersion);
  $('changelog-modal').hidden = true;
}
function showChangelogIfNeeded() {
  if (appVersion && localStorage.getItem(CHANGELOG_STORAGE_KEY) !== appVersion) openChangelog();
}
$('donation-kofi').onclick = () => window.touch.openExternal(STAKK_KOFI_URL);
$('donation-close').onclick = closeDonation;
$('changelog-close').onclick = closeChangelog;

// Quick window-size presets, kept on the game's 1440/800 aspect ratio so the
// view never letterboxes. Clicking one fills the width/height inputs; the user
// still confirms with Enregistrer.
const RESOLUTION_PRESETS = [
  { key: 'preset.compact', width: 1152, height: 640 },
  { key: 'preset.default', width: 1440, height: 800 },
  { key: 'preset.large', width: 1600, height: 889 },
  { key: 'preset.xl', width: 1920, height: 1067 },
];
const GAME_RATIO = 1440 / 800;
// Width and height are independent: the window is free-form and the game
// letterboxes inside it. The slider drives both on the game's ratio (capped by
// the screen) as a convenience; the number inputs override either one alone.
// The window follows live as a preview (Annuler puts it back).
function setResolution(w, h, source) {
  const maxW = Math.max(960, screen.availWidth);
  const maxH = Math.max(600, screen.availHeight);
  if (source === 'slider') h = Math.round(w / GAME_RATIO);
  if (source === 'width') h = Number($('res-h').value);
  if (source === 'height') w = Number($('res-w').value);
  w = Math.min(maxW, Math.max(960, Math.round(w)));
  h = Math.min(maxH, Math.max(600, Math.round(h)));
  if (source !== 'width') $('res-w').value = w;
  if (source !== 'height') $('res-h').value = h;
  $('res-slider').value = w;
  const fit = Math.round((w / screen.availWidth) * 100);
  $('res-hint').textContent = fit >= 100 ? t('res.full') : t('res.percent', { pct: fit });
  markActivePreset();
  previewResolution(w, h);
}
let previewTimer = null;
// The window size the settings dialog opened at, so Annuler restores what was
// on screen rather than the nominal saved resolution.
let sizeBeforePreview = null;
function previewResolution(w, h) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => window.touch.previewSize(w, h), 120);
}
function renderPresets() {
  const box = $('res-presets');
  box.innerHTML = '';
  // 'Écran' is the display's usable area exactly — no ratio fit, since the
  // window no longer has to match the game's aspect.
  const presets = [...RESOLUTION_PRESETS.filter((p) => p.width <= screen.availWidth),
                   { key: 'preset.screen', width: screen.availWidth, height: screen.availHeight }];
  for (const p of presets) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset-btn';
    b.dataset.w = p.width;
    b.dataset.h = p.height;
    b.textContent = t(p.key) + ' · ' + p.width + '×' + p.height;
    b.onclick = () => setResolution(p.width, p.height, 'preset');
    box.appendChild(b);
  }
  $('res-slider').max = Math.max(960, screen.availWidth);
}
function markActivePreset() {
  const w = Number($('res-w').value);
  const h = Number($('res-h').value);
  for (const b of $('res-presets').children) {
    b.classList.toggle('active', Number(b.dataset.w) === w && Number(b.dataset.h) === h);
  }
}

// Tab bar on top (default) or down the left side, per the user's choice.
function applyTabBarSide(on) {
  document.body.classList.toggle('side-tabs', !!on);
}

// Travel controls, exposed for now on the active account (a world-map click
// hook is the last-mile UI). window.stakkTravelDebug() prints the real client
// field names in-game so the travel seam can be finalized.
window.stakkTravel = (mapId, worldX, worldY, cellId) => {
  if (activeId) sendToView(activeId, { type: 'travel', target: { mapId, worldX, worldY, cellId } });
};
window.stakkTravelCancel = () => {
  if (activeId) sendToView(activeId, { type: 'travel-cancel' });
};
// Run code inside the active account's game world. Avoids relaunching (and
// re-authenticating) the client just to inspect something.
// Auto-harvest. circuit is a list of world coordinates to cycle through:
//   stakkHarvest([{x:5,y:-18},{x:5,y:-17}])
// Omit it to gather the current map only. stakkHarvestStop() halts it.
window.stakkHarvest = (circuit) => {
  if (activeId) sendToView(activeId, { type: 'harvest-start', circuit: circuit || [] });
};
window.stakkHarvestStop = () => {
  if (activeId) sendToView(activeId, { type: 'harvest-stop' });
};
window.stakkHarvestStatus = () => {
  if (activeId) sendToView(activeId, { type: 'harvest-status' });
};
window.stakkEval = (code) => {
  if (activeId) sendToView(activeId, { type: 'eval', code: String(code) });
};
window.stakkTravelDebug = () => {
  if (activeId) sendToView(activeId, { type: 'travel-debug' });
};
// Prints the client's real window ids + which interface shortcuts are broken.
window.stakkWindowsDebug = () => {
  if (activeId) sendToView(activeId, { type: 'windows-debug' });
};

$('add-tab').onclick = addAccount;
$('add-first').onclick = addAccount;
$('group-auto').onclick = groupAuto;
$('broadcast-toggle').onclick = toggleBroadcast;
$('harvest-toggle').onclick = toggleHarvest;

$('mule-toggle').onclick = toggleMuleFollow;
$('stats-btn').onclick = toggleStats;
$('stats-close').onclick = () => ($('stats-panel').hidden = true);

// Launcher hotkeys while the chrome (not a game webview) has focus. When a game
// webview has focus its preload forwards the same shortcuts over the 'hotkey'
// channel, so both focus states behave identically.
window.addEventListener('keydown', (e) => {
  if (e.key === 'F2' && !e.ctrlKey) {
    e.preventDefault();
    handleHotkey({ name: 'ready-all' });
  } else if (e.ctrlKey && KEYS.digitOfEvent(e) >= 1) {
    const i = KEYS.digitOfEvent(e) - 1;
    if (accounts[i]) {
      e.preventDefault();
      handleHotkey({ name: 'switch', index: i });
    }
  } else if (e.ctrlKey && e.key === 'Tab') {
    e.preventDefault();
    handleHotkey({ name: 'cycle', dir: e.shiftKey ? -1 : 1 });
  } else if (e.key === 'F11') {
    e.preventDefault();
    handleHotkey({ name: 'fullscreen' });
  }
});

function handleHotkey(hk) {
  if (!hk) return;
  if (hk.name === 'ready-all') broadcastToAll({ type: 'ready', value: true });
  else if (hk.name === 'switch') { if (accounts[hk.index]) setActive(accounts[hk.index].id); }
  else if (hk.name === 'cycle') cycleTab(hk.dir);
  else if (hk.name === 'fullscreen') window.touch.windowToggleFullscreen();
}

function cycleTab(dir) {
  if (!accounts.length) return;
  let i = accounts.findIndex((a) => a.id === activeId);
  if (i < 0) i = 0;
  i = (i + dir + accounts.length) % accounts.length;
  setActive(accounts[i].id);
}

// Attention badge (set by QoL events, cleared when the tab is viewed).
const alerted = new Set();
function setAlert(id, on) {
  if (on) alerted.add(id);
  else alerted.delete(id);
  const tab = document.getElementById(tabId(id));
  if (tab) tab.classList.toggle('alert', on);
}

async function reorder(draggedId, targetId) {
  if (draggedId === targetId) return;
  const from = accounts.findIndex((a) => a.id === draggedId);
  const to = accounts.findIndex((a) => a.id === targetId);
  if (from < 0 || to < 0) return;
  const [moved] = accounts.splice(from, 1);
  accounts.splice(to, 0, moved);
  await window.touch.accountsReorder(accounts.map((a) => a.id));
  renderTabs();
}
$('open-settings').onclick = openSettings;
$('close-settings').onclick = () => {
  clearTimeout(previewTimer);
  if (sizeBeforePreview) window.touch.previewSize(sizeBeforePreview.width, sizeBeforePreview.height);
  // The language preview is live too, so cancelling puts the saved one back.
  setLang(settings.lang || autoLang);
  $('settings-modal').hidden = true;
};
$('save-settings').onclick = saveSettings;
$('open-devtools').onclick = () => {
  const wv = activeId && document.getElementById(viewId(activeId));
  if (wv && wv.openDevTools) wv.openDevTools();
};

$('retry').onclick = retryPatch;

// --- Auto-update banner ------------------------------------------------------
$('update-install').onclick = () => window.touch.installUpdate();
window.touch.onUpdaterStatus((s) => {
  const banner = $('update-banner');
  const text = $('update-text');
  const install = $('update-install');
  if (s.status === 'available') { text.textContent = t('update.available', { version: s.version }); install.hidden = true; banner.hidden = false; }
  else if (s.status === 'downloading') { text.textContent = t('update.downloading', { percent: s.percent || 0 }); install.hidden = true; banner.hidden = false; }
  else if (s.status === 'ready') { text.textContent = t('update.ready', { version: s.version }); install.hidden = false; banner.hidden = false; }
  else if (s.status === 'error') { banner.hidden = true; }
});

const viewId = (id) => 'view-' + id;
const tabId = (id) => 'tab-' + id;

const ACCT = globalThis.STAKK_ACCOUNT_SETTINGS;

// The settings that apply to one account: the launcher's, unless that account
// has been made custom in the settings dialog.
function accountById(id) {
  return accounts.find((a) => a.id === id) || null;
}
function eff(id) {
  return ACCT.effectiveSettings(settings, accountById(id));
}

// What each account is doing, as reported by its hook: { online, inFight,
// myTurn, busy }. Drives the tab badges.
const accountStatus = {};

// Only one badge shows at a time - the most urgent thing about that account.
const TAB_STATE_GLYPH = { turn: '\u25C6', fight: '\u2694', travel: '\u27A4', harvest: '\u273F', offline: '\u25CB' };

function tabState(accountId) {
  const st = accountStatus[accountId];
  if (!st || !st.online) return 'offline';
  if (st.myTurn) return 'turn';
  if (st.inFight) return 'fight';
  if (st.busy === 'harvest') return 'harvest';
  if (st.busy === 'travel') return 'travel';
  return null;   // in game, nothing worth a badge
}

function paintTabState(accountId) {
  const tab = document.getElementById(tabId(accountId));
  const el = tab && tab.querySelector('.tab-state');
  if (!el) return;
  const state = tabState(accountId);
  el.className = 'tab-state' + (state ? ' ' + state : '');
  el.hidden = !state;
  el.textContent = state ? TAB_STATE_GLYPH[state] : '';
  el.title = state ? t('tab.state.' + state) : '';
}

// A stable colour per account so tabs are distinguishable at a glance.
const TAB_COLORS = ['#2fd08a', '#e6b450', '#5b8def', '#e5737b', '#b98cf0', '#40c4d6', '#e08a4a', '#7fce5a'];
const accountColor = (id) => TAB_COLORS[(id - 1) % TAB_COLORS.length];

async function init() {
  loadLayoutMap();
  await refreshPatchStatus();
  settings = await window.touch.getSettings();
  appVersion = await window.touch.getAppVersion();
  // Main owns the resolution (saved choice, else the OS locale); the first
  // paint below is already in the right language.
  const langInfo = await window.touch.getLang();
  autoLang = langInfo.auto;
  setLang(langInfo.lang);
  applyTabBarSide(settings.tabBarSide);
  gameUrl = await window.touch.getGameUrl();
  gamePreloadUrl = await window.touch.getGamePreloadUrl();
  const res = await window.touch.accountsList();
  accounts = res.accounts;
  for (const a of accounts) await createView(a);
  renderTabs();
  if (accounts.length) setActive(accounts[0].id);
  else showEmpty(true);
  showDonationIfNeeded();
}

function showEmpty(v) {
  $('empty').hidden = !v;
}

// Switch language in place: refill the markup, redraw the lists that build
// their own text, and hand the game hooks their own strings.
function setLang(next) {
  lang = I18N.LANGS.includes(next) ? next : 'fr';
  applyI18n();
  if (!$('settings-modal').hidden) {
    renderPresets();
    markActivePreset();
    renderKeybinds();
  }
  if (!$('stats-panel').hidden) renderStats();
  broadcastToAll({ type: 'strings', strings: I18N.gameStrings(lang) });
}

async function createView(account) {
  if (document.getElementById(viewId(account.id))) return;
  const partition = 'persist:acct-' + account.id;
  await window.touch.prepareSession(partition);
  const wv = document.createElement('webview');
  wv.id = viewId(account.id);
  wv.className = 'game';
  wv.setAttribute('partition', partition);
  wv.setAttribute('allowpopups', '');
  wv.setAttribute('preload', gamePreloadUrl);
  // Keep the game running while its tab is not the active one: without this
  // Chromium throttles the inactive webviews' timers.
  wv.setAttribute('webpreferences', 'backgroundThrottling=false');
  wv.setAttribute('src', gameUrl);
  wv.classList.add('inactive');
  wv.addEventListener('dom-ready', () => {
    applyMute();
    const e = eff(account.id);
    wv.send('keybinds', computeKeyToAction(e.keybinds));
    wv.send('qol', { type: 'no-confirm', on: !!e.noConfirm });
    wv.send('qol', { type: 'resource-overlay', on: !!e.showResources });
    wv.send('qol', { type: 'hide-shop', on: !!e.hideShop });
    wv.send('qol', { type: 'strings', strings: I18N.gameStrings(lang) });
  });
  wv.addEventListener('ipc-message', (e) => {
    if (e.channel === 'qol') handleQol(account.id, e.args[0]);
    else if (e.channel === 'hotkey') handleHotkey(e.args[0]);
    else if (e.channel === 'bcast-key') handleBcastKey(account.id, e.args[0]);
    else if (e.channel === 'bcast-action') handleBcastAction(account.id, e.args[0]);
  });
  $('views').appendChild(wv);
}

function removeView(id) {
  const wv = document.getElementById(viewId(id));
  if (wv) wv.remove();
}

function renderTabs() {
  const box = $('tabs');
  box.innerHTML = '';
  for (const a of accounts) {
    const tab = document.createElement('div');
    tab.className = 'tab' + (a.id === activeId ? ' active' : '') + (alerted.has(a.id) ? ' alert' : '');
    tab.id = tabId(a.id);
    tab.draggable = true;
    tab.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', String(a.id));
      tab.classList.add('dragging');
    });
    tab.addEventListener('dragend', () => tab.classList.remove('dragging'));
    tab.addEventListener('dragover', (e) => e.preventDefault());
    tab.addEventListener('drop', (e) => {
      e.preventDefault();
      reorder(Number(e.dataTransfer.getData('text/plain')), a.id);
    });

    let icon;
    if (portraits[a.id]) {
      icon = document.createElement('img');
      icon.className = 'tab-portrait';
      icon.src = portraits[a.id];
      icon.alt = '';
    } else {
      icon = document.createElement('span');
      icon.className = 'tab-dot';
      icon.style.background = accountColor(a.id);
    }

    const state = document.createElement('span');
    state.className = 'tab-state';
    state.hidden = true;

    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = a.name;
    label.onclick = () => setActive(a.id);
    label.ondblclick = () => renameTab(a);

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.textContent = '✕';
    close.onclick = (e) => {
      e.stopPropagation();
      removeTab(a);
    };

    tab.append(icon, state, label, close);
    box.appendChild(tab);
    paintTabState(a.id);
  }
}

// One place decides who is audible: global mute, or only the active tab when
// "mute inactive tabs" is on.
function applyMute() {
  for (const a of accounts) {
    const wv = document.getElementById(viewId(a.id));
    if (!wv || !wv.setAudioMuted) continue;
    const off = !!eff(a.id).muted || (!!settings.muteInactive && a.id !== activeId);
    try { wv.setAudioMuted(off); } catch {}
  }
}

function setActive(id) {
  activeId = id;
  alerted.delete(id);
  showEmpty(false);
  for (const a of accounts) {
    const wv = document.getElementById(viewId(a.id));
    if (wv) wv.classList.toggle('inactive', a.id !== id);
  }
  applyMute();
  if (broadcasting) updateBroadcastSource();
  renderTabs();
}

function handleQol(accountId, msg) {
  if (!msg) return;
  if (msg.type === 'identity') {
    identities[accountId] = { name: msg.name, id: msg.id };
    autoNameTab(accountId, msg.name);
    pushOwnAccounts();
  } else if (msg.type === 'stats') {
    sessionStats[accountId] = { xp: msg.xp || 0, kamas: msg.kamas || 0 };
    if (!$('stats-panel').hidden) renderStats();
  } else if (msg.type === 'position') {
    // Leader's position -> tell the mules (other accounts) to join its cell.
    if (msg.isPartyLeader) partyLeaderAcct = accountId;
    else if (partyLeaderAcct === accountId) partyLeaderAcct = null;
    if (muleFollowing && !msg.inFight && accountId === effectiveLeader() && msg.mapId != null && msg.cellId != null) {
      for (const a of accounts) {
        if (a.id !== accountId) sendToView(a.id, { type: 'mule-follow', mapId: msg.mapId, cellId: msg.cellId, x: msg.x, y: msg.y });
      }
    }
  } else if (msg.type === 'party-debug') {
    console.log('[group] ' + accountId + ' ' + msg.what, msg.data || '');
  } else if (msg.type === 'join-fight-seen') {
    console.log('[fight] ' + accountId + ' voit combat ' + msg.fightId + ' chef dedans=' + msg.leaderInIt);
  } else if (msg.type === 'fight-started') {
    console.log('[fight] ' + accountId + ' lance combat ' + msg.fightId + ' chef=' + msg.isPartyLeader + ' option=' + !!settings.joinLeaderFight);
    // The leader (pinned mule leader, else the tab you are on) starts a fight:
    // every other account joins it.
    // Grouped: only the party leader's fight counts. Ungrouped: fall back to
    // the pinned/active tab.
    const isLeader = msg.inParty ? msg.isPartyLeader : accountId === effectiveLeader();
    if (isLeader) {
      // Joining is the follower's own setting: a mule set to stay out stays out.
      for (const a of accounts) {
        if (a.id !== accountId && eff(a.id).joinLeaderFight) sendToView(a.id, { type: 'join-fight', ...msg });
      }
    }
  } else if (msg.type === 'my-turn') {
    const e = eff(accountId);
    if (e.switchOnTurn && activeId !== accountId) setActive(accountId);
    else if (activeId !== accountId) {
      setAlert(accountId, true);
      if (e.notifications) beep();
    }
    maybeAttention();
    pulseTab(accountId);
  } else if (msg.type === 'status') {
    accountStatus[accountId] = { online: !!msg.online, inFight: !!msg.inFight, myTurn: !!msg.myTurn, busy: msg.busy || null };
    paintTabState(accountId);
    // The toolbar's harvest button follows what the account reports, not our
    // optimistic guess when the button was pressed.
    if (msg.busy === 'harvest') harvesting.add(accountId); else harvesting.delete(accountId);
    renderHarvestButton();
  } else if (msg.type === 'whisper') {
    notify(accountId, t('notify.whisper', { from: msg.from || '?' }));
  } else if (msg.type === 'party-invite') {
    notify(accountId, t('notify.partyInvite', { from: msg.from || '?' }));
  } else if (msg.type === 'challenge-invite') {
    notify(accountId, t('notify.challenge', { from: msg.from || '?' }));
  } else if (msg.type === 'portrait') {
    if (msg.dataUrl) {
      portraits[accountId] = msg.dataUrl;
      renderTabs();
    }
  } else if (msg.type === 'travel-hook') {
    console.log('[travel] right-click hook installed on world map');
  } else if (msg.type === 'travel-started') {
    console.log('[travel] going to ' + msg.x + ',' + msg.y);
    notify(accountId, t('notify.travelStart', { x: msg.x, y: msg.y }));
  } else if (msg.type === 'travel-replan') {
    console.log('[travel] replan from ' + msg.x + ',' + msg.y + ' (' + msg.steps + ' steps)');
  } else if (msg.type === 'travel-plan') {
    console.log('[travel] plan ' + msg.steps + ' steps from ' + msg.x + ',' + msg.y);
  } else if (msg.type === 'travel-progress') {
    // Each hop, so a stalled trip shows where it stopped.
    console.log('[travel] ' + msg.x + ',' + msg.y + ' (hop ' + msg.hop + ')');
  } else if (msg.type === 'travel-done') {
    var where = msg.x != null ? t('notify.travelAt', { x: msg.x, y: msg.y }) : '';
    console.log('[travel] done ok=' + msg.ok + ' reason=' + msg.reason + where);
    notify(accountId, msg.ok ? t('notify.arrived') : t('notify.travelStopped', { reason: msg.reason || '?', where }));
  } else if (msg.type === 'harvest-progress') {
    console.log('[harvest] ' + msg.gathered + ' récolté(s) — ' + (msg.name || ''));
  } else if (msg.type === 'automation-interrupted') {
    harvesting.delete(accountId);
    renderHarvestButton();
    // The hook reports what it stopped as ids ('harvest', 'travel'), so each
    // side names them in its own language.
    const what = (msg.stopped || []).map((id) => t('game.' + id)).join(' + ');
    console.log('[stakk] action manuelle -> ' + what + ' interrompu(e)');
    notify(accountId, t('notify.interrupted', { what }));
  } else if (msg.type === 'harvest-skip') {
    console.log('[harvest] passé: ' + (msg.name || msg.id));
  } else if (msg.type === 'harvest-state') {
    if (msg.state === 'travel') console.log('[harvest] vers ' + msg.x + ',' + msg.y);
    else if (msg.state === 'fight') console.log('[harvest] combat — en pause');
    else if (msg.state === 'started') console.log('[harvest] démarré (' + msg.points + ' points)');
    else if (msg.state === 'stopped') {
      console.log('[harvest] arrêté — ' + msg.gathered + ' récolté(s)');
      harvesting.delete(accountId);
      renderHarvestButton();
      notify(accountId, t('notify.harvestStopped', { n: msg.gathered }));
    }
    if (msg.state === 'started') { harvesting.add(accountId); renderHarvestButton(); }
  } else if (msg.type === 'harvest-status') {
    console.log('[harvest-status]', msg.data);
  } else if (msg.type === 'spoof-error') {
    console.warn('[spoof] injection failed:', msg.error);
  } else if (msg.type === 'eval-result') {
    console.log('[eval]', msg.data);
  } else if (msg.type === 'travel-debug') {
    console.log('[travel-debug] account', accountId, msg.data);
    window.touch.logDebug('[travel-debug]', msg.data);
  } else if (msg.type === 'windows-debug') {
    // Prints the real window ids the client registers + which ACTION_WINDOW ids
    // are invalid, so broken interface shortcuts can be pinned to correct ids.
    console.log('[windows-debug] account', accountId, JSON.stringify(msg.data, null, 2));
    window.touch.logDebug('[windows-debug]', msg.data);
  } else if (msg.type === 'resource-debug') {
    // Why the resource labels drew nothing: which elements were found, how many
    // had a position, and which projection call answered.
    console.log('[resources]', msg);
    window.touch.logDebug('[resource-debug]', msg);
  } else if (msg.type === 'entities-debug') {
    window.touch.logDebug('[entities-debug]', msg);
  } else if (msg.type === 'disconnected') {
    notify(accountId, t('notify.disconnected'));
  }
}

function accountName(id) {
  const a = accounts.find((x) => x.id === id);
  return a ? a.name : t('account.fallback');
}

// Badge the tab, play a short tone, and raise a desktop notification (unless the
// tab is already the active one).
// Flash the taskbar entry when a background account needs attention and the
// launcher window isn't in the foreground.
function maybeAttention() {
  try { if (!document.hasFocus()) window.touch.signalAttention(); } catch (e) {}
}

// Auto-harvest on the active account. The button reflects that account's
// state, so switching tabs shows the right thing.
const harvesting = new Set();

function toggleHarvest() {
  if (!activeId) return;
  const on = harvesting.has(activeId);
  sendToView(activeId, { type: on ? 'harvest-stop' : 'harvest-start', circuit: [] });
  // Optimistic: the game confirms with harvest-state and corrects us if needed.
  if (on) harvesting.delete(activeId); else harvesting.add(activeId);
  renderHarvestButton();
}

function renderHarvestButton() {
  const btn = $('harvest-toggle');
  if (btn) btn.classList.toggle('on', activeId != null && harvesting.has(activeId));
}

function notify(accountId, text) {
  if (activeId !== accountId) setAlert(accountId, true);
  maybeAttention();
  if (!eff(accountId).notifications) return;
  beep();
  try {
    if (window.Notification) new Notification(accountName(accountId), { body: text, silent: true });
  } catch (e) {}
}

let audioCtx = null;
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.value = 880;
    const t = audioCtx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.14, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.start(t);
    osc.stop(t + 0.26);
  } catch (e) {}
}

// Name the tab after the connected character.
async function autoNameTab(accountId, charName) {
  if (!charName) return;
  const a = accounts.find((x) => x.id === accountId);
  if (!a || a.name === charName) return;
  a.name = charName;
  renderTabs();
  await window.touch.accountsRename(accountId, charName);
}

// Tell every account which character ids belong to the user, so each can
// auto-accept trades and duels coming from the others.
function pushOwnAccounts() {
  const ids = Object.values(identities).map((i) => i.id).filter((v) => v != null);
  const names = Object.values(identities).map((i) => i.name).filter(Boolean);
  // autoAccept / autoAcceptGroup / joinLeaderFight are per account, so each
  // view gets its own copy of the payload.
  for (const a of accounts) {
    const e = eff(a.id);
    sendToView(a.id, { type: 'own-accounts', ids, names,
      autoAccept: !!e.autoAcceptOwn, autoAcceptGroup: !!e.autoAcceptGroup, joinLeaderFight: !!e.joinLeaderFight });
  }
}

function toggleStats() {
  const panel = $('stats-panel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) renderStats();
}

const fmt = (n) => (n || 0).toLocaleString(I18N.LOCALES[lang]);

function renderStats() {
  const box = $('stats-list');
  box.innerHTML = '';
  if (!accounts.length) {
    box.innerHTML = '<div class="panel-empty"></div>';
    box.firstChild.textContent = t('stats.empty');
    return;
  }
  for (const a of accounts) {
    const s = sessionStats[a.id] || { xp: 0, kamas: 0 };
    const row = document.createElement('div');
    row.className = 'st';
    const name = document.createElement('span');
    name.className = 'st-name';
    name.textContent = a.name;
    const vals = document.createElement('span');
    vals.className = 'st-vals';
    const xp = document.createElement('span');
    xp.className = 'st-xp';
    xp.textContent = '+' + fmt(s.xp) + ' ' + t('stats.xp');
    const km = document.createElement('span');
    km.className = 'st-kamas';
    km.textContent = (s.kamas >= 0 ? '+' : '') + fmt(s.kamas) + ' ' + t('stats.kamas');
    vals.append(xp, km);
    row.append(name, vals);
    box.appendChild(row);
  }
}

function sendToView(accountId, payload) {
  const wv = document.getElementById(viewId(accountId));
  if (wv) wv.send('qol', payload);
}

// Form a party across accounts: the active tab is the leader and invites every
// other connected account; those accounts auto-accept the leader's invite.
function groupAuto() {
  const leader = accounts.find((a) => a.id === activeId);
  if (!leader) return;
  const leaderIdentity = identities[leader.id];
  // Say why nothing happens instead of silently doing nothing: identities only
  // arrive once each account is in game.
  if (!leaderIdentity) { notify(activeId, t('group.notInGame')); return; }
  const others = accounts.filter((a) => a.id !== leader.id && identities[a.id]);
  const notReady = accounts.filter((a) => a.id !== leader.id && !identities[a.id]).length;
  console.log('[group] chef=' + leaderIdentity.name + ' invités=' + others.map((a) => identities[a.id].name).join(',') + ' pas en jeu=' + notReady);
  if (!others.length) { notify(activeId, t('group.noOthers')); return; }
  for (const a of others) sendToView(a.id, { type: 'expect-invite', from: leaderIdentity.name });
  sendToView(leader.id, { type: 'invite', names: others.map((a) => identities[a.id].name) });
}

function broadcastToAll(payload) {
  for (const a of accounts) sendToView(a.id, payload);
}

// Toggle the game's native party-follow: every other account follows the active
// account (the leader). Requires the accounts to already share a party.
// Broadcast: mirror the active account's key presses onto the other accounts.
let broadcasting = false;
function toggleBroadcast() {
  broadcasting = !broadcasting;
  $('broadcast-toggle').classList.toggle('on', broadcasting);
  updateBroadcastSource();
  renderHarvestButton();
}

function updateBroadcastSource() {
  for (const a of accounts) {
    const wv = document.getElementById(viewId(a.id));
    if (wv) wv.send('bcast-mode', broadcasting && a.id === activeId);
  }
}

// Mirror an action from the active account to the others while broadcasting.
function handleBcastAction(sourceId, data) {
  if (!broadcasting || sourceId !== activeId || !data || !data.action) return;
  for (const a of accounts) {
    if (a.id !== sourceId) sendToView(a.id, { type: 'action', action: data.action });
  }
}

function keybindKey(action, binds) {
  const from = binds || (settings && settings.keybinds) || {};
  const bound = from[action.id];
  if (!bound) return action.defaultKey;
  // A spell saved as the character '3' dates from before the number row was
  // bound by position; read it as the position so it survives a layout change.
  if (action.id.startsWith('spell') && /^[0-9]$/.test(bound)) return KEYS.codeBinding('Digit' + bound);
  return bound;
}

// { keys, codes } -> actionId, pushed to each game preload. Accounts can carry
// their own bindings, so the tables are built per account.
function computeKeyToAction(binds) {
  const bound = {};
  for (const a of KEYBIND_ACTIONS) {
    const k = keybindKey(a, binds);
    if (k) bound[a.id] = k;
  }
  return KEYS.splitBindings(bound);
}

function pushKeybinds() {
  for (const a of accounts) {
    const wv = document.getElementById(viewId(a.id));
    if (wv) wv.send('keybinds', computeKeyToAction(eff(a.id).keybinds));
  }
}

// --- Keybind editor (settings modal) ---
let editingKeybinds = {};
let capturingAction = null;

function renderKeybinds() {
  const box = $('keybinds');
  box.innerHTML = '';
  for (const a of KEYBIND_ACTIONS) {
    const row = document.createElement('div');
    row.className = 'kb-row';
    const label = document.createElement('span');
    label.className = 'kb-label';
    label.textContent = actionLabel(a);
    const key = document.createElement('button');
    key.type = 'button';
    key.className = 'kb-key' + (capturingAction === a.id ? ' capturing' : '');
    key.textContent = capturingAction === a.id ? '…' : keyLabel(editingKeybinds[a.id] || a.defaultKey);
    key.onclick = () => startCapture(a.id);
    row.append(label, key);
    box.appendChild(row);
  }
}

// Spell rows share one key ('Sort {n}'), the others have their own.
function actionLabel(a) {
  return t(a.key, a.keyParams);
}

// Physical bindings are shown as the character that position types here, read
// from the OS layout — '1' on QWERTY, '&' on AZERTY — so the dialog matches the
// keycaps the user is looking at.
let layoutMap = null;
function loadLayoutMap() {
  try {
    if (!navigator.keyboard || !navigator.keyboard.getLayoutMap) return;
    navigator.keyboard.getLayoutMap().then((map) => {
      layoutMap = map;
      if (!$('settings-modal').hidden) renderKeybinds();
    }, () => {});
  } catch (e) {}
}

function keyLabel(k) {
  const code = KEYS.codeOf(k);
  if (code) {
    const digit = KEYS.digitOfCode(code);
    if (code.startsWith('Numpad')) return t('key.numpad', { n: digit });
    const typed = layoutMap && layoutMap.get ? layoutMap.get(code) : null;
    return (typed || String(digit)).toUpperCase();
  }
  if (k === ' ') return t('key.space');
  if (k === 'Escape') return t('key.escape');
  return k.length === 1 ? k.toUpperCase() : k;
}

function startCapture(actionId) {
  capturingAction = actionId;
  renderKeybinds();
}

// Capture phase so it runs before the launcher hotkey handler.
window.addEventListener(
  'keydown',
  (e) => {
    if (!capturingAction) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key !== 'Escape') editingKeybinds[capturingAction] = KEYS.bindingForEvent(e);
    capturingAction = null;
    renderKeybinds();
  },
  true
);

function handleBcastKey(sourceId, data) {
  if (!broadcasting || sourceId !== activeId || !data || !data.key) return;
  const targets = accounts
    .filter((a) => a.id !== sourceId)
    .map((a) => {
      const wv = document.getElementById(viewId(a.id));
      return wv ? wv.getWebContentsId() : null;
    })
    .filter(Boolean);
  if (targets.length) window.touch.broadcastKey(targets, data.key);
}

// Mule follow: poll the active account's position and mirror it onto the others.
let muleFollowing = false;
let muleTimer = null;
// The account being followed, pinned when the toggle is switched on. Keying off
// activeId instead made the leader change with every tab switch — the previous
// leader would then start walking to whichever account you had just opened.
let muleLeader = null;
// The account whose character leads the in-game party, learned from position
// reports. Wins over the pinned tab whenever the accounts are grouped.
let partyLeaderAcct = null;
function effectiveLeader() { return partyLeaderAcct || muleLeader || activeId; }
function toggleMuleFollow() {
  muleFollowing = !muleFollowing;
  muleLeader = muleFollowing ? activeId : null;
  $('mule-toggle').classList.toggle('on', muleFollowing);
  if (muleTimer) {
    clearInterval(muleTimer);
    muleTimer = null;
  }
  if (muleFollowing) {
    muleTimer = setInterval(() => {
      // Poll every account: each answers with its position and whether it
      // leads the party, which is how the leader is found.
      for (const a of accounts) sendToView(a.id, { type: 'get-position' });
    }, 600);
  }
}

// Native party-follow was folded into the mule follow (one "Suivre le chef"
// button): the mule path already crosses maps via travel and mirrors the cell.


function pulseTab(id) {
  const tab = document.getElementById(tabId(id));
  if (!tab) return;
  tab.classList.add('turn');
  setTimeout(() => tab.classList.remove('turn'), 2500);
}

async function addAccount() {
  const acc = await window.touch.accountsAdd();
  accounts.push(acc);
  await createView(acc);
  setActive(acc.id);
}

function renameTab(a) {
  const tab = document.getElementById(tabId(a.id));
  const label = tab.querySelector('.tab-label');
  const input = document.createElement('input');
  input.className = 'tab-input';
  input.value = a.name;
  let committed = false;
  const commit = async () => {
    if (committed) return;
    committed = true;
    const name = input.value.trim() || a.name;
    await window.touch.accountsRename(a.id, name);
    a.name = name;
    renderTabs();
  };
  input.onblur = commit;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      committed = true;
      renderTabs();
    }
  };
  label.replaceWith(input);
  input.focus();
  input.select();
}

async function removeTab(a) {
  // Following a leader that no longer exists would poll a dead view forever.
  if (muleLeader === a.id && muleFollowing) toggleMuleFollow();
  if (!window.confirm(t('account.remove', { name: a.name }))) return;
  await window.touch.accountsRemove(a.id);
  accounts = accounts.filter((x) => x.id !== a.id);
  removeView(a.id);
  if (activeId === a.id) {
    if (accounts.length) setActive(accounts[0].id);
    else {
      activeId = null;
      renderTabs();
      showEmpty(true);
    }
  } else {
    renderTabs();
  }
}

// --- Settings dialog scope --------------------------------------------------
// The dialog edits either the launcher's settings ('global') or one account's.
// Edits are kept per scope until Save, so switching scope loses nothing.
let scope = 'global';
let drafts = {};

const PER_ACCOUNT_FIELDS = [
  ['muted', 'muted'],
  ['notifications', 'notifications'],
  ['switch-on-turn', 'switchOnTurn'],
  ['auto-accept-own', 'autoAcceptOwn'],
  ['auto-accept-group', 'autoAcceptGroup'],
  ['join-leader-fight', 'joinLeaderFight'],
  ['no-confirm', 'noConfirm'],
  ['show-resources', 'showResources'],
  ['hide-shop', 'hideShop'],
];

function readPerAccountForm() {
  const out = {};
  for (const [id, key] of PER_ACCOUNT_FIELDS) out[key] = $(id).checked;
  out.keybinds = { ...editingKeybinds };
  return out;
}

function fillPerAccountForm(values) {
  for (const [id, key] of PER_ACCOUNT_FIELDS) $(id).checked = !!values[key];
  editingKeybinds = { ...(values.keybinds || {}) };
  capturingAction = null;
  renderKeybinds();
}

// Per-account controls are read-only while the account follows the launcher.
function setPerAccountEnabled(on) {
  for (const [id] of PER_ACCOUNT_FIELDS) $(id).disabled = !on;
  $('keybinds').classList.toggle('disabled', !on);
}

function captureScope() {
  if (scope === 'global') {
    drafts.global = {
      ...drafts.global,
      ...readPerAccountForm(),
      lang: $('lang').value === 'auto' ? null : $('lang').value,
      resolution: { width: Number($('res-w').value), height: Number($('res-h').value) },
      resolutionSet: true,
      tabBarSide: $('tabbar-side').checked,
      muteInactive: $('mute-inactive').checked,
      android: {
        enabled: $('android-enabled').checked,
        adbPath: $('android-adb').value.trim(),
        address: $('android-address').value.trim(),
      },
    };
    return;
  }
  const draft = drafts[scope] || (drafts[scope] = { custom: false, settings: {} });
  draft.custom = $('scope-custom').checked;
  if (draft.custom) draft.settings = readPerAccountForm();
}

function loadScope() {
  const isGlobal = scope === 'global';
  for (const el of document.querySelectorAll('[data-scope="global"]')) el.hidden = !isGlobal;
  $('scope-custom-row').hidden = isGlobal;

  if (isGlobal) {
    const g = drafts.global;
    const android = g.android || {};
    $('lang').value = g.lang || 'auto';
    $('tabbar-side').checked = !!g.tabBarSide;
    $('mute-inactive').checked = !!g.muteInactive;
    $('android-enabled').checked = !!android.enabled;
    $('android-adb').value = android.adbPath || 'adb.exe';
    $('android-address').value = android.address || '127.0.0.1:58526';
    fillPerAccountForm(g);
    setPerAccountEnabled(true);
    $('scope-hint').textContent = '';
    return;
  }
  const draft = drafts[scope] || (drafts[scope] = { custom: false, settings: {} });
  $('scope-custom').checked = !!draft.custom;
  fillPerAccountForm(draft.custom ? { ...drafts.global, ...draft.settings } : drafts.global);
  setPerAccountEnabled(!!draft.custom);
  $('scope-hint').textContent = draft.custom ? '' : t('settings.scope.inherited');
}

function renderScopeSelect() {
  const sel = $('scope-select');
  sel.innerHTML = '';
  const global = document.createElement('option');
  global.value = 'global';
  global.textContent = t('settings.scope.global');
  sel.appendChild(global);
  for (const a of accounts) {
    const opt = document.createElement('option');
    opt.value = String(a.id);
    opt.textContent = a.name;
    sel.appendChild(opt);
  }
  sel.value = scope === 'global' ? 'global' : String(scope);
}

$('scope-select').onchange = () => {
  captureScope();
  const v = $('scope-select').value;
  scope = v === 'global' ? 'global' : Number(v);
  loadScope();
};

$('scope-custom').onchange = () => {
  // Ticking the box starts from what the account has been running until now.
  const draft = drafts[scope] || (drafts[scope] = { custom: false, settings: {} });
  if ($('scope-custom').checked && !Object.keys(draft.settings || {}).length) {
    draft.settings = ACCT.pickPerAccount(drafts.global);
  }
  captureScope();
  loadScope();
};

async function openSettings() {
  const s = await window.touch.getSettings();
  scope = 'global';
  drafts = { global: { ...s } };
  for (const a of accounts) {
    drafts[a.id] = { custom: !!a.custom, settings: { ...(a.settings || {}) } };
  }
  renderScopeSelect();
  // Before the user picks a size the window is screen-sized, so show that
  // rather than the nominal saved default.
  sizeBeforePreview = { width: window.outerWidth, height: window.outerHeight };
  const shownW = s.resolutionSet ? s.resolution.width : window.outerWidth;
  const shownH = s.resolutionSet ? s.resolution.height : window.outerHeight;
  $('res-w').value = shownW;
  $('res-h').value = shownH;
  $('res-slider').value = shownW;
  $('res-hint').textContent = '';
  markActivePreset();
  renderPresets();
  markActivePreset();
  $('res-w').oninput = () => setResolution(Number($('res-w').value), 0, 'width');
  $('res-h').oninput = () => setResolution(0, Number($('res-h').value), 'height');
  $('res-slider').oninput = () => setResolution(Number($('res-slider').value), 0, 'slider');
  // Live like the size preview: pick a language and the dialog is already in it.
  $('lang').onchange = () => setLang($('lang').value === 'auto' ? autoLang : $('lang').value);
  loadScope();
  refreshAndroidStatus();
  $('settings-modal').hidden = false;
}

async function refreshAndroidStatus() {
  const status = await window.touch.getAndroidStatus();
  if (!status.installed) {
    $('android-status').textContent = t('field.android.status.missing') + ': ' + (status.reason || '');
  } else {
    $('android-status').textContent = t('field.android.status.ready', { packageName: status.gamePackage || '—' });
  }
}

$('android-launch').onclick = async () => {
  try {
    captureScope();
    if (!drafts.global.android.enabled) throw new Error(t('field.android.disabled'));
    settings = await window.touch.setSettings(drafts.global);
    await window.touch.launchAndroidClient();
    $('android-status').textContent = t('field.android.status.launched');
  } catch (error) {
    $('android-status').textContent = error.message || String(error);
  }
};

// Comfort options are per account, so each view gets its own values.
function pushComfort() {
  for (const a of accounts) {
    const e = eff(a.id);
    sendToView(a.id, { type: 'no-confirm', on: !!e.noConfirm });
    sendToView(a.id, { type: 'resource-overlay', on: !!e.showResources });
    sendToView(a.id, { type: 'hide-shop', on: !!e.hideShop });
  }
}

async function saveSettings() {
  captureScope();
  // null for the language means "follow the OS", which is what Auto shows.
  settings = await window.touch.setSettings(drafts.global);
  for (const a of accounts) {
    const draft = drafts[a.id];
    if (!draft) continue;
    const saved = await window.touch.accountsSetSettings(a.id, draft);
    if (saved) {
      a.custom = !!saved.custom;
      a.settings = saved.settings || {};
    }
  }
  applyMute();
  setLang(settings.lang || autoLang);
  applyTabBarSide(settings.tabBarSide);
  pushKeybinds();
  pushOwnAccounts();
  pushComfort();
  $('settings-modal').hidden = true;
}

async function refreshPatchStatus() {
  const ok = await window.touch.getPatchStatus();
  $('patch-warn').hidden = ok;
}

async function retryPatch() {
  $('retry').disabled = true;
  const ok = await window.touch.retryPatch();
  $('patch-warn').hidden = ok;
  $('retry').disabled = false;
}

init();


