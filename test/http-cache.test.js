const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHttpCache, fetchCached, pruneCache, toBuffer } = require('../src/main/http-cache');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tis-cache-'));
}

test('createHttpCache(null) disables caching', () => {
  assert.strictEqual(createHttpCache(null), null);
});

test('cache round-trips a body and its validators', async () => {
  const cache = createHttpCache(tmpDir());
  await cache.write('http://x/a.js', { body: Buffer.from('hello'), etag: 'W/"1"', contentType: 'application/javascript' });
  const hit = await cache.read('http://x/a.js');
  assert.strictEqual(hit.body.toString('utf-8'), 'hello');
  assert.strictEqual(hit.etag, 'W/"1"');
  assert.strictEqual(hit.contentType, 'application/javascript');
});

test('cache.read returns null for an unknown url', async () => {
  const cache = createHttpCache(tmpDir());
  assert.strictEqual(await cache.read('http://x/missing.js'), null);
});

test('a second fetch revalidates with If-None-Match and reuses the cached body', async () => {
  const cache = createHttpCache(tmpDir());
  const seen = [];
  const http = {
    get: async (_url, opts) => {
      seen.push(opts.headers['If-None-Match']);
      if (seen.length === 1) return { status: 200, data: 'BODY', headers: { etag: '"v1"' } };
      return { status: 304, data: '', headers: {} };
    },
  };
  const first = await fetchCached('http://x/a.js', { http, cache });
  const second = await fetchCached('http://x/a.js', { http, cache });
  assert.strictEqual(first.body.toString('utf-8'), 'BODY');
  assert.strictEqual(second.body.toString('utf-8'), 'BODY');
  assert.strictEqual(second.fromCache, true);
  assert.deepStrictEqual(seen, [undefined, '"v1"']);
});

test('a failed fetch serves the cached body as stale', async () => {
  const cache = createHttpCache(tmpDir());
  await cache.write('http://x/a.js', { body: Buffer.from('OLD'), etag: null, contentType: 'text/plain' });
  const http = { get: async () => { throw new Error('offline'); } };
  const out = await fetchCached('http://x/a.js', { http, cache });
  assert.strictEqual(out.body.toString('utf-8'), 'OLD');
  assert.strictEqual(out.stale, true);
});

test('a failed fetch with nothing cached still throws', async () => {
  const cache = createHttpCache(tmpDir());
  const http = { get: async () => { throw new Error('offline'); } };
  await assert.rejects(() => fetchCached('http://x/none.js', { http, cache }), /offline/);
});

test('toBuffer accepts strings, buffers and array buffers', () => {
  assert.strictEqual(toBuffer('ab').toString('utf-8'), 'ab');
  assert.strictEqual(toBuffer(Buffer.from('ab')).toString('utf-8'), 'ab');
  assert.strictEqual(toBuffer(new Uint8Array([97, 98]).buffer).toString('utf-8'), 'ab');
});

test('pruneCache drops the oldest entries until it fits the budget', async () => {
  const dir = tmpDir();
  const cache = createHttpCache(dir);
  for (const [name, size] of [['a', 4000], ['b', 4000], ['c', 4000]]) {
    await cache.write('http://x/' + name, { body: Buffer.alloc(size, 1), etag: null });
    // Distinct mtimes so "oldest first" is well defined.
    await new Promise((r) => setTimeout(r, 15));
  }
  const out = await pruneCache(dir, { budget: 9000 });
  assert.strictEqual(out.removed, 1);
  assert.strictEqual(await cache.read('http://x/a'), null, 'the oldest entry should be gone');
  assert.ok(await cache.read('http://x/c'), 'the newest entry should survive');
});

test('pruneCache keeps everything under budget and tolerates a missing dir', async () => {
  const dir = tmpDir();
  const cache = createHttpCache(dir);
  await cache.write('http://x/a', { body: Buffer.alloc(10, 1) });
  assert.strictEqual((await pruneCache(dir, { budget: 1024 })).removed, 0);
  assert.deepStrictEqual(await pruneCache(path.join(dir, 'nope')), { removed: 0, kept: 0 });
});
