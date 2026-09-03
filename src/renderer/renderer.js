const $ = (id) => document.getElementById(id);

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
  { id: 'inventory', label: 'Inventaire', defaultKey: 'i' },
  { id: 'character', label: 'Caractéristiques', defaultKey: 'c' },
  { id: 'spells', label: 'Sorts', defaultKey: 's' },
  { id: 'quests', label: 'Quêtes', defaultKey: 'q' },
  { id: 'jobs', label: 'Métiers', defaultKey: 'j' },
  { id: 'bestiary', label: 'Bestiaire', defaultKey: 'b' },
  { id: 'achievements', label: 'Succès', defaultKey: 'y' },
  { id: 'map', label: 'Carte', defaultKey: 'm' },
  { id: 'social', label: 'Amis', defaultKey: 'f' },
  { id: 'guild', label: 'Guilde', defaultKey: 'g' },
  { id: 'alliance', label: 'Alliance', defaultKey: 'a' },
  { id: 'market', label: 'Hôtel de vente', defaultKey: 'h' },
  { id: 'koliseum', label: 'Koliseum', defaultKey: 'k' },
  { id: 'dailyQuest', label: 'Quêtes du jour', defaultKey: 'd' },
  { id: 'groupSeeker', label: 'Recherche de groupe', defaultKey: 'r' },
  { id: 'toa', label: 'Temple (TOA)', defaultKey: 't' },
  { id: 'titles', label: 'Titres / Ornements', defaultKey: 'n' },
  { id: 'zaap', label: 'Zaap / Téléportation', defaultKey: 'w' },
  { id: 'goultines', label: 'Boutique (goultines)', defaultKey: 'x' },
  { id: 'options', label: 'Options', defaultKey: 'o' },
  { id: 'mount', label: 'Monture', defaultKey: 'p' },
  { id: 'directory', label: 'Annuaire', defaultKey: 'e' },
  { id: 'conquest', label: 'Conquête (AvA)', defaultKey: 'l' },
  { id: 'alignment', label: 'Alignement', defaultKey: 'u' },
  { id: 'spouse', label: 'Conjoint', defaultKey: 'v' },
  { id: 'entities', label: 'Afficher les entités', defaultKey: 'z' },
  { id: 'close', label: 'Fermer les interfaces', defaultKey: 'Escape' },
  { id: 'spell1', label: 'Sort 1', defaultKey: '1' },
  { id: 'spell2', label: 'Sort 2', defaultKey: '2' },
  { id: 'spell3', label: 'Sort 3', defaultKey: '3' },
  { id: 'spell4', label: 'Sort 4', defaultKey: '4' },
  { id: 'spell5', label: 'Sort 5', defaultKey: '5' },
  { id: 'spell6', label: 'Sort 6', defaultKey: '6' },
  { id: 'spell7', label: 'Sort 7', defaultKey: '7' },
  { id: 'spell8', label: 'Sort 8', defaultKey: '8' },
];

$('min').onclick = () => window.touch.windowMinimize();
$('max').onclick = () => window.touch.windowToggleMaximize();
$('close').onclick = () => window.touch.windowClose();

// Community link. Replace with your own invite; opened in the default browser
// (main restricts app:open-external to https).
const STAKK_DISCORD_URL = 'https://discord.gg/your-invite';
$('discord').onclick = () => window.touch.openExternal(STAKK_DISCORD_URL);

