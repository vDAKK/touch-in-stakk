# Multi-account Tabs + Persistent Sessions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Multi-comptes Dofus Touch en onglets, chaque compte sur une partition Electron persistante (session isolée + reconnexion auto au relancement).

**Architecture:** Un `<webview>` par compte, `partition="persist:acct-<id>"`. Le spoofing/blocage/logs sont installés par-session (chaque partition) au lieu de seulement `defaultSession`. Un module `accounts.js` persiste la liste des comptes dans `accounts.json`. Le renderer gère une barre d'onglets, la création/suppression/renommage des webviews, et un panneau réglages en overlay.

**Tech Stack:** Electron, Node.js, `node --test`.

## Global Constraints

- Deps runtime : `express`, `cors`, `axios` uniquement. Dev : `electron`.
- Partition d'un compte : exactement `persist:acct-<id>` (id numérique).
- `accounts.json` (dans `app.getPath('userData')`) : `{ nextId: number, accounts: [{ id: number, name: string }] }`. Défaut `{ nextId: 1, accounts: [] }`.
- Nom de compte par défaut : `Compte <id>`.
- `window.prompt` est indisponible dans Electron — ne jamais l'utiliser (renommage via `<input>` inline). `window.confirm` est disponible.
- Réglages (résolution/son) restent globaux. Aucune feature QoL dans ce sous-projet.
- Ne pas régresser : le login mono-compte actuel doit continuer de marcher (un compte = comportement identique).

---

### Task 1: Module comptes (`accounts.js`)

**Files:**
- Create: `src/main/accounts.js`
- Test: `test/accounts.test.js`

**Interfaces:**
- Produces:
  - `loadAccounts(userDataDir) -> { nextId, accounts }`
  - `addAccount(userDataDir, name?) -> { id, name }`
  - `renameAccount(userDataDir, id, name) -> account | null`
  - `removeAccount(userDataDir, id) -> boolean`
  - `partitionFor(id) -> string`

- [ ] **Step 1: Écrire `test/accounts.test.js`**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { loadAccounts, addAccount, renameAccount, removeAccount, partitionFor } = require('../src/main/accounts');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tis-acc-'));
}

test('defaults to empty with nextId 1 when no file', () => {
  assert.deepStrictEqual(loadAccounts(tmp()), { nextId: 1, accounts: [] });
});

test('addAccount assigns nextId, defaults the name, and increments', () => {
  const dir = tmp();
  const a = addAccount(dir);
  const b = addAccount(dir, 'Perso B');
  assert.deepStrictEqual(a, { id: 1, name: 'Compte 1' });
  assert.deepStrictEqual(b, { id: 2, name: 'Perso B' });
  assert.strictEqual(loadAccounts(dir).nextId, 3);
  assert.strictEqual(loadAccounts(dir).accounts.length, 2);
});

test('renameAccount updates an existing account, null otherwise', () => {
  const dir = tmp();
  const a = addAccount(dir);
  assert.strictEqual(renameAccount(dir, a.id, 'X').name, 'X');
  assert.strictEqual(loadAccounts(dir).accounts[0].name, 'X');
  assert.strictEqual(renameAccount(dir, 999, 'Y'), null);
});

test('removeAccount removes by id and reports success', () => {
  const dir = tmp();
  const a = addAccount(dir);
  assert.strictEqual(removeAccount(dir, a.id), true);
  assert.strictEqual(loadAccounts(dir).accounts.length, 0);
  assert.strictEqual(removeAccount(dir, a.id), false);
});

test('partitionFor builds the persist partition string', () => {
  assert.strictEqual(partitionFor(7), 'persist:acct-7');
});
```

- [ ] **Step 2: Lancer le test, vérifier l'échec** — Run: `npm test` → FAIL (module introuvable).

- [ ] **Step 3: Écrire `src/main/accounts.js`**

```js
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT = { nextId: 1, accounts: [] };

function accountsPath(userDataDir) {
  return path.join(userDataDir, 'accounts.json');
}

function loadAccounts(userDataDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(accountsPath(userDataDir), 'utf-8'));
    return {
      nextId: typeof parsed.nextId === 'number' ? parsed.nextId : 1,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
    };
  } catch {
    return { nextId: 1, accounts: [] };
  }
}

