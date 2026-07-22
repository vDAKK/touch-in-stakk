const ANDROID_USER_AGENTS = [
  'Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 11; SM-A125U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.85 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 10; Redmi Note 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.90 Mobile Safari/537.36',
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

function pickUserAgent(seed) {
  const i = Math.abs(seed | 0) % ANDROID_USER_AGENTS.length;
  return ANDROID_USER_AGENTS[i] + UA_SUFFIX;
}

function deleteHeaderCI(obj, name) {
  const lower = name.toLowerCase();
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase() === lower) delete obj[key];
  }
}

function spoofHeaders(headers, url, seed = 0) {
  const out = { ...headers };
  for (const h of STRIPPED_HEADERS) deleteHeaderCI(out, h);
  if (REFERER_STRIPPED_HOSTS.some((host) => url.includes(host))) {
    deleteHeaderCI(out, 'referer');
  }
  out['User-Agent'] = pickUserAgent(seed);
  return out;
}

function installSpoofing(session) {
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = spoofHeaders(details.requestHeaders, details.url, details.id || 0);
    callback({ requestHeaders });
  });
}

module.exports = { spoofHeaders, pickUserAgent, installSpoofing, ANDROID_USER_AGENTS, UA_SUFFIX };