// Quick window-size presets, kept on the game's 1440/800 aspect ratio so the
// view never letterboxes. Clicking one fills the width/height inputs; the user
// still confirms with Enregistrer.
const RESOLUTION_PRESETS = [
  { label: 'Compact', width: 1152, height: 640 },
  { label: 'Défaut', width: 1440, height: 800 },
  { label: 'Large', width: 1600, height: 889 },
  { label: 'XL', width: 1920, height: 1067 },
];
const GAME_RATIO = 1440 / 800;
// Width and height stay linked on the game's ratio: editing either one, the
// slider or a preset updates the rest, and the window follows live as a
// preview (Annuler puts it back).
function setResolution(w, h, source) {
  const maxW = Math.max(960, screen.availWidth);
  if (source === 'height') w = Math.round(h * GAME_RATIO);
  w = Math.min(maxW, Math.max(960, Math.round(w)));
  h = Math.round(w / GAME_RATIO);
  if (source !== 'width') $('res-w').value = w;
  if (source !== 'height') $('res-h').value = h;
  $('res-slider').value = w;
  const fit = Math.round((w / screen.availWidth) * 100);
  $('res-hint').textContent = fit >= 100 ? 'Plein écran' : fit + ' % de l\'écran';
  markActivePreset();
  previewResolution(w, h);
}
let previewTimer = null;
function previewResolution(w, h) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => window.touch.previewSize(w, h), 120);
}
function renderPresets() {
  const box = $('res-presets');
  box.innerHTML = '';
  const fitW = Math.min(screen.availWidth, Math.round(screen.availHeight * GAME_RATIO));
  const presets = [...RESOLUTION_PRESETS.filter((p) => p.width <= screen.availWidth),
                   { label: 'Écran', width: fitW, height: Math.round(fitW / GAME_RATIO) }];
  for (const p of presets) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset-btn';
    b.dataset.w = p.width;
    b.textContent = p.label + ' · ' + p.width + '×' + p.height;
    b.onclick = () => setResolution(p.width, p.height, 'preset');
    box.appendChild(b);
  }
  $('res-slider').max = Math.max(960, screen.availWidth);
}
function markActivePreset() {
  const w = Number($('res-w').value);
  for (const b of $('res-presets').children) b.classList.toggle('active', Number(b.dataset.w) === w);
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

// Mirror each toolbar button's title into data-tip: the CSS tooltip renders it,
// since the native one does not appear in a frameless window on macOS.
for (const b of document.querySelectorAll('.bar-btn[title]')) {
  b.dataset.tip = b.getAttribute('title');
  b.removeAttribute('title');
}
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
  } else if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
    const i = Number(e.key) - 1;
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
$('close-settings').onclick = () => { clearTimeout(previewTimer); window.touch.previewSize(settings.resolution.width, settings.resolution.height); (() => ($('settings-modal').hidden = true))(); };
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
  if (s.status === 'available') { text.textContent = `Mise à jour ${s.version} disponible — téléchargement…`; install.hidden = true; banner.hidden = false; }
  else if (s.status === 'downloading') { text.textContent = `Téléchargement de la mise à jour… ${s.percent || 0}%`; install.hidden = true; banner.hidden = false; }
  else if (s.status === 'ready') { text.textContent = `Mise à jour ${s.version} prête.`; install.hidden = false; banner.hidden = false; }
  else if (s.status === 'error') { banner.hidden = true; }
});

const viewId = (id) => 'view-' + id;
const tabId = (id) => 'tab-' + id;

// A stable colour per account so tabs are distinguishable at a glance.
const TAB_COLORS = ['#2fd08a', '#e6b450', '#5b8def', '#e5737b', '#b98cf0', '#40c4d6', '#e08a4a', '#7fce5a'];
const accountColor = (id) => TAB_COLORS[(id - 1) % TAB_COLORS.length];

async function init() {
  await refreshPatchStatus();
  settings = await window.touch.getSettings();
  applyTabBarSide(settings.tabBarSide);
  gameUrl = await window.touch.getGameUrl();
  gamePreloadUrl = await window.touch.getGamePreloadUrl();
  const res = await window.touch.accountsList();
  accounts = res.accounts;
  for (const a of accounts) await createView(a);
  renderTabs();
  if (accounts.length) setActive(accounts[0].id);
  else showEmpty(true);
}

function showEmpty(v) {
  $('empty').hidden = !v;
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
    wv.send('keybinds', computeKeyToAction());
    wv.send('qol', { type: 'no-confirm', on: !!settings.noConfirm });
    wv.send('qol', { type: 'resource-overlay', on: !!settings.showResources });
    wv.send('qol', { type: 'hide-shop', on: !!settings.hideShop });
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

    tab.append(icon, label, close);
    box.appendChild(tab);
  }
}

