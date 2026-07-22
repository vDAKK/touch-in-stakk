const { test } = require('node:test');
const assert = require('node:assert');
const { startProxy, injectShell } = require('../src/main/proxy');

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

test('passes binary assets through unpatched with upstream content-type', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  const http = { get: async () => ({ data: png, headers: { 'content-type': 'image/png' } }) };
  const { port, close } = await startProxy({ regexMap: {}, http });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/game/assets/logo.png`);
    assert.strictEqual(res.headers.get('content-type'), 'image/png');
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.deepStrictEqual([bytes[0], bytes[1], bytes[2], bytes[3]], [0x89, 0x50, 0x4e, 0x47]);
  } finally {
    close();
  }
});

test('forwards the query string to the origin', async () => {
  let seen = '';
  const http = { get: async (url) => { seen = url; return { data: 'ok' }; } };
  const { port, close } = await startProxy({ regexMap: {}, http });
  try {
    await fetch(`http://127.0.0.1:${port}/game/build/script.js?v=1.6.0`);
    assert.ok(seen.endsWith('/build/script.js?v=1.6.0'), 'expected query forwarded, got: ' + seen);
  } finally {
    close();
  }
});

test('sends an Android User-Agent to the origin', async () => {
  let opts = null;
  const http = { get: async (_url, o) => { opts = o; return { data: 'ok', headers: {} }; } };
  const { port, close } = await startProxy({ regexMap: {}, http });
  try {
    await fetch(`http://127.0.0.1:${port}/game/build/script.js`);
    assert.ok(opts.headers['User-Agent'].includes('Android'), 'expected Android UA, got: ' + opts.headers['User-Agent']);
  } finally {
    close();
  }
});

test('startProxy honors a specified port (stable origin)', async () => {
  const first = await startProxy({});
  const port = first.port;
  first.close();
  await new Promise((r) => setTimeout(r, 50));
  const second = await startProxy({ port });
  try {
    assert.strictEqual(second.port, port);
  } finally {
    second.close();
  }
});

test('injectShell adds version globals before head and boot call before /html', () => {
  const out = injectShell('<html><head></head><body></body></html>', { appVersion: '1.2', buildVersion: '3.4' });
  assert.ok(out.includes('window.appVersion="1.2"'));
  assert.ok(out.includes('window.buildVersion="3.4"'));
  assert.ok(out.indexOf('initDofus') < out.indexOf('</html>'));
});

test('serves the injected lindo shell at /game/index.html', async () => {
  const shell = '<html lang="fr"><head></head><body></body></html>';
  const http = { get: async () => ({ data: shell }) };
  const lindoFiles = { 'index.html': 'http://lindo/index.html' };
  const versions = { appVersion: '3.11.0', buildVersion: '3.11.0' };
  const { port, close } = await startProxy({ lindoFiles, versions, http });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/game/index.html`);
    const text = await res.text();
    assert.ok(res.headers.get('content-type').includes('html'));
    assert.ok(text.includes('window.appVersion="3.11.0"'));
    assert.ok(text.includes('initDofus'));
  } finally {
    close();
  }
});

test('serves lindo files from the lindo url, unpatched', async () => {
  let seen = '';
  const http = { get: async (url) => { seen = url; return { data: 'FIXES' }; } };
  const lindoFiles = { 'fixes.js': 'http://lindo/fixes.js' };
  const regexMap = { 'fixes.js': [['FIXES', 'NOPE']] };
  const { port, close } = await startProxy({ lindoFiles, regexMap, http });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/game/fixes.js`);
    const text = await res.text();
    assert.strictEqual(seen, 'http://lindo/fixes.js');
    assert.strictEqual(text, 'FIXES');
  } finally {
    close();
  }
});
