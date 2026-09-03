const ANDROID_USER_AGENTS = [
  'Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 11; SM-A125U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.85 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 10; Redmi Note 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.90 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; moto g(60)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; V2111) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
];
const UA_SUFFIX = ' DofusTouch Client';

const STRIPPED_HEADERS = [
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
];
const REFERER_STRIPPED_HOSTS = ['static.ankama.com'];

// Stable hash of a string, so a given account always maps to the same device.
function hashSeed(seed) {
  const s = String(seed == null ? '' : seed);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

function pickUserAgent(seed) {
  const i = hashSeed(seed) % ANDROID_USER_AGENTS.length;
  return ANDROID_USER_AGENTS[i] + UA_SUFFIX;
}

// Per-device values that must stay consistent with the chosen user agent:
// a request claiming a Pixel 7 while the page reports a Galaxy screen is more
// distinctive than not spoofing at all.
const DEVICE_PROFILES = [
  { platform: 'Linux armv8l', model: 'SM-G991B',       width: 360, height: 800, dpr: 3,   mem: 8, cores: 8 },
  { platform: 'Linux armv8l', model: 'Pixel 6',        width: 412, height: 915, dpr: 2.6, mem: 8, cores: 8 },
  { platform: 'Linux armv8l', model: 'Pixel 7',        width: 412, height: 915, dpr: 2.6, mem: 8, cores: 8 },
  { platform: 'Linux armv8l', model: 'SM-A125U',       width: 360, height: 800, dpr: 2,   mem: 4, cores: 8 },
  { platform: 'Linux armv8l', model: 'Redmi Note 8 Pro', width: 393, height: 851, dpr: 2.75, mem: 6, cores: 8 },
  { platform: 'Linux armv8l', model: 'SM-S918B',      width: 384, height: 832, dpr: 2.81, mem: 8, cores: 8 },
  { platform: 'Linux armv8l', model: 'moto g(60)',    width: 393, height: 873, dpr: 2.75, mem: 6, cores: 8 },
  { platform: 'Linux armv8l', model: 'V2111',         width: 360, height: 800, dpr: 3,    mem: 8, cores: 8 },
];

function deviceProfile(seed) {
  const i = hashSeed(seed) % DEVICE_PROFILES.length;
  return { ...DEVICE_PROFILES[i], userAgent: ANDROID_USER_AGENTS[i] + UA_SUFFIX };
}

function deleteHeaderCI(obj, name) {
  const lower = name.toLowerCase();
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase() === lower) delete obj[key];
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function spoofHeaders(headers, url, seed = 0) {
  const out = { ...headers };
  for (const h of STRIPPED_HEADERS) deleteHeaderCI(out, h);
  if (REFERER_STRIPPED_HOSTS.includes(hostOf(url))) deleteHeaderCI(out, 'referer');
  deleteHeaderCI(out, 'user-agent');
  out['User-Agent'] = pickUserAgent(seed);
  return out;
}

// `seed` identifies the account (its partition name). It must NOT be derived
// from the request: details.id changes on every call, which had each account
// picking a different device per request instead of one stable device each.
function installSpoofing(session, seed = 0) {
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = spoofHeaders(details.requestHeaders, details.url, seed);
    callback({ requestHeaders });
  });
  try {
    session.setUserAgent(pickUserAgent(seed));
  } catch {
    // Older Electron: the header rewrite above still applies.
  }
}

module.exports = {
  spoofHeaders, pickUserAgent, installSpoofing, deviceProfile, hashSeed,
  ANDROID_USER_AGENTS, UA_SUFFIX, DEVICE_PROFILES,
};
