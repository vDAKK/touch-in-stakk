const axios = require('axios');

const MANIFEST_URL = 'https://raw.githubusercontent.com/zenoxs/lindo-game-base/popup/manifest.json';
const GAME_ORIGIN = 'https://dt-proxy-production-login.ankama-games.com/';

function applyRegexRules(source, ruleList) {
  let out = source;
  for (const [search, replace] of ruleList) {
    out = out.replace(new RegExp(search, 'g'), replace);
  }
  return out;
}

function rulesForPath(regexMap, gamePath) {
  for (const key of Object.keys(regexMap)) {
    if (gamePath === key || gamePath.endsWith(key)) return regexMap[key];
  }
  return [];
}

async function fetchPatchSet(http = axios, manifestUrl = MANIFEST_URL) {
  const manifest = (await http.get(manifestUrl)).data;
  const regexUrl = manifest.files['regex.json'].filename;
  const regexMap = (await http.get(regexUrl)).data;
  return { manifest, regexMap };
}

module.exports = { applyRegexRules, rulesForPath, fetchPatchSet, MANIFEST_URL, GAME_ORIGIN };
