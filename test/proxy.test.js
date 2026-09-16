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
    const res = await fetch(`http://127.0.0.1:${port}/game/build/script.js`);
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

// --- offline resilience, caching and buildVersion ---------------------------

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tis-proxy-'));
}

test('falls back to the vendored shell when the lindo fetch fails', async () => {
  const http = { get: async () => { throw new Error('offline'); } };
  const lindoFiles = { 'index.html': 'http://lindo/index.html' };
  const { port, close } = await startProxy({ lindoFiles, http, versions: { appVersion: '3.11.0', buildVersion: '1.74.4' } });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/game/index.html`);
    const text = await res.text();
    assert.strictEqual(res.status, 200);
    assert.ok(text.includes('initDofus'), 'expected the vendored lindo shell');
    assert.ok(text.includes('window.buildVersion="1.74.4"'));
  } finally {
    close();
  }
});

test('serves a vendored lindo file from disk without any fetch', async () => {
  let calls = 0;
  const http = { get: async () => { calls += 1; return { data: 'nope' }; } };
  const lindoFiles = { 'fixes.js': path.join(__dirname, '../vendor/lindo/fixes.js') };
  const { port, close } = await startProxy({ lindoFiles, http });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/game/fixes.js`);
    const text = await res.text();
    assert.strictEqual(calls, 0, 'a local file must not be fetched');
    assert.ok(text.length > 0);
  } finally {
    close();
  }
});

test('reads the real buildVersion out of the game build', async () => {
  const http = {
    get: async (url) => {
      if (url.endsWith('build/script.js')) return { data: 'var x;window.buildVersion="9.8.7";' };
      return { data: '<html><head></head><body></body></html>' };
    },
  };
  const lindoFiles = { 'index.html': 'http://lindo/index.html' };
  const versions = { appVersion: '3.11.0', buildVersion: '' };
  const { port, close } = await startProxy({ lindoFiles, versions, http });
  try {
    const text = await (await fetch(`http://127.0.0.1:${port}/game/index.html`)).text();
    assert.ok(text.includes('window.buildVersion="9.8.7"'), text.slice(0, 200));
    assert.ok(text.includes('window.appVersion="3.11.0"'));
  } finally {
    close();
  }
});

test('falls back to a known buildVersion when the build cannot be read', async () => {
  const http = {
    get: async (url) => {
      if (url.endsWith('build/script.js')) throw new Error('offline');
      return { data: '<html><head></head><body></body></html>' };
    },
  };
  const lindoFiles = { 'index.html': 'http://lindo/index.html' };
  const { port, close } = await startProxy({ lindoFiles, versions: { appVersion: '3.11.0', buildVersion: '' }, http });
  try {
    const text = await (await fetch(`http://127.0.0.1:${port}/game/index.html`)).text();
    assert.ok(/window\.buildVersion="\d+\.\d+\.\d+"/.test(text), text.slice(0, 200));
    assert.ok(!text.includes('window.buildVersion="3.11.0"'), 'the App Store version is not a build version');
  } finally {
    close();
  }
});

test('revalidates a cached game file instead of downloading it again', async () => {
  const cacheDir = tmpDir();
  const seen = [];
  const http = {
    get: async (_url, opts) => {
      seen.push(opts.headers['If-None-Match']);
      if (seen.length === 1) return { status: 200, data: 'SRC one', headers: { etag: '"v1"' } };
      return { status: 304, data: '', headers: {} };
    },
  };
  const regexMap = { 'build/script.js': [['one', 'two']] };
  const first = await startProxy({ regexMap, http, cacheDir });
  try {
    assert.strictEqual(await (await fetch(`http://127.0.0.1:${first.port}/game/build/script.js`)).text(), 'SRC two');
  } finally {
    first.close();
  }
  // A new launcher run, same cache directory: the body is revalidated, not refetched.
  const second = await startProxy({ regexMap, http, cacheDir });
  try {
    assert.strictEqual(await (await fetch(`http://127.0.0.1:${second.port}/game/build/script.js`)).text(), 'SRC two');
  } finally {
    second.close();
  }
  assert.deepStrictEqual(seen, [undefined, '"v1"']);
});

test('serves a cached game file when the origin is unreachable', async () => {
  const cacheDir = tmpDir();
  let online = true;
  const http = {
    get: async () => {
      if (!online) throw new Error('offline');
      return { status: 200, data: 'SRC', headers: {} };
    },
  };
  const warm = await startProxy({ regexMap: {}, http, cacheDir });
  try {
    await fetch(`http://127.0.0.1:${warm.port}/game/build/script.js`);
  } finally {
    warm.close();
  }
  online = false;
  const offline = await startProxy({ regexMap: {}, http, cacheDir });
  try {
    const res = await fetch(`http://127.0.0.1:${offline.port}/game/build/script.js`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await res.text(), 'SRC');
  } finally {
    offline.close();
  }
});

test('patches an unchanged source only once', async () => {
  const http = { get: async () => ({ status: 200, data: 'aaa', headers: { etag: '"v1"' } }) };
  const rules = [['aaa', 'bbb']];
  const { port, close } = await startProxy({ regexMap: { 'build/script.js': rules }, http });
  try {
    assert.strictEqual(await (await fetch(`http://127.0.0.1:${port}/game/build/script.js`)).text(), 'bbb');
    // Changing the rules behind the proxy's back proves the second request did
    // not re-run them: the memoized output for that unchanged body is reused.
    rules.push(['bbb', 'ccc']);
    assert.strictEqual(await (await fetch(`http://127.0.0.1:${port}/game/build/script.js`)).text(), 'bbb');
  } finally {
    close();
  }
});
