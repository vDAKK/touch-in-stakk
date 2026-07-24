const $ = (id) => document.getElementById(id);

let gameUrl = null;
let gamePreloadUrl = null;
let settings = null;
let accounts = [];
let activeId = null;
const identities = {}; // accountId -> { name, id } reported by each game hook

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
  { id: 'options', label: 'Options', defaultKey: 'o' },
  { id: 'mount', label: 'Monture', defaultKey: 'p' },
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

$('add-tab').onclick = addAccount;
$('add-first').onclick = addAccount;
$('group-auto').onclick = groupAuto;
$('follow-toggle').onclick = toggleFollow;
$('broadcast-toggle').onclick = toggleBroadcast;
$('monsters-btn').onclick = toggleMonsters;
$('monsters-close').onclick = () => ($('monsters-panel').hidden = true);

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
  }
});

function handleHotkey(hk) {
  if (!hk) return;
  if (hk.name === 'ready-all') broadcastToAll({ type: 'ready', value: true });
  else if (hk.name === 'switch') { if (accounts[hk.index]) setActive(accounts[hk.index].id); }
  else if (hk.name === 'cycle') cycleTab(hk.dir);
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
$('close-settings').onclick = () => ($('settings-modal').hidden = true);
$('save-settings').onclick = saveSettings;
$('retry').onclick = retryPatch;

const viewId = (id) => 'view-' + id;
const tabId = (id) => 'tab-' + id;

// A stable colour per account so tabs are distinguishable at a glance.
const TAB_COLORS = ['#2fd08a', '#e6b450', '#5b8def', '#e5737b', '#b98cf0', '#40c4d6', '#e08a4a', '#7fce5a'];
const accountColor = (id) => TAB_COLORS[(id - 1) % TAB_COLORS.length];

async function init() {
  await refreshPatchStatus();
  settings = await window.touch.getSettings();
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
  wv.setAttribute('src', gameUrl);
  wv.classList.add('inactive');
  wv.addEventListener('dom-ready', () => {
    if (wv.setAudioMuted) wv.setAudioMuted(settings.muted);
    wv.send('keybinds', computeKeyToAction());
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

    const dot = document.createElement('span');
    dot.className = 'tab-dot';
    dot.style.background = accountColor(a.id);

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

    tab.append(dot, label, close);
    box.appendChild(tab);
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
  if (broadcasting) updateBroadcastSource();
  renderTabs();
}

function handleQol(accountId, msg) {
  if (!msg) return;
  if (msg.type === 'identity') {
    identities[accountId] = { name: msg.name, id: msg.id };
    autoNameTab(accountId, msg.name);
  } else if (msg.type === 'my-turn') {
    if (settings.switchOnTurn && activeId !== accountId) setActive(accountId);
    else if (activeId !== accountId) {
      setAlert(accountId, true);
      if (settings.notifications) beep();
    }
    pulseTab(accountId);
  } else if (msg.type === 'monsters') {
    renderMonsters(msg.groups || []);
  } else if (msg.type === 'whisper') {
    notify(accountId, 'Message privé de ' + (msg.from || '?'));
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
function notify(accountId, text) {
  if (activeId !== accountId) setAlert(accountId, true);
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

// Ask the active account for the monster groups on its current map.
function toggleMonsters() {
  const panel = $('monsters-panel');
  if (!panel.hidden) {
    panel.hidden = true;
    return;
  }
  $('monsters-list').innerHTML = '<div class="mg-empty">Lecture de la carte…</div>';
  panel.hidden = false;
  if (activeId) sendToView(activeId, { type: 'monsters' });
}

function renderMonsters(groups) {
  const box = $('monsters-list');
  box.innerHTML = '';
  if (!groups.length) {
    box.innerHTML = '<div class="mg-empty">Aucun groupe sur cette carte.</div>';
    return;
  }
  for (const g of groups) {
    const row = document.createElement('div');
    row.className = 'mg';
    const top = document.createElement('div');
    top.className = 'mg-top';
    const lvl = document.createElement('span');
    lvl.className = 'mg-lvl';
    lvl.textContent = 'Niv. ' + g.level;
    const count = document.createElement('span');
    count.className = 'mg-count';
    count.textContent = g.count + (g.count > 1 ? ' monstres' : ' monstre');
    top.append(lvl, count);
    const names = document.createElement('div');
    names.className = 'mg-names';
    names.textContent = (g.names || []).join(', ');
    row.append(top, names);
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
  if (!leaderIdentity) return;
  const others = accounts.filter((a) => a.id !== leader.id && identities[a.id]);
  if (!others.length) return;
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

let following = false;
function toggleFollow() {
  const leader = accounts.find((a) => a.id === activeId);
  if (!leader || !identities[leader.id]) return;
  following = !following;
  const leaderId = identities[leader.id].id;
  for (const a of accounts) {
    if (a.id === leader.id || !identities[a.id]) continue;
    sendToView(a.id, { type: 'follow', leaderId, enabled: following });
  }
  $('follow-toggle').classList.toggle('on', following);
}

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
  $('muted').checked = s.muted;
  $('switch-on-turn').checked = s.switchOnTurn;
  $('notifications').checked = s.notifications;
  editingKeybinds = { ...(s.keybinds || {}) };
  capturingAction = null;
  renderKeybinds();
  $('settings-modal').hidden = false;
}

async function saveSettings() {
  const muted = $('muted').checked;
  settings = await window.touch.setSettings({
    resolution: { width: Number($('res-w').value), height: Number($('res-h').value) },
    muted,
    switchOnTurn: $('switch-on-turn').checked,
    notifications: $('notifications').checked,
    keybinds: editingKeybinds,
  });
  for (const a of accounts) {
    const wv = document.getElementById(viewId(a.id));
    if (wv && wv.setAudioMuted) wv.setAudioMuted(muted);
  }
  pushKeybinds();
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
