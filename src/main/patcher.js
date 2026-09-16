const axios = require('axios');
const path = require('node:path');
const nodeFs = require('node:fs');

// The community patch set lives in the lindo game base. It is pinned to a
// commit, not a branch: a moving branch means the launcher runs whatever that
// third-party repository happens to contain today, in the game's own main
// world. Bumping this constant is the (reviewable) way to take an update.
const LINDO_REPO = 'https://raw.githubusercontent.com/zenoxs/lindo-game-base/';
const LINDO_COMMIT = '0327e6986a1ab78900667c79663d0b2215894058';
const MANIFEST_URL = LINDO_REPO + LINDO_COMMIT + '/manifest.json';

// A copy of that same commit ships with the launcher (vendor/lindo). It is the
// last-resort source when GitHub is unreachable and nothing has been cached
// yet, so a fresh install still starts offline-ish instead of serving an
// unpatched game.
const VENDOR_DIR = path.join(__dirname, '../../vendor/lindo');

const GAME_ORIGIN = 'https://dt-proxy-production-login.ankama-games.com/';
// Dofus Touch on the App Store — its current version is what the client
// reports as appVersion. Retouch reads it from the same lookup endpoint.
const APP_STORE_LOOKUP = 'https://itunes.apple.com/lookup?id=1041406978';
const FALLBACK_APP_VERSION = '3.11.0';
// The game's own build number, which is NOT the App Store version. The proxy
// reads the real one out of build/script.js; this is only the value used when
// that read fails.
const FALLBACK_BUILD_VERSION = '1.74.4';

// Rewrite any lindo raw URL (the manifest points at the `popup` branch) onto
// the pinned commit, so every file we fetch comes from the reviewed tree.
function pinLindoUrl(url) {
  if (typeof url !== 'string') return url;
  return url.replace(
    /^https:\/\/raw\.githubusercontent\.com\/zenoxs\/lindo-game-base\/[^/]+\//,
    LINDO_REPO + LINDO_COMMIT + '/'
  );
}

// lindo's value captures `([^,\n]*)` assume a comma-terminated property value.
// The current Ankama build ends some values at a brace (e.g. `buildVersion:P}`),
// so an un-repaired capture swallows the closing `}` and the following tokens,
// producing invalid JS. Narrow the class to also stop at `}` and `)`.
function repairSearch(search) {
  // (1) The class may spell the newline as a literal backslash-n or an actual
  //     newline; narrow both to also stop values at a brace/paren.
  let out = search.replace(/\[\^,(\\n|\n)\]/g, '[^,$1})]');
  // (2) Some lindo rules were authored against a pretty-printed build and carry
  //     literal spaces (e.g. `t.m = e`) that the current minified build omits.
  //     Make every literal space optional so the rules still match.
  out = out.split(' ').join(' ?');
  return out;
}

function applyRegexRules(source, ruleList) {
  let out = source;
  for (const [search, replace] of ruleList) {
    out = out.replace(new RegExp(repairSearch(search), 'g'), replace);
  }
  return out;
}

function rulesForPath(regexMap, gamePath) {
  for (const key of Object.keys(regexMap)) {
    if (gamePath === key || gamePath.endsWith('/' + key)) return regexMap[key];
  }
  return [];
}

// Rules of our own, appended after the lindo rules. The lindo android rule
// rewrites the identity's buildVersion to the frozen window._ copy, but the
// game hardcodes the correct value in window.buildVersion at load. Reading that
// live value keeps the identity in step with the current build, so the server
// no longer rejects the connection as outdated ("nouvelle version disponible").
const EXTRA_RULES = {
  'build/script.js': [['window\\._\\["buildVersion"\\]', 'window.buildVersion']],
};

// Idempotent: a patch set restored from the disk cache already carries these.
function mergeExtraRules(regexMap) {
  for (const [key, extra] of Object.entries(EXTRA_RULES)) {
    const list = regexMap[key] || [];
    const missing = extra.filter(
      (rule) => !list.some((r) => r[0] === rule[0] && r[1] === rule[1])
    );
    regexMap[key] = list.concat(missing);
  }
  return regexMap;
}

