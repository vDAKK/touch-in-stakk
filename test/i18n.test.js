const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { LANGS, DICTS, resolveLang, translate, gameStrings } = require('../src/i18n/strings');

test('ships exactly the supported languages', () => {
  assert.deepStrictEqual(LANGS, ['fr', 'en']);
  assert.deepStrictEqual(Object.keys(DICTS).sort(), ['en', 'fr']);
});

// A missing translation would silently fall back to French for English users,
// so the dictionaries must stay key-for-key identical.
test('both dictionaries define the same keys', () => {
  const fr = Object.keys(DICTS.fr).sort();
  const en = Object.keys(DICTS.en).sort();
  const missingInEn = fr.filter((k) => !DICTS.en[k]);
  const missingInFr = en.filter((k) => !DICTS.fr[k]);
  assert.deepStrictEqual(missingInEn, [], 'keys missing from en');
  assert.deepStrictEqual(missingInFr, [], 'keys missing from fr');
});

test('no dictionary entry is left empty', () => {
  for (const lang of LANGS) {
    for (const [key, value] of Object.entries(DICTS[lang])) {
      assert.ok(typeof value === 'string' && value.trim(), lang + '.' + key + ' is empty');
    }
  }
});

test('a saved language wins over the system locale', () => {
  assert.strictEqual(resolveLang('en', 'fr-FR'), 'en');
  assert.strictEqual(resolveLang('fr', 'en-US'), 'fr');
});

test('falls back to the system locale, then to English', () => {
  assert.strictEqual(resolveLang(null, 'fr-FR'), 'fr');
  assert.strictEqual(resolveLang(null, 'fr'), 'fr');
  assert.strictEqual(resolveLang(null, 'en-US'), 'en');
  assert.strictEqual(resolveLang(null, 'de-DE'), 'en');
  assert.strictEqual(resolveLang(null, undefined), 'en');
});

test('ignores an unknown saved language', () => {
  assert.strictEqual(resolveLang('es', 'fr-FR'), 'fr');
});

test('translates and substitutes parameters', () => {
  assert.strictEqual(translate('fr', 'settings.save'), 'Enregistrer');
  assert.strictEqual(translate('en', 'settings.save'), 'Save');
  assert.strictEqual(translate('en', 'notify.travelStart', { x: 5, y: -18 }), 'Travelling to 5,-18');
});

test('leaves an unknown key visible instead of printing blank UI', () => {
  assert.strictEqual(translate('fr', 'nope.not.here'), 'nope.not.here');
});

test('gameStrings carries every game.* key, stripped of its prefix', () => {
  const s = gameStrings('en');
  const expected = Object.keys(DICTS.en).filter((k) => k.startsWith('game.')).length;
  assert.strictEqual(Object.keys(s).length, expected);
  assert.ok(expected > 0);
  assert.strictEqual(s.runHere, DICTS.en['game.runHere']);
});

// The renderer has no bundler and no node integration: it loads the same file
// through a <script> tag, which only works while the file self-registers on
// globalThis.
test('the dictionary file registers itself for the renderer', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n', 'strings.js'), 'utf8');
  assert.match(src, /globalThis\.STAKK_I18N/);
});

// Every translatable string in the launcher markup goes through data-i18n, so
// a hard-coded one would stay French whatever the user picks.
test('the launcher markup holds no hard-coded translatable text', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const body = html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const texts = [...body.matchAll(/>([^<>]+)</g)]
    .map((m) => m[1].trim())
    // Brand name, separators and keycaps are the same in both languages.
    .filter((t) => t && !/^[\s×…✕&;a-z0-9+\-/]*$/i.test(t))
    .filter((t) => !['Touch in', 'STAKK', 'Ctrl', 'Tab', 'F2', 'F11'].includes(t));
  assert.deepStrictEqual(texts, []);
});
