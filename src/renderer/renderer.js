const $ = (id) => document.getElementById(id);

let gameUrl = null;
let gamePreloadUrl = null;
let settings = null;
let accounts = [];
let activeId = null;
const identities = {}; // accountId -> { name, id } reported by each game hook

$('min').onclick = () => window.touch.windowMinimize();
$('max').onclick = () => window.touch.windowToggleMaximize();
$('close').onclick = () => window.touch.windowClose();

$('add-tab').onclick = addAccount;
$('add-first').onclick = addAccount;
$('group-auto').onclick = groupAuto;
$('follow-toggle').onclick = toggleFollow;

// Grouped action: F2 readies every account currently in a fight.
window.addEventListener('keydown', (e) => {
  if (e.key === 'F2') {
    e.preventDefault();
    broadcastToAll({ type: 'ready', value: true });
  }
});
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
  });
  wv.addEventListener('ipc-message', (e) => {
    if (e.channel !== 'qol') return;
    handleQol(account.id, e.args[0]);
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
    tab.className = 'tab' + (a.id === activeId ? ' active' : '');
    tab.id = tabId(a.id);

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
  showEmpty(false);
  for (const a of accounts) {
    const wv = document.getElementById(viewId(a.id));
    if (wv) wv.classList.toggle('inactive', a.id !== id);
  }
  renderTabs();
}

function handleQol(accountId, msg) {
  if (!msg) return;
  if (msg.type === 'identity') {
    identities[accountId] = { name: msg.name, id: msg.id };
  } else if (msg.type === 'my-turn') {
    if (settings.switchOnTurn && activeId !== accountId) setActive(accountId);
    pulseTab(accountId);
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
  $('settings-modal').hidden = false;
}

async function saveSettings() {
  const muted = $('muted').checked;
  settings = await window.touch.setSettings({
    resolution: { width: Number($('res-w').value), height: Number($('res-h').value) },
    muted,
    switchOnTurn: $('switch-on-turn').checked,
  });
  for (const a of accounts) {
    const wv = document.getElementById(viewId(a.id));
    if (wv && wv.setAudioMuted) wv.setAudioMuted(muted);
  }
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
