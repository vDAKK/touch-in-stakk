# Touch in STAKK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un launcher desktop Electron minimal qui lance et connecte un compte Dofus Touch dans une fenêtre PC, en se présentant aux serveurs Ankama comme le client Android officiel.

**Architecture:** Un serveur Express local proxifie les fichiers du client Dofus Touch depuis le CDN Ankama et applique à la volée les patchs de compatibilité communautaires (regex.json de `zenoxs/lindo-game-base`). La session Electron réécrit les en-têtes HTTP (User-Agent Android rotatif, suppression des en-têtes qui trahissent un desktop). Une fenêtre frameless charge le client patché servi en local.

**Tech Stack:** Node.js, Electron, Express, cors, axios. Tests via le runner intégré `node --test` (aucune dépendance de test tierce).

## Global Constraints

- Node.js ≥ 18 (pour `fetch` global dans les tests), Electron ≥ 31.
- Dépendances runtime autorisées : `express`, `cors`, `axios` uniquement. Dev : `electron`. Aucune autre.
- `package.json` : `name` = `touch-in-stakk`, `productName` = `Touch in STAKK`, `main` = `src/main/index.js`.
- Constantes réelles (à copier verbatim) :
  - Manifest patchs : `https://raw.githubusercontent.com/zenoxs/lindo-game-base/popup/manifest.json`
  - Origine jeu : `https://dt-proxy-production-login.ankama-games.com/`
  - User-Agents Android rotatifs + suffixe ` DofusTouch Client`
  - En-têtes strippés : `sec-ch-ua`, `sec-ch-ua-mobile`, `sec-ch-ua-platform`, `Sec-Fetch-Dest`, `Sec-Fetch-Mode`, `Sec-Fetch-Site` ; `Referer` uniquement sur `static.ankama.com`.
- Aucune automation/bot/triche. Login via les identifiants Ankama de l'utilisateur uniquement, saisis dans la page d'auth officielle Ankama ; jamais stockés par l'app.
- Le fichier de référence `Retouch-1.1.3-Setup.exe` reste dans le dossier, ignoré par le projet (`.gitignore`).

---

### Task 1: Scaffold projet

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `test/smoke.test.js`

**Interfaces:**
- Consumes: rien.
- Produces: structure npm, `npm test` fonctionnel.

- [ ] **Step 1: Écrire `package.json`**

```json
{
  "name": "touch-in-stakk",
  "productName": "Touch in STAKK",
  "version": "0.1.0",
  "private": true,
  "description": "Launcher desktop pour Dofus Touch",
  "license": "MIT",
  "main": "src/main/index.js",
  "scripts": {
    "start": "electron .",
    "test": "node --test"
  },
  "dependencies": {
    "axios": "^1.7.0",
    "cors": "^2.8.5",
    "express": "^4.21.0"
  },
  "devDependencies": {
    "electron": "^31.0.0"
  }
}
```

- [ ] **Step 2: Écrire `.gitignore`**

```
node_modules/
*.exe
dist/
```

- [ ] **Step 3: Écrire un test smoke `test/smoke.test.js`**

```js
const { test } = require('node:test');
const assert = require('node:assert');

test('runner works', () => {
  assert.strictEqual(1 + 1, 2);
});
```

- [ ] **Step 4: Installer les deps et lancer les tests**

Run: `npm install && npm test`
Expected: install OK, 1 test PASS.

- [ ] **Step 5: Commit**

```bash
git init && git add -A && git commit -m "chore: scaffold touch-in-stakk project"
```

---

### Task 2: Spoofing des en-têtes (`spoof.js`)

**Files:**
- Create: `src/main/spoof.js`
- Test: `test/spoof.test.js`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `spoofHeaders(headers: object, url: string, seed: number) -> object` (copie avec en-têtes strippés + `User-Agent` Android)
  - `pickUserAgent(seed: number) -> string`
  - `installSpoofing(session)` — pose `onBeforeSendHeaders` sur une session Electron.
  - `ANDROID_USER_AGENTS: string[]`, `UA_SUFFIX: string`

- [ ] **Step 1: Écrire le test `test/spoof.test.js`**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { spoofHeaders, pickUserAgent, UA_SUFFIX, ANDROID_USER_AGENTS } = require('../src/main/spoof');

