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

test('fetchPatchSet resolves regex.json via manifest (mocked http)', async () => {
  const manifest = { files: { 'regex.json': { filename: 'http://x/regex.json', version: '1' } } };
  const regexMap = { 'build/script.js': [['a', 'b']] };
  const http = {
    get: async (url) => (url.endsWith('manifest.json') ? { data: manifest } : { data: regexMap }),
  };
  const out = await fetchPatchSet(http, 'http://x/manifest.json');
  assert.deepStrictEqual(out.regexMap, regexMap);
});