// One place decides who is audible: global mute, or only the active tab when
// "mute inactive tabs" is on.
function applyMute() {
  for (const a of accounts) {
    const wv = document.getElementById(viewId(a.id));
    if (!wv || !wv.setAudioMuted) continue;
    const off = !!settings.muted || (!!settings.muteInactive && a.id !== activeId);
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
    if (settings.joinLeaderFight && isLeader) {
      for (const a of accounts) {
        if (a.id !== accountId) sendToView(a.id, { type: 'join-fight', ...msg });
      }
    }
  } else if (msg.type === 'my-turn') {
    if (settings.switchOnTurn && activeId !== accountId) setActive(accountId);
    else if (activeId !== accountId) {
      setAlert(accountId, true);
      if (settings.notifications) beep();
    }
    maybeAttention();
    pulseTab(accountId);
  } else if (msg.type === 'whisper') {
    notify(accountId, 'Message privé de ' + (msg.from || '?'));
  } else if (msg.type === 'party-invite') {
    notify(accountId, 'Invitation de groupe de ' + (msg.from || '?'));
  } else if (msg.type === 'challenge-invite') {
    notify(accountId, 'Défi en combat de ' + (msg.from || '?'));
  } else if (msg.type === 'portrait') {
    if (msg.dataUrl) {
      portraits[accountId] = msg.dataUrl;
      renderTabs();
    }
  } else if (msg.type === 'travel-hook') {
    console.log('[travel] right-click hook installed on world map');
  } else if (msg.type === 'travel-started') {
    console.log('[travel] going to ' + msg.x + ',' + msg.y);
    notify(accountId, 'Voyage vers ' + msg.x + ',' + msg.y);
  } else if (msg.type === 'travel-replan') {
    console.log('[travel] replan from ' + msg.x + ',' + msg.y + ' (' + msg.steps + ' steps)');
  } else if (msg.type === 'travel-plan') {
    console.log('[travel] plan ' + msg.steps + ' steps from ' + msg.x + ',' + msg.y);
  } else if (msg.type === 'travel-progress') {
    // Each hop, so a stalled trip shows where it stopped.
    console.log('[travel] ' + msg.x + ',' + msg.y + ' (hop ' + msg.hop + ')');
  } else if (msg.type === 'travel-done') {
    var where = msg.x != null ? ' à ' + msg.x + ',' + msg.y : '';
    console.log('[travel] done ok=' + msg.ok + ' reason=' + msg.reason + where);
    notify(accountId, msg.ok ? 'Arrivé à destination' : 'Voyage interrompu (' + (msg.reason || '?') + ')' + where);
  } else if (msg.type === 'harvest-progress') {
    console.log('[harvest] ' + msg.gathered + ' récolté(s) — ' + (msg.name || ''));
  } else if (msg.type === 'automation-interrupted') {
    harvesting.delete(accountId);
    renderHarvestButton();
    const what = (msg.stopped || []).join(' + ');
    console.log('[stakk] action manuelle -> ' + what + ' interrompu(e)');
    notify(accountId, what + ' interrompu (action manuelle)');
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
      notify(accountId, 'Récolte arrêtée (' + msg.gathered + ')');
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
  } else if (msg.type === 'entities-debug') {
    window.touch.logDebug('[entities-debug]', msg);
  } else if (msg.type === 'disconnected') {
    notify(accountId, 'Déconnecté du jeu');
  }
}

function accountName(id) {
  const a = accounts.find((x) => x.id === id);
  return a ? a.name : 'Compte';
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
  if (!settings.notifications) return;
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
  const payload = { type: 'own-accounts', ids, names, autoAccept: !!(settings && settings.autoAcceptOwn), autoAcceptGroup: !!(settings && settings.autoAcceptGroup), joinLeaderFight: !!(settings && settings.joinLeaderFight) };
  for (const a of accounts) sendToView(a.id, payload);
}