test('strips client-hint and fetch-metadata headers (case-insensitive)', () => {
  const input = { 'sec-ch-ua': 'x', 'Sec-Fetch-Dest': 'y', 'Accept': 'z' };
  const out = spoofHeaders(input, 'https://static.ankama.com/a.js', 0);
  assert.strictEqual(out['sec-ch-ua'], undefined);
  assert.strictEqual(out['Sec-Fetch-Dest'], undefined);
  assert.strictEqual(out['Accept'], 'z');
});

test('sets an Android User-Agent with client suffix', () => {
  const out = spoofHeaders({}, 'https://auth.ankama.com/', 0);
  assert.ok(out['User-Agent'].includes('Android'));
  assert.ok(out['User-Agent'].endsWith(UA_SUFFIX));
});

test('strips Referer only on configured hosts', () => {
  const kept = spoofHeaders({ Referer: 'r' }, 'https://auth.ankama.com/x', 0);
  assert.strictEqual(kept['Referer'], 'r');
  const stripped = spoofHeaders({ Referer: 'r' }, 'https://static.ankama.com/x', 0);
  assert.strictEqual(stripped['Referer'], undefined);
});

test('pickUserAgent stays within the list', () => {
  for (let i = 0; i < 20; i++) {
    const ua = pickUserAgent(i);
    assert.ok(ANDROID_USER_AGENTS.some((base) => ua.startsWith(base)));
  }
});
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/main/spoof'`.

- [ ] **Step 3: Écrire `src/main/spoof.js`**

```js
const ANDROID_USER_AGENTS = [
  'Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 11; SM-A125U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.85 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 10; Redmi Note 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.90 Mobile Safari/537.36',
];
const UA_SUFFIX = ' DofusTouch Client';

const STRIPPED_HEADERS = [
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
];
const REFERER_STRIPPED_HOSTS = ['static.ankama.com'];

function pickUserAgent(seed) {
  const i = Math.abs(seed | 0) % ANDROID_USER_AGENTS.length;
  return ANDROID_USER_AGENTS[i] + UA_SUFFIX;
}

function deleteHeaderCI(obj, name) {
  const lower = name.toLowerCase();
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase() === lower) delete obj[key];
  }
}

function spoofHeaders(headers, url, seed = 0) {
  const out = { ...headers };
  for (const h of STRIPPED_HEADERS) deleteHeaderCI(out, h);
  if (REFERER_STRIPPED_HOSTS.some((host) => url.includes(host))) {
    deleteHeaderCI(out, 'referer');
  }
  out['User-Agent'] = pickUserAgent(seed);
  return out;
}

function installSpoofing(session) {
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = spoofHeaders(details.requestHeaders, details.url, details.id || 0);
    callback({ requestHeaders });
  });
}

module.exports = { spoofHeaders, pickUserAgent, installSpoofing, ANDROID_USER_AGENTS, UA_SUFFIX };
```

- [ ] **Step 4: Lancer le test, vérifier le succès**

Run: `npm test`
Expected: PASS (tous les tests spoof).

- [ ] **Step 5: Commit**

```bash
git add src/main/spoof.js test/spoof.test.js && git commit -m "feat: header spoofing (Android UA + fingerprint strip)"
```

---

### Task 3: Réglages persistés (`settings.js`)

**Files:**
- Create: `src/main/settings.js`
- Test: `test/settings.test.js`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `DEFAULT_SETTINGS = { resolution: { width: 1440, height: 800 }, muted: false }`
  - `loadSettings(userDataDir: string) -> settings`
  - `saveSettings(userDataDir: string, partial: object) -> settings` (fusionne avec les défauts, écrit le JSON, retourne le fusionné)

- [ ] **Step 1: Écrire le test `test/settings.test.js`**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { loadSettings, saveSettings, DEFAULT_SETTINGS } = require('../src/main/settings');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tis-'));
}

test('loads defaults when no file exists', () => {
  assert.deepStrictEqual(loadSettings(tmp()), DEFAULT_SETTINGS);
});

test('round-trips saved settings', () => {
  const dir = tmp();
  saveSettings(dir, { muted: true, resolution: { width: 1920, height: 1080 } });
  const s = loadSettings(dir);
  assert.strictEqual(s.muted, true);
  assert.strictEqual(s.resolution.width, 1920);
});

test('merges partial save over defaults', () => {
  const dir = tmp();
  saveSettings(dir, { muted: true });
  const s = loadSettings(dir);
  assert.strictEqual(s.muted, true);
  assert.deepStrictEqual(s.resolution, DEFAULT_SETTINGS.resolution);
});
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npm test`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Écrire `src/main/settings.js`**

```js
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SETTINGS = { resolution: { width: 1440, height: 800 }, muted: false };

