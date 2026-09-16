const { test } = require('node:test');
const assert = require('node:assert');
const { applyRegexRules, rulesForPath, fetchPatchSet, lindoFilesFromManifest, fetchAppVersion } = require('../src/main/patcher');

test('lindoFilesFromManifest maps every file except regex.json', () => {
  const manifest = { files: {
    'index.html': { filename: 'u/index.html' },
    'fixes.js': { filename: 'u/fixes.js' },
    'regex.json': { filename: 'u/regex.json' },
  } };
  assert.deepStrictEqual(lindoFilesFromManifest(manifest), {
    'index.html': 'u/index.html',
    'fixes.js': 'u/fixes.js',
  });
});

test('fetchAppVersion returns the App Store version', async () => {
  const http = { get: async () => ({ data: { results: [{ version: '9.9.9' }] } }) };
  assert.strictEqual(await fetchAppVersion(http), '9.9.9');
});

test('fetchAppVersion falls back to the default on error', async () => {
  const http = { get: async () => { throw new Error('offline'); } };
  assert.strictEqual(await fetchAppVersion(http), '3.11.0');
});

test('applyRegexRules applies real asset-rewrite rule', () => {
  const rules = [['cdvfile://localhost/persistent/data/assets', '../assets']];
  const out = applyRegexRules('load cdvfile://localhost/persistent/data/assets/x.png', rules);
  assert.strictEqual(out, 'load ../assets/x.png');
});

test('applyRegexRules supports capture groups', () => {
  const rules = [['(client:\\s?)([^,\\n]*)', '$1"android"']];
  const out = applyRegexRules('language:x, client:foo, next:1', rules);
  assert.ok(out.includes('client:"android"'));
});

test('applyRegexRules stops a value capture at a closing brace', () => {
  // The lindo value class is [^,\n]* — without repair it would swallow the `}`
  // that closes the object literal and corrupt the following tokens.
  const rules = [['(v:)([^,\\n]*)', '$1X']];
  const out = applyRegexRules('{a:1,v:P}next', rules);
  assert.strictEqual(out, '{a:1,v:X}next');
});

test('rulesForPath matches by suffix', () => {
  const map = { 'build/script.js': [['a', 'b']] };
  assert.deepStrictEqual(rulesForPath(map, 'build/script.js'), [['a', 'b']]);
  assert.deepStrictEqual(rulesForPath(map, 'foo/build/script.js'), [['a', 'b']]);
  assert.deepStrictEqual(rulesForPath(map, 'other.js'), []);
});

test('rulesForPath does not match on a filename collision', () => {
  const map = { 'script.js': [['a', 'b']] };
  assert.deepStrictEqual(rulesForPath(map, 'script.js'), [['a', 'b']]);
  assert.deepStrictEqual(rulesForPath(map, 'foo/script.js'), [['a', 'b']]);
  assert.deepStrictEqual(rulesForPath(map, 'foo/notscript.js'), []);
});

test('fetchPatchSet appends the buildVersion override rule', async () => {
  const manifest = { files: { 'regex.json': { filename: 'http://x/regex.json', version: '1' } } };
  const regexMap = { 'build/script.js': [['a', 'b']] };
  const http = {
    get: async (url) => (url.endsWith('manifest.json') ? { data: manifest } : { data: regexMap }),
  };
  const out = await fetchPatchSet(http, 'http://x/manifest.json');
  const last = out.regexMap['build/script.js'].slice(-1)[0];
  assert.deepStrictEqual(last, ['window\\._\\["buildVersion"\\]', 'window.buildVersion']);
});

test('fetchPatchSet resolves regex.json via manifest (mocked http)', async () => {
  const manifest = { files: { 'regex.json': { filename: 'http://x/regex.json', version: '1' } } };
  const regexMap = { 'build/script.js': [['a', 'b']] };
  const http = {
    get: async (url) => (url.endsWith('manifest.json') ? { data: manifest } : { data: regexMap }),
  };
  const out = await fetchPatchSet(http, 'http://x/manifest.json');
  assert.deepStrictEqual(out.regexMap, regexMap);
});

// --- pinning, fallbacks and the disk cache ----------------------------------

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  loadPatchSet, vendoredPatchSet, pinLindoUrl, MANIFEST_URL, LINDO_COMMIT, VENDOR_DIR,
} = require('../src/main/patcher');

function tmpFile(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tis-patch-')), name);
}

const FAKE_MANIFEST = {
  files: {
    'regex.json': { filename: 'https://raw.githubusercontent.com/zenoxs/lindo-game-base/popup/regex.json?v=1' },
    'fixes.js': { filename: 'https://raw.githubusercontent.com/zenoxs/lindo-game-base/popup/fixes.js' },
  },
};
const FAKE_RULES = { 'build/script.js': [['a', 'b']] };