function saveAccounts(userDataDir, state) {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(accountsPath(userDataDir), JSON.stringify(state, null, 2), 'utf-8');
  return state;
}

function addAccount(userDataDir, name) {
  const state = loadAccounts(userDataDir);
  const account = { id: state.nextId, name: name || 'Compte ' + state.nextId };
  state.accounts.push(account);
  state.nextId += 1;
  saveAccounts(userDataDir, state);
  return account;
}

function renameAccount(userDataDir, id, name) {
  const state = loadAccounts(userDataDir);
  const account = state.accounts.find((a) => a.id === id);
  if (!account) return null;
  account.name = name;
  saveAccounts(userDataDir, state);
  return account;
}

function removeAccount(userDataDir, id) {
  const state = loadAccounts(userDataDir);
  const before = state.accounts.length;
  state.accounts = state.accounts.filter((a) => a.id !== id);
  if (state.accounts.length === before) return false;
  saveAccounts(userDataDir, state);
  return true;
}

function partitionFor(id) {
  return 'persist:acct-' + id;
}

module.exports = { loadAccounts, saveAccounts, addAccount, renameAccount, removeAccount, partitionFor, accountsPath, DEFAULT };
```

- [ ] **Step 4: Lancer le test** — Run: `npm test` → tous PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/accounts.js test/accounts.test.js
git commit -m "feat: persisted multi-account model"
```
End commit body with:
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

### Task 2: Préparation de session par partition (`session-prep.js`)

Extrait le spoofing/blocage/logs vers un module testable (sans import electron) applicable à n'importe quelle session, et le câble dans `index.js` pour couvrir chaque partition.

**Files:**
- Create: `src/main/session-prep.js`
- Test: `test/session-prep.test.js`
- Modify: `src/main/index.js`

**Interfaces:**
- Consumes: `installSpoofing` de `spoof.js`.
- Produces:
  - `prepareSession(sess, log?) -> boolean` (idempotent par session ; installe spoofing + blocage + logs)
  - `blockThirdParty(sess)`, `installRequestLogging(sess, log)`, `THIRD_PARTY_BLOCK`

- [ ] **Step 1: Écrire `test/session-prep.test.js`**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { prepareSession } = require('../src/main/session-prep');

function mockSession() {
  const calls = { send: 0, before: 0, error: 0 };
  return {
    calls,
    webRequest: {
      onBeforeSendHeaders: () => { calls.send += 1; },
      onBeforeRequest: () => { calls.before += 1; },
      onErrorOccurred: () => { calls.error += 1; },
    },
  };
}

test('prepareSession installs all three handlers once', () => {
  const s = mockSession();
  assert.strictEqual(prepareSession(s, () => {}), true);
  assert.deepStrictEqual(s.calls, { send: 1, before: 1, error: 1 });
});

test('prepareSession is idempotent per session', () => {
  const s = mockSession();
  prepareSession(s, () => {});
  assert.strictEqual(prepareSession(s, () => {}), false);
  assert.deepStrictEqual(s.calls, { send: 1, before: 1, error: 1 });
});
```

- [ ] **Step 2: Lancer le test** — Run: `npm test` → FAIL (module introuvable).

- [ ] **Step 3: Écrire `src/main/session-prep.js`**

```js
const { installSpoofing } = require('./spoof');

const THIRD_PARTY_BLOCK = ['*://lindo-app.com/*', '*://*.lindo-app.com/*'];

function blockThirdParty(sess) {
  sess.webRequest.onBeforeRequest({ urls: THIRD_PARTY_BLOCK }, (_details, callback) =>
    callback({ cancel: true })
  );
}

function installRequestLogging(sess, log) {
  sess.webRequest.onErrorOccurred((details) => {
    if (details.error && details.error !== 'net::ERR_ABORTED') {
      log('req-error ' + details.error + ' ' + details.url);
    }
  });
}

const prepared = new WeakSet();

function prepareSession(sess, log) {
  if (prepared.has(sess)) return false;
  prepared.add(sess);
  installSpoofing(sess);
  blockThirdParty(sess);
  installRequestLogging(sess, log || (() => {}));
  return true;
}