function settingsPath(userDataDir) {
  return path.join(userDataDir, 'settings.json');
}

function loadSettings(userDataDir) {
  try {
    const raw = fs.readFileSync(settingsPath(userDataDir), 'utf-8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(userDataDir, partial) {
  fs.mkdirSync(userDataDir, { recursive: true });
  const merged = { ...DEFAULT_SETTINGS, ...partial };
  fs.writeFileSync(settingsPath(userDataDir), JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

module.exports = { loadSettings, saveSettings, settingsPath, DEFAULT_SETTINGS };
```

- [ ] **Step 4: Lancer le test, vérifier le succès**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/settings.js test/settings.test.js && git commit -m "feat: persisted settings (resolution, mute)"
```

---

### Task 4: Patcher (`patcher.js`)

**Files:**
- Create: `src/main/patcher.js`
- Test: `test/patcher.test.js`

**Contexte du format réel** (vérifié en direct) : `manifest.json` a la forme `{ files: { "regex.json": { filename, version }, "fixes.js": {...}, ... } }`. Le fichier `regex.json` a la forme `{ "<chemin fichier jeu>": [ [ "<regexSearch>", "<replacement>" ], ... ] }`. Exemple de règle réelle (rewrite d'asset) : `["cdvfile://localhost/persistent/data/assets", "../assets"]`. La règle plateforme réelle force `client:"android"` + `appVersion`/`buildVersion`.

**Interfaces:**
- Consumes: rien (axios injectable pour les tests).
- Produces:
  - `MANIFEST_URL`, `GAME_ORIGIN` (constantes)
  - `applyRegexRules(source: string, ruleList: [string,string][]) -> string`
  - `rulesForPath(regexMap: object, gamePath: string) -> [string,string][]` (match exact ou par suffixe)
  - `fetchPatchSet(http = axios, manifestUrl = MANIFEST_URL) -> { manifest, regexMap }`

- [ ] **Step 1: Écrire le test `test/patcher.test.js`**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { applyRegexRules, rulesForPath, fetchPatchSet } = require('../src/main/patcher');

test('applyRegexRules applies real asset-rewrite rule', () => {
  const rules = [['cdvfile://localhost/persistent/data/assets', '../assets']];
  const out = applyRegexRules('load cdvfile://localhost/persistent/data/assets/x.png', rules);
  assert.strictEqual(out, 'load ../assets/x.png');
});

test('applyRegexRules supports capture groups', () => {
  const rules = [['(client:\\s?)([^,\\n]*)', '$1"android"']];
  const out = applyRegexRules('language:x, client:foo, next:1', rules);
  assert.ok(out.includes('client:"android"'));
});

test('rulesForPath matches by suffix', () => {
  const map = { 'build/script.js': [['a', 'b']] };
  assert.deepStrictEqual(rulesForPath(map, 'build/script.js'), [['a', 'b']]);
  assert.deepStrictEqual(rulesForPath(map, 'foo/build/script.js'), [['a', 'b']]);
  assert.deepStrictEqual(rulesForPath(map, 'other.js'), []);
});

test('fetchPatchSet resolves regex.json via manifest (mocked http)', async () => {
  const manifest = { files: { 'regex.json': { filename: 'http://x/regex.json', version: '1' } } };
  const regexMap = { 'build/script.js': [['a', 'b']] };
  const http = {
    get: async (url) => (url.endsWith('manifest.json') ? { data: manifest } : { data: regexMap }),
  };
  const out = await fetchPatchSet(http, 'http://x/manifest.json');
  assert.deepStrictEqual(out.regexMap, regexMap);
});
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npm test`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Écrire `src/main/patcher.js`**

```js
const axios = require('axios');

const MANIFEST_URL = 'https://raw.githubusercontent.com/zenoxs/lindo-game-base/popup/manifest.json';
const GAME_ORIGIN = 'https://dt-proxy-production-login.ankama-games.com/';

function applyRegexRules(source, ruleList) {
  let out = source;
  for (const [search, replace] of ruleList) {
    out = out.replace(new RegExp(search, 'g'), replace);
  }
  return out;
}

function rulesForPath(regexMap, gamePath) {
  for (const key of Object.keys(regexMap)) {
    if (gamePath === key || gamePath.endsWith(key)) return regexMap[key];
  }
  return [];
}

async function fetchPatchSet(http = axios, manifestUrl = MANIFEST_URL) {
  const manifest = (await http.get(manifestUrl)).data;
  const regexUrl = manifest.files['regex.json'].filename;
  const regexMap = (await http.get(regexUrl)).data;
  return { manifest, regexMap };
}

module.exports = { applyRegexRules, rulesForPath, fetchPatchSet, MANIFEST_URL, GAME_ORIGIN };
```

- [ ] **Step 4: Lancer le test, vérifier le succès**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/patcher.js test/patcher.test.js && git commit -m "feat: patcher (fetch lindo regex.json, apply regex rules)"
```

---

### Task 5: Proxy local (`proxy.js`)

**Files:**
- Create: `src/main/proxy.js`
- Test: `test/proxy.test.js`

**Interfaces:**
- Consumes: `applyRegexRules`, `rulesForPath`, `GAME_ORIGIN` de `patcher.js`.
- Produces:
  - `createProxyApp({ regexMap, origin, http }) -> express app`
  - `startProxy(options) -> Promise<{ port, server, close }>`

- [ ] **Step 1: Écrire le test `test/proxy.test.js`**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { startProxy } = require('../src/main/proxy');

test('serves patched .js from the origin', async () => {
  const http = {
    get: async () => ({ data: 'x cdvfile://localhost/persistent/data/assets y' }),
  };
  const regexMap = {
    'build/script.js': [['cdvfile://localhost/persistent/data/assets', '../assets']],
  };
  const { port, close } = await startProxy({ regexMap, http });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/game/build/script.js`);
    const text = await res.text();
    assert.ok(text.includes('../assets'));
    assert.ok(res.headers.get('content-type').includes('javascript'));
  } finally {
    close();
  }
});

test('returns 502 on upstream error', async () => {
  const http = { get: async () => { throw new Error('boom'); } };
  const { port, close } = await startProxy({ regexMap: {}, http });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/game/index.html`);
    assert.strictEqual(res.status, 502);
  } finally {
    close();
  }
});
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npm test`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Écrire `src/main/proxy.js`**

```js
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { applyRegexRules, rulesForPath, GAME_ORIGIN } = require('./patcher');

const CONTENT_TYPES = {
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
};

function contentType(p) {
  const ext = p.slice(p.lastIndexOf('.'));
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

function createProxyApp({ regexMap = {}, origin = GAME_ORIGIN, http = axios } = {}) {
  const app = express();
  app.use(cors());
  app.get('/game/*', async (req, res) => {
    const gamePath = req.params[0];
    try {
      const upstream = await http.get(origin + gamePath, {
        responseType: 'text',
        transformResponse: (d) => d,
      });
      let body = upstream.data;
      if (gamePath.endsWith('.js')) {
        body = applyRegexRules(body, rulesForPath(regexMap, gamePath));
      }
      res.set('content-type', contentType(gamePath));
      res.send(body);
    } catch (e) {
      res.status(502).send('proxy error: ' + e.message);
    }
  });
  return app;
}

function startProxy(options) {
  const app = createProxyApp(options);
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ port, server, close: () => server.close() });
    });
  });
}

