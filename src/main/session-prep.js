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

function prepareSession(sess, log) {
  if (prepared.has(sess)) return false;
  prepared.add(sess);
  installSpoofing(sess);
  blockThirdParty(sess);
  installRequestLogging(sess, log || (() => {}));
  return true;
}

module.exports = { prepareSession, blockThirdParty, installRequestLogging, THIRD_PARTY_BLOCK };
