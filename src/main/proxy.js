const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const {
  applyRegexRules,
  rulesForPath,
  GAME_ORIGIN,
  VENDOR_DIR,
  FALLBACK_BUILD_VERSION,
} = require('./patcher');
const { createHttpCache, fetchCached, pruneCache } = require('./http-cache');
const { pickUserAgent } = require('./spoof');

const CONTENT_TYPES = {
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
};

// Server-side fetches to the Ankama CDN do not pass through the Electron
// session, so the header spoofing lives here too: present an Android UA and
// cap the request so a hung upstream cannot stall a webview request forever.
const PROXY_UA = pickUserAgent(0);
const PROXY_TIMEOUT_MS = 15000;

const TEXT_EXT = /\.(js|css|html|json)$/;

// The game hardcodes its own build number near the top of build/script.js. That
// is the value the server validates, so the shell must announce the same one.
const BUILD_VERSION_RE = /buildVersion\s*=\s*["']([0-9][0-9.]*)["']/;

// How many patched files stay memoized. The patch rules run over multi-MB
// minified sources, so doing it once per boot rather than once per request is
// what makes a second account open instantly.
const PATCH_MEMO_MAX = 24;

function contentType(p) {
  const dot = p.lastIndexOf('.');
  const ext = dot >= 0 ? p.slice(dot) : '';
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

function isRemote(src) {
  return typeof src === 'string' && /^https?:\/\//i.test(src);
}

// The lindo index.html is loaded as the top document. The real Android wrapper
// would define these globals and call initDofus(); we do the same by injecting
// the version/platform globals before the shell script and the boot call after.
//
// buildVersion is the game's build (read from build/script.js), not the App
// Store version: the shell freezes whatever it finds here into window._, which
// is what the client sends as its identity.
function injectShell(html, versions) {
  const head =
    '<script>' +
    'window.buildVersion=' + JSON.stringify(versions.buildVersion) + ';' +
    'window.appVersion=' + JSON.stringify(versions.appVersion) + ';' +
    'window.platform="win32";' +
    '</script>';
  const boot =
    '<script>window.addEventListener("DOMContentLoaded",function(){' +
    'if(window.initDofus)window.initDofus(function(){});});</script>';
  let out = html.replace(/<head>/i, '<head>' + head);
  out = out.replace(/<\/html>/i, boot + '</html>');
  return out;
}

function createProxyApp({
  regexMap = {},
  lindoFiles = {},
  // buildVersion left empty means "read it from the game build" — the only
  // value the login server accepts.
  versions = { appVersion: '', buildVersion: '' },
  origin = GAME_ORIGIN,
  http = axios,
  cacheDir = null,
  cache = createHttpCache(cacheDir),
  lindoFallbackDir = VENDOR_DIR,
  fs = fsp,
  log = () => {},
} = {}) {
  const app = express();
  app.use(cors());

  // Keep the cache directory bounded, once per launch and off the hot path.
  if (cacheDir) pruneCache(cacheDir, { fs, log }).catch((e) => log('cache prune failed: ' + e.message));

  async function getRaw(url) {
    return fetchCached(url, {
      http,
      cache,
      headers: { 'User-Agent': PROXY_UA },
      timeout: PROXY_TIMEOUT_MS,
      log,
    });
  }

  async function getText(url) {
    return (await getRaw(url)).body.toString('utf-8');
  }

  // A lindo shell file: from its (pinned) URL, from a local path when the
  // vendored copy is in use, and from the vendored copy as a last resort when
  // the fetch fails — an unreachable GitHub must not stop the launcher.
  async function lindoAsset(name) {
    const src = lindoFiles[name];
    try {
      if (isRemote(src)) return (await getRaw(src)).body;
      if (src) return await fs.readFile(src);
    } catch (e) {
      log('lindo file ' + name + ' unavailable (' + e.message + '), trying the vendored copy');
    }
    if (!lindoFallbackDir) throw new Error('no source for ' + name);
    return fs.readFile(path.join(lindoFallbackDir, name));
  }

  // url -> { hash, out }: re-patching only happens when the upstream body
  // actually changed.
  const patchMemo = new Map();
  function patched(url, raw, rules) {
    if (!rules.length) return raw.toString('utf-8');
    const hash = crypto.createHash('sha1').update(raw).digest('hex');
    const hit = patchMemo.get(url);
    if (hit && hit.hash === hash) return hit.out;
    const out = applyRegexRules(raw.toString('utf-8'), rules);
    patchMemo.set(url, { hash, out });
    if (patchMemo.size > PATCH_MEMO_MAX) patchMemo.delete(patchMemo.keys().next().value);
    return out;
  }

  let detectedBuild = null;
  async function resolveBuildVersion() {
    if (versions.buildVersion) return versions.buildVersion;
    if (detectedBuild) return detectedBuild;
    try {
      const src = await getText(origin + 'build/script.js');
      const m = src.match(BUILD_VERSION_RE);
      detectedBuild = (m && m[1]) || FALLBACK_BUILD_VERSION;
      log('buildVersion read from the game build: ' + detectedBuild + (m ? '' : ' (fallback)'));
    } catch (e) {
      detectedBuild = FALLBACK_BUILD_VERSION;
      log('buildVersion detection failed (' + e.message + '), using ' + detectedBuild);
    }
    return detectedBuild;
  }

  app.get('/game/*', async (req, res) => {
    const name = req.params[0];
    const qIndex = req.originalUrl.indexOf('?');
    const qs = qIndex >= 0 ? req.originalUrl.slice(qIndex) : '';
    try {
      // 1. The client shell (lindo index.html) — served with injected globals.
      if (name === 'index.html') {
        const html = (await lindoAsset('index.html')).toString('utf-8');
        const buildVersion = await resolveBuildVersion();
        res.set('content-type', 'text/html; charset=utf-8');
        res.send(injectShell(html, { appVersion: versions.appVersion, buildVersion }));
        return;
      }
      // 2. Files the lindo base provides (fixes.js, fixes.css, keymaster2.js,
      //    icon.png). Served as-is — they are already the compatibility layer.
      if (lindoFiles[name]) {
        const body = await lindoAsset(name);
        res.set('content-type', contentType(name));
        res.send(TEXT_EXT.test(name) ? body.toString('utf-8') : body);
        return;
      }
      // 3. Everything else — the real game files from the Ankama CDN, patched
      //    when a regex rule applies (build/script.js, build/styles-native.css).
      const upstreamUrl = origin + name + qs;
      const upstream = await getRaw(upstreamUrl);
      if (TEXT_EXT.test(name)) {
        res.set('content-type', contentType(name));
        res.send(patched(upstreamUrl, upstream.body, rulesForPath(regexMap, name)));
      } else {
        res.set('content-type', upstream.contentType || contentType(name));
        res.send(upstream.body);
      }
    } catch (e) {
      res.status(502).send('proxy error: ' + e.message);
    }
  });

  return app;
}

// A stable port matters: the game's storage (cookies, localStorage, IndexedDB)
// is keyed by origin `http://127.0.0.1:<port>`. A random port each launch would
// give a new origin and lose the saved session, so callers pass a fixed port;
// on collision we walk upward a few times rather than fall back to a random one.
function startProxy(options = {}) {
  const app = createProxyApp(options);
  const preferred = options.port || 0;
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryListen = (p) => {
      const server = app.listen(p, '127.0.0.1', () => {
        resolve({ port: server.address().port, server, close: () => server.close() });
      });
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && preferred !== 0 && attempt < 10) {
          attempt += 1;
          tryListen(preferred + attempt);
        } else {
          reject(err);
        }
      });
    };
    tryListen(preferred);
  });
}

module.exports = { createProxyApp, startProxy, contentType, injectShell };
