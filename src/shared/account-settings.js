// Which settings an account may own, and how an account's effective settings
// are derived.
//
// An account inherits the global settings until it is marked `custom`. Ticking
// that box copies the current global values into the account, so changing a
// global setting afterwards no longer moves that account — which is the point:
// a mule is configured once and stays configured.
//
// Loaded both as a CommonJS module (main process, tests) and as a plain script
// in the renderer, like src/i18n/strings.js.

// Everything an account can own. The rest — language, window size, tab bar
// side, "mute inactive tabs" — describes the launcher itself, not an account.
const PER_ACCOUNT_KEYS = [
  'muted',
  'notifications',
  'switchOnTurn',
  'autoAcceptOwn',
  'autoAcceptGroup',
  'joinLeaderFight',
  'noConfirm',
  'showResources',
  'hideShop',
  'entitiesSelector',
  'keybinds',
];

function pickPerAccount(source) {
  const out = {};
  if (!source) return out;
  for (const key of PER_ACCOUNT_KEYS) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

// The settings that apply to one account: the global ones, with the account's
// own values on top when it has been made custom.
function effectiveSettings(global, account) {
  const out = { ...(global || {}) };
  if (!account || !account.custom) return out;
  const own = account.settings || {};
  for (const key of PER_ACCOUNT_KEYS) {
    if (own[key] !== undefined) out[key] = own[key];
  }
  return out;
}

// True when this account is configured on its own rather than following the
// launcher's settings.
function isCustom(account) {
  return !!(account && account.custom);
}

// Named for its file, not `API`: the renderer loads this and src/i18n/strings.js
// as plain scripts, which share one global lexical scope — two `const API`
// declarations there are a SyntaxError that kills whichever loads second.
const ACCOUNT_SETTINGS_API = { PER_ACCOUNT_KEYS, pickPerAccount, effectiveSettings, isCustom };

if (typeof module !== 'undefined' && module.exports) module.exports = ACCOUNT_SETTINGS_API;
if (typeof globalThis !== 'undefined') globalThis.STAKK_ACCOUNT_SETTINGS = ACCOUNT_SETTINGS_API;