module.exports = { createProxyApp, startProxy, contentType };
```

- [ ] **Step 4: Lancer le test, vérifier le succès**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/proxy.js test/proxy.test.js && git commit -m "feat: local proxy serving patched game files"
```

---

### Task 6: Bridge preload + UI renderer

**Files:**
- Create: `src/preload/index.js`
- Create: `src/renderer/index.html`
- Create: `src/renderer/style.css`
- Create: `src/renderer/renderer.js`

**Interfaces:**
- Consumes (côté renderer, via `window.touch`, implémenté en Task 7) :
  - `getSettings() -> Promise<settings>`
  - `setSettings(partial) -> Promise<settings>`
  - `getGameUrl() -> Promise<string>`
  - `windowMinimize()`, `windowToggleMaximize()`, `windowClose()`
  - `getAppVersion() -> Promise<string>`
- Produces: pont IPC nommé `touch` + page UI.

Cette tâche n'a pas de test automatisé (Electron/DOM runtime) ; elle se vérifie au smoke manuel de Task 7.

- [ ] **Step 1: Écrire `src/preload/index.js`**

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('touch', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),
  getGameUrl: () => ipcRenderer.invoke('game:url'),
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  windowClose: () => ipcRenderer.send('window:close'),
});
```

- [ ] **Step 2: Écrire `src/renderer/index.html`**

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

    <main id="home">
      <h1>Touch in STAKK</h1>
      <p id="status">Prêt.</p>
      <button id="play">Jouer</button>
      <section class="settings">
        <label>Largeur <input id="res-w" type="number" min="960" /></label>
        <label>Hauteur <input id="res-h" type="number" min="600" /></label>
        <label><input id="muted" type="checkbox" /> Couper le son</label>
        <button id="save">Enregistrer</button>
      </section>
    </main>

    <webview id="game" hidden allowpopups></webview>

    <script src="renderer.js"></script>
  </body>
</html>
```

