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
