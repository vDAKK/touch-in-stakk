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