- [ ] **Step 3: Écrire `src/renderer/style.css`**

```css
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; height: 100vh; display: flex; flex-direction: column; background: #14161c; color: #e6e8ef; font-family: system-ui, sans-serif; }
.titlebar { height: 40px; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; background: #0e1015; -webkit-app-region: drag; }
.win-controls button { -webkit-app-region: no-drag; background: transparent; color: #e6e8ef; border: 0; width: 36px; height: 40px; cursor: pointer; }
.win-controls button:hover { background: #23262f; }
#close:hover { background: #b02525; }
main { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; }
h1 { margin: 0; font-weight: 600; }
#play { padding: 12px 40px; font-size: 18px; border: 0; border-radius: 8px; background: #3a6df0; color: #fff; cursor: pointer; }
#play:hover { background: #4d7df6; }
.settings { display: grid; gap: 8px; padding: 16px; background: #1b1e27; border-radius: 8px; }
.settings input[type="number"] { width: 90px; }
#game { flex: 1; width: 100%; border: 0; }
```

- [ ] **Step 4: Écrire `src/renderer/renderer.js`**

```js
const $ = (id) => document.getElementById(id);

$('min').onclick = () => window.touch.windowMinimize();
$('max').onclick = () => window.touch.windowToggleMaximize();
$('close').onclick = () => window.touch.windowClose();

async function loadSettingsIntoUI() {
  const s = await window.touch.getSettings();
  $('res-w').value = s.resolution.width;
  $('res-h').value = s.resolution.height;
  $('muted').checked = s.muted;
}

$('save').onclick = async () => {
  await window.touch.setSettings({
    resolution: { width: Number($('res-w').value), height: Number($('res-h').value) },
    muted: $('muted').checked,
  });
  $('status').textContent = 'Réglages enregistrés.';
};

$('play').onclick = async () => {
  $('status').textContent = 'Chargement du client…';
  try {
    const url = await window.touch.getGameUrl();
    const game = $('game');
    game.src = url;
    game.hidden = false;
    $('home').hidden = true;
  } catch (e) {
    $('status').textContent = 'Erreur: ' + e.message;
  }
};

loadSettingsIntoUI();
```

- [ ] **Step 5: Commit**

```bash
git add src/preload src/renderer && git commit -m "feat: preload bridge + launcher UI"
```

---

### Task 7: Process principal (`main/index.js`)

**Files:**
- Create: `src/main/index.js`

**Interfaces:**
- Consumes: `loadSettings`/`saveSettings` (settings.js), `fetchPatchSet` (patcher.js), `startProxy` (proxy.js), `installSpoofing` (spoof.js), API Electron.
- Produces: application exécutable via `npm start`. Implémente les canaux IPC consommés par le preload : `settings:get`, `settings:set`, `game:url`, `app:version`, `window:minimize`, `window:toggle-maximize`, `window:close`.

- [ ] **Step 1: Écrire `src/main/index.js`**

```js
const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('node:path');
const { loadSettings, saveSettings } = require('./settings');
const { fetchPatchSet } = require('./patcher');
const { startProxy } = require('./proxy');
const { installSpoofing } = require('./spoof');

let mainWindow = null;
let proxy = null;

function userDataDir() {
  return app.getPath('userData');
}

async function boot() {
  installSpoofing(session.defaultSession);

  let regexMap = {};
  try {
    ({ regexMap } = await fetchPatchSet());
  } catch (e) {
    console.error('patch manifest fetch failed:', e.message);
  }
  proxy = await startProxy({ regexMap });

  const settings = loadSettings(userDataDir());
  mainWindow = new BrowserWindow({
    width: settings.resolution.width,
    height: settings.resolution.height,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    backgroundColor: '#14161c',
    title: 'Touch in STAKK',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.includes('ankama.com')) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

ipcMain.handle('settings:get', () => loadSettings(userDataDir()));
ipcMain.handle('settings:set', (_e, partial) => saveSettings(userDataDir(), partial));
ipcMain.handle('game:url', () => `http://127.0.0.1:${proxy.port}/game/index.html`);
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.on('window:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('window:toggle-maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow && mainWindow.close());