async function fetchPatchSet(http = axios, manifestUrl = MANIFEST_URL) {
  const manifest = (await http.get(manifestUrl)).data;
  const regexUrl = pinLindoUrl(manifest.files['regex.json'].filename);
  const regexMap = mergeExtraRules((await http.get(regexUrl)).data);
  return { manifest, regexMap };
}

// The lindo manifest lists the shell files (index.html, fixes.js, fixes.css,
// keymaster2.js, icon.png) that the launcher must serve itself instead of
// proxying from Ankama. regex.json is the patch data, not a served file.
// With `localDir`, a file that exists there is served from disk instead of
// being fetched — that is how the vendored copy takes over when offline.
function lindoFilesFromManifest(manifest, localDir = null) {
  const out = {};
  const files = (manifest && manifest.files) || {};
  for (const [name, meta] of Object.entries(files)) {
    if (name === 'regex.json') continue;
    const local = localDir ? path.join(localDir, name) : null;
    out[name] = local && nodeFs.existsSync(local) ? local : pinLindoUrl(meta.filename);
  }
  return out;
}

function vendoredPatchSet(fs = nodeFs, dir = VENDOR_DIR) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8'));
  const regexMap = mergeExtraRules(JSON.parse(fs.readFileSync(path.join(dir, 'regex.json'), 'utf-8')));
  return { manifest, regexMap, source: 'vendor' };
}

function readPatchCache(fs, cacheFile) {
  const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
  if (!data || !data.manifest || !data.regexMap) throw new Error('incomplete cache');
  return { manifest: data.manifest, regexMap: mergeExtraRules(data.regexMap), source: 'cache' };
}

function writePatchCache(fs, cacheFile, set) {
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(
    cacheFile,
    JSON.stringify({ commit: LINDO_COMMIT, at: Date.now(), manifest: set.manifest, regexMap: set.regexMap }),
    'utf-8'
  );
}

// Three sources, in order: the pinned commit on GitHub, the last set that
// worked (disk cache), the copy vendored in the repository. The launcher only
// ends up with no patches at all if all three fail, which is what `source:
// 'none'` reports to the UI.
async function loadPatchSet({
  http = axios,
  manifestUrl = MANIFEST_URL,
  cacheFile = null,
  vendorDir = VENDOR_DIR,
  fs = nodeFs,
  log = () => {},
} = {}) {
  try {
    const set = await fetchPatchSet(http, manifestUrl);
    if (cacheFile) {
      try {
        writePatchCache(fs, cacheFile, set);
      } catch (e) {
        log('patch cache write failed: ' + e.message);
      }
    }
    return { ...set, source: 'remote' };
  } catch (e) {
    log('patch fetch failed: ' + e.message + ' | code=' + (e.code || ''));
  }
  if (cacheFile) {
    try {
      const set = readPatchCache(fs, cacheFile);
      log('patch set restored from cache');
      return set;
    } catch (e) {
      log('patch cache unusable: ' + e.message);
    }
  }
  try {
    const set = vendoredPatchSet(fs, vendorDir);
    log('patch set restored from the vendored copy');
    return set;
  } catch (e) {
    log('vendored patch set unusable: ' + e.message);
  }
  return { manifest: { files: {} }, regexMap: {}, source: 'none' };
}

async function fetchAppVersion(http = axios) {
  try {
    const r = await http.get(APP_STORE_LOOKUP, { timeout: 15000 });
    const v = r.data && r.data.results && r.data.results[0] && r.data.results[0].version;
    return v || FALLBACK_APP_VERSION;
  } catch {
    return FALLBACK_APP_VERSION;
  }
}

module.exports = {
  applyRegexRules,
  rulesForPath,
  fetchPatchSet,
  loadPatchSet,
  vendoredPatchSet,
  lindoFilesFromManifest,
  fetchAppVersion,
  pinLindoUrl,
  MANIFEST_URL,
  LINDO_COMMIT,
  VENDOR_DIR,
  GAME_ORIGIN,
  FALLBACK_APP_VERSION,
  FALLBACK_BUILD_VERSION,
};
