// Disk cache for the files the proxy pulls from the Ankama CDN and from the
// lindo base. Without it every launch (and every account webview) re-downloads
// build/script.js — 5+ MB of minified JS — and re-runs the patch rules over it.
//
// Entries are validated, not trusted blindly: each request carries the stored
// ETag / Last-Modified, so an unchanged file costs one 304 instead of a full
// body. If the network fails entirely and an entry exists, it is served stale
// rather than failing the launch.
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

function keyOf(url) {
  return crypto.createHash('sha1').update(url).digest('hex');
}

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === 'string') return Buffer.from(data, 'utf-8');
  return Buffer.from(String(data == null ? '' : data), 'utf-8');
}

function createHttpCache(dir, { fs = fsp, log = () => {} } = {}) {
  if (!dir) return null;
  let ready = null;
  const ensure = () => {
    if (!ready) ready = fs.mkdir(dir, { recursive: true });
    return ready;
  };
  return {
    dir,
    async read(url) {
      try {
        const key = keyOf(url);
        const meta = JSON.parse(await fs.readFile(path.join(dir, key + '.json'), 'utf-8'));
        const body = await fs.readFile(path.join(dir, key + '.bin'));
        return { ...meta, body };
      } catch {
        return null;
      }
    },
    async write(url, entry) {
      try {
        await ensure();
        const key = keyOf(url);
        await fs.writeFile(path.join(dir, key + '.bin'), entry.body);
        await fs.writeFile(
          path.join(dir, key + '.json'),
          JSON.stringify({
            url,
            etag: entry.etag || null,
            lastModified: entry.lastModified || null,
            contentType: entry.contentType || null,
            at: Date.now(),
          }),
          'utf-8'
        );
      } catch (e) {
        log('cache write failed for ' + url + ': ' + e.message);
      }
    },
  };
}

// Returns { body: Buffer, contentType, fromCache, stale }.
async function fetchCached(url, { http, cache = null, headers = {}, timeout = 15000, log = () => {} } = {}) {
  const hit = cache ? await cache.read(url) : null;
  const reqHeaders = { ...headers };
  if (hit && hit.etag) reqHeaders['If-None-Match'] = hit.etag;
  if (hit && hit.lastModified) reqHeaders['If-Modified-Since'] = hit.lastModified;

  try {
    const res = await http.get(url, {
      responseType: 'arraybuffer',
      headers: reqHeaders,
      timeout,
      // 304 is a success here: it means the cached body is still current.
      validateStatus: (s) => (s >= 200 && s < 300) || s === 304,
      transformResponse: (d) => d,
    });
    if (res && res.status === 304 && hit) {
      return { body: hit.body, contentType: hit.contentType, fromCache: true, stale: false };
    }
    const h = (res && res.headers) || {};
    const body = toBuffer(res && res.data);
    const entry = {
      body,
      etag: h.etag || h.ETag || null,
      lastModified: h['last-modified'] || null,
      contentType: h['content-type'] || null,
    };
    if (cache) await cache.write(url, entry);
    return { body, contentType: entry.contentType, fromCache: false, stale: false };
  } catch (e) {
    if (hit) {
      log('serving ' + url + ' from cache after a failed fetch: ' + e.message);
      return { body: hit.body, contentType: hit.contentType, fromCache: true, stale: true };
    }
    throw e;
  }
}

// The game's assets change over time, so entries for files nobody asks for any
// more would pile up forever. Called once per launch: drop the least recently
// written entries until the directory fits the budget.
const CACHE_BUDGET_BYTES = 256 * 1024 * 1024;

async function pruneCache(dir, { budget = CACHE_BUDGET_BYTES, fs = fsp, log = () => {} } = {}) {
  if (!dir) return { removed: 0, kept: 0 };
  let names;
  try {
    names = await fs.readdir(dir);
  } catch {
    return { removed: 0, kept: 0 };
  }
  const entries = [];
  let total = 0;
  for (const name of names) {
    if (!name.endsWith('.bin')) continue;
    try {
      const st = await fs.stat(path.join(dir, name));
      entries.push({ key: name.slice(0, -4), size: st.size, at: st.mtimeMs });
      total += st.size;
    } catch {
      // raced with another prune or a partial write — nothing to account for
    }
  }
  if (total <= budget) return { removed: 0, kept: entries.length };
  entries.sort((a, b) => a.at - b.at);   // oldest first
  let removed = 0;
  for (const entry of entries) {
    if (total <= budget) break;
    try {
      await fs.rm(path.join(dir, entry.key + '.bin'), { force: true });
      await fs.rm(path.join(dir, entry.key + '.json'), { force: true });
      total -= entry.size;
      removed += 1;
    } catch (e) {
      log('cache prune failed for ' + entry.key + ': ' + e.message);
    }
  }
  log('cache pruned: ' + removed + ' entries dropped, ' + Math.round(total / 1048576) + ' MB left');
  return { removed, kept: entries.length - removed };
}

module.exports = { createHttpCache, fetchCached, pruneCache, keyOf, toBuffer, CACHE_BUDGET_BYTES };
