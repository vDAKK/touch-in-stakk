// How a keyboard shortcut is stored and matched.
//
// Two kinds of binding live in the same string field:
//   'i'             — a character: whatever the layout types stays the shortcut.
//   'code:Digit1'   — a physical key, matched on event.code.
//
// The number row is the reason for the second kind. On an AZERTY keyboard its
// unshifted characters are & é " ' ( - è _ ç à, so a spell bound to the
// character '1' only fires with Shift held — while the game itself answers to
// the key's position. Spells (and the Ctrl+1…9 tab switches) are therefore
// matched by position, and the settings dialog shows whatever character that
// position types on the user's own layout.
//
// Loaded as a CommonJS module (tests) and as a plain <script> in the renderer,
// like src/i18n/strings.js — hence the file-specific export name.

const CODE_PREFIX = 'code:';
const DIGIT_CODE = /^(Digit|Numpad)([0-9])$/;

function isCodeBinding(binding) {
  return typeof binding === 'string' && binding.startsWith(CODE_PREFIX);
}

function codeOf(binding) {
  return isCodeBinding(binding) ? binding.slice(CODE_PREFIX.length) : null;
}

function codeBinding(code) {
  return CODE_PREFIX + code;
}

// What to store when the user records a shortcut: the physical key for the
// number row and the numpad, the typed character for everything else.
function bindingForEvent(event) {
  if (event && typeof event.code === 'string' && DIGIT_CODE.test(event.code)) {
    return codeBinding(event.code);
  }
  return event ? event.key : '';
}

// The digit a physical key carries, whatever the layout: 'Digit3' / 'Numpad3'
// -> 3. Null for anything else.
function digitOfCode(code) {
  const m = typeof code === 'string' ? code.match(DIGIT_CODE) : null;
  return m ? Number(m[2]) : null;
}

// Ctrl+1…9 switches tabs. Read the position first so it works on every layout,
// and fall back to the character for keyboards that report no usable code.
function digitOfEvent(event) {
  if (!event) return null;
  const byCode = digitOfCode(event.code);
  if (byCode != null) return byCode;
  if (typeof event.key === 'string' && event.key.length === 1 && event.key >= '0' && event.key <= '9') {
    return Number(event.key);
  }
  return null;
}

// actionId -> binding, split into the two lookup tables the key handler uses.
// A binding on the number row also answers on the matching numpad key, unless
// something else already claims it.
function splitBindings(bindings) {
  const keys = {};
  const codes = {};
  for (const [actionId, binding] of Object.entries(bindings || {})) {
    if (!binding) continue;
    const code = codeOf(binding);
    if (!code) {
      keys[binding] = actionId;
      continue;
    }
    codes[code] = actionId;
    const digit = digitOfCode(code);
    if (digit != null) {
      const twin = code.startsWith('Digit') ? 'Numpad' + digit : 'Digit' + digit;
      if (codes[twin] === undefined) codes[twin] = actionId;
    }
  }
  return { keys, codes };
}

// The action a keydown triggers, or null.
function actionForEvent(tables, event) {
  if (!tables || !event) return null;
  const byKey = tables.keys && tables.keys[event.key];
  if (byKey) return byKey;
  const byCode = tables.codes && tables.codes[event.code];
  return byCode || null;
}

const KEYS_API = {
  CODE_PREFIX,
  isCodeBinding,
  codeOf,
  codeBinding,
  bindingForEvent,
  digitOfCode,
  digitOfEvent,
  splitBindings,
  actionForEvent,
};

if (typeof module !== 'undefined' && module.exports) module.exports = KEYS_API;
if (typeof globalThis !== 'undefined') globalThis.STAKK_KEYS = KEYS_API;
