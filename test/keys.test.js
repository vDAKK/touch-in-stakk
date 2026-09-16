const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const KEYS = require('../src/shared/keys');

// An AZERTY number row: the same physical keys, different characters.
const AZERTY_1 = { key: '&', code: 'Digit1' };
const QWERTY_1 = { key: '1', code: 'Digit1' };

test('the number row is remembered by position, everything else by character', () => {
  assert.strictEqual(KEYS.bindingForEvent(AZERTY_1), 'code:Digit1');
  assert.strictEqual(KEYS.bindingForEvent(QWERTY_1), 'code:Digit1');
  assert.strictEqual(KEYS.bindingForEvent({ key: '5', code: 'Numpad5' }), 'code:Numpad5');
  assert.strictEqual(KEYS.bindingForEvent({ key: 'i', code: 'KeyI' }), 'i');
  assert.strictEqual(KEYS.bindingForEvent({ key: ' ', code: 'Space' }), ' ');
});

test('a spell bound to a position fires on AZERTY and on QWERTY alike', () => {
  const tables = KEYS.splitBindings({ spell1: 'code:Digit1', inventory: 'i' });
  assert.strictEqual(KEYS.actionForEvent(tables, AZERTY_1), 'spell1');
  assert.strictEqual(KEYS.actionForEvent(tables, QWERTY_1), 'spell1');
  assert.strictEqual(KEYS.actionForEvent(tables, { key: 'i', code: 'KeyI' }), 'inventory');
});

test('a number-row spell answers on the numpad too', () => {
  const tables = KEYS.splitBindings({ spell3: 'code:Digit3' });
  assert.strictEqual(KEYS.actionForEvent(tables, { key: '3', code: 'Numpad3' }), 'spell3');
});

test('an explicit numpad binding is not stolen by the number row', () => {
  const tables = KEYS.splitBindings({ spell3: 'code:Digit3', spell7: 'code:Numpad3' });
  assert.strictEqual(KEYS.actionForEvent(tables, { key: '3', code: 'Numpad3' }), 'spell7');
  assert.strictEqual(KEYS.actionForEvent(tables, { key: '"', code: 'Digit3' }), 'spell3');
});

test('an unbound key triggers nothing', () => {
  const tables = KEYS.splitBindings({ spell1: 'code:Digit1' });
  assert.strictEqual(KEYS.actionForEvent(tables, { key: 'p', code: 'KeyP' }), null);
  assert.strictEqual(KEYS.actionForEvent(tables, { key: '&', code: 'Digit2' }), null);
});

test('a character binding still wins over a position binding', () => {
  // The character the user actually typed is the more specific match.
  const tables = KEYS.splitBindings({ spell1: 'code:Digit1', close: '&' });
  assert.strictEqual(KEYS.actionForEvent(tables, AZERTY_1), 'close');
});

test('Ctrl+1..9 reads the position, whatever the layout prints', () => {
  assert.strictEqual(KEYS.digitOfEvent(AZERTY_1), 1);
  assert.strictEqual(KEYS.digitOfEvent({ key: 'è', code: 'Digit7' }), 7);
  assert.strictEqual(KEYS.digitOfEvent({ key: '4', code: 'Numpad4' }), 4);
  assert.strictEqual(KEYS.digitOfEvent({ key: 'a', code: 'KeyA' }), null);
  // A keyboard that reports no usable code still works through the character.
  assert.strictEqual(KEYS.digitOfEvent({ key: '2', code: '' }), 2);
});

test('the sandboxed game preload matches on the code as well as the key', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/preload/game.js'), 'utf-8');
  assert.ok(src.includes('keyTables.codes[e.code]'), 'expected a position lookup in the key handler');
  assert.ok(src.includes('digitOfEvent(e)'), 'expected Ctrl+digit to read the position');
  assert.ok(!src.includes("e.key >= '1' && e.key <= '9'"), 'the character-only digit test should be gone');
});

test('the spell defaults are bound to positions, not characters', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/renderer/renderer.js'), 'utf-8');
  for (let n = 1; n <= 8; n += 1) {
    assert.ok(
      src.includes("{ id: 'spell" + n + "', key: 'action.spell', keyParams: { n: " + n + " }, defaultKey: 'code:Digit" + n + "' }"),
      'spell' + n + ' should default to its number-row position'
    );
  }
});

test('a spell saved as a digit character is read as its position', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/renderer/renderer.js'), 'utf-8');
  assert.ok(
    src.includes("if (action.id.startsWith('spell') && /^[0-9]$/.test(bound)) return KEYS.codeBinding('Digit' + bound);"),
    'expected the old digit bindings to be migrated on read'
  );
  // The migration itself, on the shared helper it relies on.
  assert.strictEqual(KEYS.codeBinding('Digit4'), 'code:Digit4');
  const tables = KEYS.splitBindings({ spell4: KEYS.codeBinding('Digit4') });
  assert.strictEqual(KEYS.actionForEvent(tables, { key: "'", code: 'Digit4' }), 'spell4');
});
