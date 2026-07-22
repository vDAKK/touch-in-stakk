const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { applyRegexRules, rulesForPath, GAME_ORIGIN } = require('./patcher');
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

function contentType(p) {
  const dot = p.lastIndexOf('.');
  const ext = dot >= 0 ? p.slice(dot) : '';
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

// The lindo index.html is loaded as the top document. The real Android wrapper
// would define these globals and call initDofus(); we do the same by injecting
// the version/platform globals before the shell script and the boot call after.
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
  versions = { appVersion: '', buildVersion: '' },
  origin = GAME_ORIGIN,
  http = axios,
} = {}) {
  const app = express();
  app.use(cors());

  async function getText(url) {
    const r = await http.get(url, {
      responseType: 'text',
      transformResponse: (d) => d,
      headers: { 'User-Agent': PROXY_UA },
      timeout: PROXY_TIMEOUT_MS,
    });
    return r.data;
  }

  async function getBinary(url) {
    return http.get(url, {
      responseType: 'arraybuffer',
      headers: { 'User-Agent': PROXY_UA },
      timeout: PROXY_TIMEOUT_MS,
    });
  }

  app.get('/game/*', async (req, res) => {
    const name = req.params[0];
    const qIndex = req.originalUrl.indexOf('?');
    const qs = qIndex >= 0 ? req.originalUrl.slice(qIndex) : '';
    try {
      // 1. The client shell (lindo index.html) — served with injected globals.
      if (name === 'index.html') {
        const html = await getText(lindoFiles['index.html']);
        res.set('content-type', 'text/html; charset=utf-8');
        res.send(injectShell(html, versions));
        return;
      }
      // 2. Files the lindo base provides (fixes.js, fixes.css, keymaster2.js,
      //    icon.png). Served as-is — they are already the compatibility layer.
      if (lindoFiles[name]) {
        if (TEXT_EXT.test(name)) {
          res.set('content-type', contentType(name));
          res.send(await getText(lindoFiles[name]));
        } else {
          const upstream = await getBinary(lindoFiles[name]);
          res.set('content-type', contentType(name));
          res.send(Buffer.from(upstream.data));
        }
        return;
      }
      // 3. Everything else — the real game files from the Ankama CDN, patched
      //    when a regex rule applies (build/script.js, build/styles-native.css).
      const upstreamUrl = origin + name + qs;
      if (TEXT_EXT.test(name)) {
        const body = applyRegexRules(await getText(upstreamUrl), rulesForPath(regexMap, name));
        res.set('content-type', contentType(name));
        res.send(body);
      } else {
        const upstream = await getBinary(upstreamUrl);
        const ct = (upstream.headers && upstream.headers['content-type']) || contentType(name);
        res.set('content-type', ct);
        res.send(Buffer.from(upstream.data));
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
