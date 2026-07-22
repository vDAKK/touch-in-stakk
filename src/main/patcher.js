const axios = require('axios');

const MANIFEST_URL = 'https://raw.githubusercontent.com/zenoxs/lindo-game-base/popup/manifest.json';
const GAME_ORIGIN = 'https://dt-proxy-production-login.ankama-games.com/';
// Dofus Touch on the App Store — its current version is what the client
// reports as appVersion. Retouch reads it from the same lookup endpoint.
const APP_STORE_LOOKUP = 'https://itunes.apple.com/lookup?id=1041406978';
const FALLBACK_APP_VERSION = '3.11.0';

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

async function fetchPatchSet(http = axios, manifestUrl = MANIFEST_URL) {
  const manifest = (await http.get(manifestUrl)).data;
  const regexUrl = manifest.files['regex.json'].filename;
  const regexMap = (await http.get(regexUrl)).data;
  return { manifest, regexMap };
}

// The lindo manifest lists the shell files (index.html, fixes.js, fixes.css,
// keymaster2.js, icon.png) that the launcher must serve itself instead of
// proxying from Ankama. regex.json is the patch data, not a served file.
function lindoFilesFromManifest(manifest) {
  const out = {};
  const files = (manifest && manifest.files) || {};
  for (const [name, meta] of Object.entries(files)) {
    if (name === 'regex.json') continue;
    out[name] = meta.filename;
  }
  return out;
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
  lindoFilesFromManifest,
  fetchAppVersion,
  MANIFEST_URL,
  GAME_ORIGIN,
  FALLBACK_APP_VERSION,
};