app.whenReady().then(boot);
app.on('window-all-closed', () => {
  if (proxy) proxy.close();
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 2: Vérifier que les tests unitaires passent toujours**

Run: `npm test`
Expected: PASS (aucune régression).

- [ ] **Step 3: Smoke manuel — la fenêtre s'ouvre**

Run: `npm start`
Expected: fenêtre frameless « Touch in STAKK », titlebar draggable, boutons min/max/close fonctionnels, réglages chargés depuis le disque. Pas d'exception dans la console.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.js && git commit -m "feat: main process (window, proxy boot, spoof, IPC)"
```

---

### Task 8: Vérification live + ajustement des patchs

Cette tâche est intrinsèquement manuelle : elle valide le boot réel contre les serveurs Ankama et ajuste ce que les tests offline ne peuvent pas couvrir (chemin d'entrée exact du client, besoin éventuel du shell lindo `fixes.js`/`index.html`).

**Files:**
- Modify (si nécessaire): `src/main/proxy.js`, `src/main/patcher.js`, `src/main/index.js`

- [ ] **Step 1: Lancer et cliquer Jouer**

Run: `npm start`, cliquer **Jouer**.
Observer la console + l'onglet réseau (`mainWindow.webContents.openDevTools()` temporairement).

- [ ] **Step 2: Diagnostiquer le point de blocage**

- Si `GET /game/index.html` renvoie 404/502 → le chemin d'entrée réel du client diffère. Inspecter la réponse d'Ankama et corriger l'URL passée à `game:url` (ex. `?delayed=true`, ou un sous-chemin).
- Si la page charge mais le client refuse de booter (détection wrapper Android) → confirmer que la règle plateforme `client:"android"` s'applique bien sur le bon fichier `.js` (vérifier `rulesForPath` matche le chemin réel du script du jeu). Ajouter le service du shell lindo si requis : route `/app/*` proxifiant `manifest.files[name].filename`, et charger `game:url` = `http://127.0.0.1:PORT/app/index.html`.
- Si requêtes bloquées par CORS/headers → vérifier dans DevTools que le `User-Agent` sortant est bien un UA Android et que `sec-ch-ua*`/`Sec-Fetch-*` sont absents.

- [ ] **Step 3: Appliquer le correctif minimal identifié**

Modifier le fichier concerné (proxy route, mapping de chemin, ou URL d'entrée). Garder chaque changement petit ; re-tester après chacun.

- [ ] **Step 4: Confirmer l'écran de login Ankama**

Expected: l'écran de connexion Ankama officiel s'affiche dans la fenêtre. Se connecter avec ses identifiants → le jeu démarre.

- [ ] **Step 5: Re-lancer la suite de tests puis commit**

Run: `npm test`
Expected: PASS.

```bash
git add -A && git commit -m "fix: live boot adjustments for Dofus Touch client"
```

---

## Notes de vérification (self-review)

- **Couverture spec** : proxy local (Task 5), patchs live lindo (Task 4), spoofing headers (Task 2), réglages résolution/son (Task 3 + UI Task 6), fenêtre frameless (Task 6/7), gestion d'erreurs manifest/port/proxy (Task 4/5/7), auth webview (Task 6/7), boot réel (Task 8). Hors scope respecté (pas d'updater/installeur/multi-comptes/bot).
- **Login officiel Ankama** : identifiants saisis dans la page Ankama chargée en webview, jamais interceptés ni stockés par l'app.
- **Cohérence des types** : `window.touch` (preload) ↔ canaux IPC (main) alignés ; `regexMap`/`ruleList` de forme `[[search,replace],...]` cohérente entre patcher et proxy ; `startProxy` retourne `{ port, close }` utilisés en main.
- **Avertissement CGU** : documenté dans le spec ; l'app se présente comme le client Android officiel (violation possible des CGU Dofus Touch), usage aux risques de l'utilisateur.