module.exports = { prepareSession, blockThirdParty, installRequestLogging, THIRD_PARTY_BLOCK };
```

- [ ] **Step 4: Lancer le test** — Run: `npm test` → PASS.

- [ ] **Step 5: Câbler dans `src/main/index.js`**

Remplacer l'ancien câblage sessions. Retirer les fonctions `blockThirdParty` et `installDiagnostics` définies dans `index.js` (déplacées vers `session-prep.js`) et ajouter l'import :

```js
const { prepareSession } = require('./session-prep');
```

Dans `boot()`, remplacer les lignes :
```js
  installSpoofing(session.defaultSession);
  blockThirdParty();
  installGameWebviewHandlers();
  installDiagnostics();
```
par :
```js
  app.on('session-created', (sess) => prepareSession(sess, logToFile));
  prepareSession(session.defaultSession, logToFile);
  installGameWebviewHandlers();
```

Retirer l'import désormais inutilisé `installSpoofing` de la ligne `const { installSpoofing } = require('./spoof');` (il n'est plus référencé dans `index.js`). Ajouter le handler IPC de préparation de session (une session par partition, préparée avant le chargement du webview) juste à côté des autres `ipcMain.handle` :

```js
ipcMain.handle('session:prepare', (_e, partition) => {
  prepareSession(session.fromPartition(partition), logToFile);
  return true;
});
```

- [ ] **Step 6: Vérifier syntaxe + suite**

Run: `node --check src/main/index.js && node --check src/main/session-prep.js && npm test`
Expected: syntax OK, tous les tests PASS (aucune régression).

- [ ] **Step 7: Commit**

```bash
git add src/main/session-prep.js test/session-prep.test.js src/main/index.js
git commit -m "refactor: per-session spoofing/blocking so every account partition is covered"
```
End commit body with:
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

### Task 3: IPC comptes + API preload

**Files:**
- Modify: `src/main/index.js`
- Modify: `src/preload/index.js`

**Interfaces:**
- Consumes: `accounts.js` (Task 1), `session:prepare` (Task 2).
- Produces (sur `window.touch`) : `accountsList`, `accountsAdd`, `accountsRename`, `accountsRemove`, `prepareSession`.

- [ ] **Step 1: Handlers IPC dans `src/main/index.js`**

Ajouter l'import en tête (près des autres require) :
```js
const { loadAccounts, addAccount, renameAccount, removeAccount } = require('./accounts');
```
Ajouter, à côté des autres `ipcMain.handle` :
```js
ipcMain.handle('accounts:list', () => loadAccounts(userDataDir()));
ipcMain.handle('accounts:add', (_e, name) => addAccount(userDataDir(), name));
ipcMain.handle('accounts:rename', (_e, id, name) => renameAccount(userDataDir(), id, name));
ipcMain.handle('accounts:remove', (_e, id) => removeAccount(userDataDir(), id));
```

- [ ] **Step 2: API dans `src/preload/index.js`**

Ajouter dans l'objet exposé (après `retryPatch`) :
```js
  accountsList: () => ipcRenderer.invoke('accounts:list'),
  accountsAdd: (name) => ipcRenderer.invoke('accounts:add', name),
  accountsRename: (id, name) => ipcRenderer.invoke('accounts:rename', id, name),
  accountsRemove: (id) => ipcRenderer.invoke('accounts:remove', id),
  prepareSession: (partition) => ipcRenderer.invoke('session:prepare', partition),
```

- [ ] **Step 3: Vérifier syntaxe + suite**

Run: `node --check src/main/index.js && node --check src/preload/index.js && npm test`
Expected: syntax OK, tests inchangés PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.js src/preload/index.js
git commit -m "feat: accounts IPC + preload bridge"
```
End commit body with:
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

### Task 4: UI multi-onglets (renderer)

Réécrit le renderer : barre d'onglets, un webview par compte (partition persistante), switch, ajout/renommage/suppression, panneau réglages en overlay. Pas de test auto (runtime Electron/DOM) — vérifié au smoke Task 5.