function okHttp(calls = []) {
  return {
    get: async (url) => {
      calls.push(url);
      return { data: url.includes('manifest.json') ? FAKE_MANIFEST : FAKE_RULES };
    },
  };
}

test('the manifest URL is pinned to a commit, not a branch', () => {
  assert.ok(MANIFEST_URL.includes(LINDO_COMMIT), MANIFEST_URL);
  assert.ok(!MANIFEST_URL.includes('/popup/'), MANIFEST_URL);
});

test('pinLindoUrl rewrites a branch URL onto the pinned commit', () => {
  const out = pinLindoUrl('https://raw.githubusercontent.com/zenoxs/lindo-game-base/popup/fixes.js');
  assert.strictEqual(out, 'https://raw.githubusercontent.com/zenoxs/lindo-game-base/' + LINDO_COMMIT + '/fixes.js');
  assert.strictEqual(pinLindoUrl('https://example.com/x.js'), 'https://example.com/x.js');
});

test('fetchPatchSet fetches regex.json from the pinned commit', async () => {
  const calls = [];
  await fetchPatchSet(okHttp(calls), 'http://x/manifest.json');
  assert.ok(calls[1].includes(LINDO_COMMIT), calls[1]);
});

test('lindoFilesFromManifest pins remote URLs and prefers local copies', () => {
  const remote = lindoFilesFromManifest(FAKE_MANIFEST);
  assert.ok(remote['fixes.js'].includes(LINDO_COMMIT));
  const local = lindoFilesFromManifest(FAKE_MANIFEST, VENDOR_DIR);
  assert.strictEqual(local['fixes.js'], path.join(VENDOR_DIR, 'fixes.js'));
});

test('the vendored patch set is readable and carries the buildVersion rule', () => {
  const set = vendoredPatchSet();
  assert.strictEqual(set.source, 'vendor');
  assert.ok(set.manifest.files['index.html']);
  const last = set.regexMap['build/script.js'].slice(-1)[0];
  assert.strictEqual(last[1], 'window.buildVersion');
});

test('loadPatchSet writes the fetched set to the cache file', async () => {
  const cacheFile = tmpFile('patchset.json');
  const set = await loadPatchSet({ http: okHttp(), manifestUrl: 'http://x/manifest.json', cacheFile });
  assert.strictEqual(set.source, 'remote');
  const saved = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
  assert.deepStrictEqual(saved.manifest, FAKE_MANIFEST);
  assert.strictEqual(saved.commit, LINDO_COMMIT);
});

test('loadPatchSet falls back to the cache when the fetch fails', async () => {
  const cacheFile = tmpFile('patchset.json');
  await loadPatchSet({ http: okHttp(), manifestUrl: 'http://x/manifest.json', cacheFile });
  const offline = { get: async () => { throw new Error('offline'); } };
  const set = await loadPatchSet({ http: offline, manifestUrl: 'http://x/manifest.json', cacheFile });
  assert.strictEqual(set.source, 'cache');
  assert.deepStrictEqual(set.manifest, FAKE_MANIFEST);
  // The extra rule is merged once, not once per restore.
  const extras = set.regexMap['build/script.js'].filter((r) => r[1] === 'window.buildVersion');
  assert.strictEqual(extras.length, 1);
});

test('loadPatchSet falls back to the vendored copy with no cache', async () => {
  const offline = { get: async () => { throw new Error('offline'); } };
  const set = await loadPatchSet({ http: offline, cacheFile: tmpFile('absent.json') });
  assert.strictEqual(set.source, 'vendor');
  assert.ok(Object.keys(set.regexMap).length > 0);
});

test('loadPatchSet reports source "none" when every source fails', async () => {
  const offline = { get: async () => { throw new Error('offline'); } };
  const set = await loadPatchSet({
    http: offline,
    cacheFile: tmpFile('absent.json'),
    vendorDir: path.join(os.tmpdir(), 'tis-no-vendor-here'),
  });
  assert.strictEqual(set.source, 'none');
  assert.deepStrictEqual(set.regexMap, {});
});

test('the vendored lindo copy is GPL-3.0 and stays out of the installers', () => {
  // Those files belong to zenoxs/lindo-game-base under GPL-3.0; shipping them
  // inside the MIT-licensed builds would be redistribution under a licence this
  // project does not carry.
  assert.ok(fs.existsSync(path.join(VENDOR_DIR, 'LICENSE')), 'the GPL text must ship with the copy');
  assert.ok(fs.existsSync(path.join(VENDOR_DIR, 'README.md')), 'the copy must say where it comes from');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8'));
  assert.ok(
    !pkg.build.files.some((f) => f.includes('vendor')),
    'build.files must not include vendor/'
  );
});
