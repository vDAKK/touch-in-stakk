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