**Files:**
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/style.css`
- Modify: `src/renderer/renderer.js`

**Interfaces:**
- Consumes : `window.touch` (getSettings/setSettings, getGameUrl, getPatchStatus/retryPatch, window*, accountsList/Add/Rename/Remove, prepareSession).

- [ ] **Step 1: Réécrire `src/renderer/index.html`**

```html
<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src http://127.0.0.1:* https://*.ankama.com https://*.ankama-games.com" />
    <link rel="stylesheet" href="style.css" />
    <title>Touch in STAKK</title>
  </head>
  <body>
    <header class="titlebar">
      <span class="title">Touch in STAKK</span>
      <div class="win-controls">
        <button id="min" title="Réduire">—</button>
        <button id="max" title="Agrandir">▢</button>
        <button id="close" title="Fermer">✕</button>
      </div>
    </header>

    <div id="patch-warn" hidden>
      <span>Patchs de compatibilité indisponibles — le jeu risque de ne pas démarrer.</span>
      <button id="retry">Réessayer</button>
    </div>

    <nav id="tabbar">
      <div id="tabs"></div>
      <button id="add-tab" title="Ajouter un compte">+</button>
      <button id="open-settings" title="Réglages">⚙</button>
    </nav>

    <main id="views"></main>

    <div id="empty" hidden>
      <p>Aucun compte pour l'instant.</p>
      <button id="add-first">Ajouter un compte</button>
    </div>

    <div id="settings-modal" hidden>
      <div class="modal-card">
        <h2>Réglages</h2>
        <label>Largeur <input id="res-w" type="number" min="960" /></label>
        <label>Hauteur <input id="res-h" type="number" min="600" /></label>
        <label><input id="muted" type="checkbox" /> Couper le son</label>
        <div class="modal-actions">
          <button id="save-settings">Enregistrer</button>
          <button id="close-settings">Fermer</button>
        </div>
      </div>
    </div>

    <script src="renderer.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Réécrire `src/renderer/style.css`**

```css
:root { color-scheme: dark; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; height: 100vh; display: flex; flex-direction: column; background: #14161c; color: #e6e8ef; font-family: system-ui, sans-serif; }
.titlebar { height: 40px; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; background: #0e1015; -webkit-app-region: drag; }
.win-controls button { -webkit-app-region: no-drag; background: transparent; color: #e6e8ef; border: 0; width: 36px; height: 40px; cursor: pointer; }
.win-controls button:hover { background: #23262f; }
#close:hover { background: #b02525; }

#patch-warn { display: flex; align-items: center; gap: 10px; padding: 8px 14px; background: #3a2a12; border-bottom: 1px solid #7a5a1a; color: #f0d9a8; font-size: 13px; }
#patch-warn button { background: #7a5a1a; color: #fff; border: 0; border-radius: 6px; padding: 5px 10px; cursor: pointer; }

#tabbar { display: flex; align-items: stretch; gap: 4px; padding: 4px 6px; background: #0e1015; -webkit-app-region: drag; }
#tabs { display: flex; gap: 4px; }
.tab { -webkit-app-region: no-drag; display: flex; align-items: center; gap: 6px; padding: 0 6px 0 12px; height: 34px; background: #1b1e27; border-radius: 6px 6px 0 0; cursor: pointer; max-width: 200px; }
.tab.active { background: #2a2f3d; }
.tab-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tab-input { width: 120px; background: #0e1015; color: #e6e8ef; border: 1px solid #3a6df0; border-radius: 4px; }
.tab-close { background: transparent; color: #9aa0ad; border: 0; cursor: pointer; font-size: 12px; }
.tab-close:hover { color: #fff; }
#add-tab, #open-settings { -webkit-app-region: no-drag; background: #1b1e27; color: #e6e8ef; border: 0; border-radius: 6px; width: 34px; height: 34px; cursor: pointer; }
#add-tab:hover, #open-settings:hover { background: #2a2f3d; }
#open-settings { margin-left: auto; }

#views { flex: 1; position: relative; }
.game { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }

#empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; }
#empty button, .modal-actions button { padding: 10px 24px; border: 0; border-radius: 8px; background: #3a6df0; color: #fff; cursor: pointer; }

#settings-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; }
.modal-card { background: #1b1e27; padding: 24px; border-radius: 10px; display: grid; gap: 12px; min-width: 280px; }
.modal-card h2 { margin: 0 0 4px; font-size: 18px; }
.modal-card input[type="number"] { width: 90px; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
#close-settings { background: #2a2f3d; }
```

- [ ] **Step 3: Réécrire `src/renderer/renderer.js`**

