const { installSpoofing } = require('./spoof');

const THIRD_PARTY_BLOCK = ['*://lindo-app.com/*', '*://*.lindo-app.com/*'];

function blockThirdParty(sess) {
  sess.webRequest.onBeforeRequest({ urls: THIRD_PARTY_BLOCK }, (_details, callback) =>
    callback({ cancel: true })
  );
}

function installRequestLogging(sess, log) {
  sess.webRequest.onErrorOccurred((details) => {
    if (details.error && details.error !== 'net::ERR_ABORTED') {
      log('req-error ' + details.error + ' ' + details.url);
    }
  });
}

const prepared = new WeakSet();

// The device seed is derived from the session itself, never from the caller:
// session.fromPartition() fires 'session-created' whose handler prepares the
// session first (and the WeakSet then rejects the seeded call), which left
// every account's HTTP user agent on profile 0 while the page reported its
// own device — a mismatch servers read as a device change.
function seedOf(sess) {
  try {
    const p = sess.getStoragePath && sess.getStoragePath();
    if (p) return p;
  } catch {}
  return 0;
}

function prepareSession(sess, log) {
  if (prepared.has(sess)) return false;
  prepared.add(sess);
  installSpoofing(sess, seedOf(sess));
  blockThirdParty(sess);
  installRequestLogging(sess, log || (() => {}));
  return true;
}

module.exports = { prepareSession, seedOf, blockThirdParty, installRequestLogging, THIRD_PARTY_BLOCK };
