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

function contentType(p) {
  const dot = p.lastIndexOf('.');
  const ext = dot >= 0 ? p.slice(dot) : '';
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

function createProxyApp({ regexMap = {}, origin = GAME_ORIGIN, http = axios } = {}) {
  const app = express();
  app.use(cors());
  app.get('/game/*', async (req, res) => {
    const gamePath = req.params[0];
    const qIndex = req.originalUrl.indexOf('?');
    const qs = qIndex >= 0 ? req.originalUrl.slice(qIndex) : '';
    const upstreamUrl = origin + gamePath + qs;
    try {
      if (gamePath.endsWith('.js')) {
        const upstream = await http.get(upstreamUrl, {
          responseType: 'text',
          transformResponse: (d) => d,
          headers: { 'User-Agent': PROXY_UA },
          timeout: PROXY_TIMEOUT_MS,
        });
        const body = applyRegexRules(upstream.data, rulesForPath(regexMap, gamePath));
        res.set('content-type', contentType(gamePath));
        res.send(body);
      } else {
        const upstream = await http.get(upstreamUrl, {
          responseType: 'arraybuffer',
          headers: { 'User-Agent': PROXY_UA },
          timeout: PROXY_TIMEOUT_MS,
        });
        const ct = (upstream.headers && upstream.headers['content-type']) || contentType(gamePath);
        res.set('content-type', ct);
        res.send(Buffer.from(upstream.data));
      }
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