```js
const $ = (id) => document.getElementById(id);

let gameUrl = null;
let accounts = [];
let activeId = null;

$('min').onclick = () => window.touch.windowMinimize();
$('max').onclick = () => window.touch.windowToggleMaximize();
$('close').onclick = () => window.touch.windowClose();

$('add-tab').onclick = addAccount;
$('add-first').onclick = addAccount;
$('open-settings').onclick = openSettings;
$('close-settings').onclick = () => ($('settings-modal').hidden = true);
$('save-settings').onclick = saveSettings;
$('retry').onclick = retryPatch;

const viewId = (id) => 'view-' + id;
const tabId = (id) => 'tab-' + id;

async function init() {
  await refreshPatchStatus();
  gameUrl = await window.touch.getGameUrl();
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
  wv.setAttribute('src', gameUrl);
  wv.hidden = true;
  wv.addEventListener('dom-ready', async () => {
    const s = await window.touch.getSettings();
    if (wv.setAudioMuted) wv.setAudioMuted(s.muted);
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

    tab.append(label, close);
    box.appendChild(tab);
  }
}

function setActive(id) {
  activeId = id;
  showEmpty(false);
  for (const a of accounts) {
    const wv = document.getElementById(viewId(a.id));
    if (wv) wv.hidden = a.id !== id;
  }
  renderTabs();
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
  $('settings-modal').hidden = false;
}

async function saveSettings() {
  const muted = $('muted').checked;
  await window.touch.setSettings({
    resolution: { width: Number($('res-w').value), height: Number($('res-h').value) },
    muted,
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
```

- [ ] **Step 4: Vérifier syntaxe renderer + suite**

Run: `node --check src/renderer/renderer.js && npm test`
Expected: syntax OK, tests PASS (le renderer n'est pas importé par les tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer
git commit -m "feat: multi-account tab UI with persistent per-account webviews"
```
End commit body with:
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

### Task 5: Vérification live (manuelle)

Valide le multi-comptes réel : isolation, persistance, switch, renommage, suppression.

- [ ] **Step 1: Lancer** — `npm start`. État vide au premier lancement (aucun compte) → bouton "Ajouter un compte".

- [ ] **Step 2: Deux comptes** — Ajouter compte 1 → se connecter (login Ankama). Ajouter compte 2 → se connecter avec un **autre** compte. Vérifier que les deux restent connectés indépendamment (switch d'onglet ne déconnecte pas).

- [ ] **Step 3: Persistance** — Fermer l'app, relancer. Les deux onglets réapparaissent et les comptes sont **déjà connectés** (ou reconnexion auto) sans re-login.

- [ ] **Step 4: Renommer / supprimer** — Double-clic sur un onglet → renommer → Entrée. Fermer un onglet via ✕ → confirmation → l'onglet et son webview disparaissent ; l'app bascule sur un autre onglet (ou état vide).

- [ ] **Step 5: Réglages** — ⚙ → changer résolution/son → Enregistrer → vérifier l'effet (son coupé sur les webviews). Relancer → réglages conservés.

- [ ] **Step 6: Diagnostic si besoin** — En cas de session non spoofée (requêtes rejetées sur un onglet), vérifier dans `userData/logs/app.log` que `session:prepare` couvre bien la partition ; sinon confirmer l'ordre `prepareSession` avant `src`. Corriger, re-tester, commit.

---

## Notes de vérification (self-review)

- **Couverture spec** : partitions persistantes (Task 4 webviews + Task 2 session:prepare), modèle comptes persistant (Task 1), spoofing par-session (Task 2), IPC comptes (Task 3), UI onglets add/rename/remove/switch + réglages overlay (Task 4), état vide (Task 4), persistance & smoke (Task 5). QoL hors scope (respecté).
- **Cohérence types** : `accounts:list` renvoie `{ nextId, accounts }` ; le renderer lit `res.accounts`. Partition `persist:acct-<id>` identique entre `partitionFor` (Task 1), `session:prepare` (Task 2/3) et le webview (Task 4). `prepareSession(sess, log)` signature stable entre Task 2 et son appel dans `index.js`.
- **Contraintes** : pas de `window.prompt` (renommage via input). Deps inchangées. Réglages globaux. Non-régression mono-compte : un seul compte = un seul webview, comportement identique à l'actuel.
- **Piège timing** : `session:prepare` est `await`é avant de poser `src` sur le webview → spoofing garanti installé avant la première requête de la partition ; `app.on('session-created')` sert de filet.