function toggleStats() {
  const panel = $('stats-panel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) renderStats();
}

const fmt = (n) => (n || 0).toLocaleString('fr-FR');

function renderStats() {
  const box = $('stats-list');
  box.innerHTML = '';
  if (!accounts.length) {
    box.innerHTML = '<div class="panel-empty">Aucun compte.</div>';
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
    xp.textContent = '+' + fmt(s.xp) + ' XP';
    const km = document.createElement('span');
    km.className = 'st-kamas';
    km.textContent = (s.kamas >= 0 ? '+' : '') + fmt(s.kamas) + ' K';
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
  if (!leaderIdentity) { notify(activeId, 'Grouper : ce compte n\'est pas encore en jeu'); return; }
  const others = accounts.filter((a) => a.id !== leader.id && identities[a.id]);
  const notReady = accounts.filter((a) => a.id !== leader.id && !identities[a.id]).length;
  console.log('[group] chef=' + leaderIdentity.name + ' invités=' + others.map((a) => identities[a.id].name).join(',') + ' pas en jeu=' + notReady);
  if (!others.length) { notify(activeId, 'Grouper : aucun autre compte en jeu'); return; }
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

function keybindKey(action) {
  const binds = (settings && settings.keybinds) || {};
  return binds[action.id] || action.defaultKey;
}

// triggerKey -> actionId, pushed to each game preload.
function computeKeyToAction() {
  const map = {};
  for (const a of KEYBIND_ACTIONS) {
    const k = keybindKey(a);
    if (k) map[k] = a.id;
  }
  return map;
}

function pushKeybinds() {
  const map = computeKeyToAction();
  for (const a of accounts) {
    const wv = document.getElementById(viewId(a.id));
    if (wv) wv.send('keybinds', map);
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
    label.textContent = a.label;
    const key = document.createElement('button');
    key.type = 'button';
    key.className = 'kb-key' + (capturingAction === a.id ? ' capturing' : '');
    key.textContent = capturingAction === a.id ? '…' : keyLabel(editingKeybinds[a.id] || a.defaultKey);
    key.onclick = () => startCapture(a.id);
    row.append(label, key);
    box.appendChild(row);
  }
}

function keyLabel(k) {
  if (k === ' ') return 'Espace';
  if (k === 'Escape') return 'Échap';
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
    if (e.key !== 'Escape') editingKeybinds[capturingAction] = e.key;
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
  if (!window.confirm('Supprimer le compte "' + a.name + '" ?')) return;
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

async function openSettings() {
  const s = await window.touch.getSettings();
  $('res-w').value = s.resolution.width;
  $('res-h').value = s.resolution.height;
  $('res-slider').value = s.resolution.width;
  $('res-hint').textContent = '';
  markActivePreset();
  renderPresets();
  markActivePreset();
  $('res-w').oninput = () => setResolution(Number($('res-w').value), 0, 'width');
  $('res-h').oninput = () => setResolution(0, Number($('res-h').value), 'height');
  $('res-slider').oninput = () => setResolution(Number($('res-slider').value), 0, 'slider');
  $('res-h').oninput = markActivePreset;
  $('tabbar-side').checked = !!s.tabBarSide;
  $('muted').checked = s.muted;
  $('mute-inactive').checked = !!s.muteInactive;
  $('switch-on-turn').checked = s.switchOnTurn;
  $('notifications').checked = s.notifications;
  $('no-confirm').checked = s.noConfirm;
  $('auto-accept-group').checked = s.autoAcceptGroup;
  $('join-leader-fight').checked = !!s.joinLeaderFight;
  $('hide-shop').checked = s.hideShop;
  $('show-resources').checked = s.showResources;
  $('auto-accept-own').checked = s.autoAcceptOwn;
  editingKeybinds = { ...(s.keybinds || {}) };
  capturingAction = null;
  renderKeybinds();
  $('settings-modal').hidden = false;
}

async function saveSettings() {
  const muted = $('muted').checked;
  settings = await window.touch.setSettings({
    resolution: { width: Number($('res-w').value), height: Number($('res-h').value) },
    tabBarSide: $('tabbar-side').checked,
    muted,
    muteInactive: $('mute-inactive').checked,
    switchOnTurn: $('switch-on-turn').checked,
    notifications: $('notifications').checked,
    noConfirm: $('no-confirm').checked,
    showResources: $('show-resources').checked,
    autoAcceptOwn: $('auto-accept-own').checked,
    autoAcceptGroup: $('auto-accept-group').checked,
    joinLeaderFight: $('join-leader-fight').checked,
    hideShop: $('hide-shop').checked,
    keybinds: editingKeybinds,
  });
  for (const a of accounts) {
    const wv = document.getElementById(viewId(a.id));
    // handled below by applyMute()
  }
  applyMute();
  applyTabBarSide(settings.tabBarSide);
  pushKeybinds();
  pushOwnAccounts();
  broadcastToAll({ type: 'no-confirm', on: !!settings.noConfirm });
  broadcastToAll({ type: 'resource-overlay', on: !!settings.showResources });
  broadcastToAll({ type: 'hide-shop', on: !!settings.hideShop });
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
