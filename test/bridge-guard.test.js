// The game webview's preload is sandboxed: it cannot require a module of ours,
// so the bridge allowlists live inside src/preload/game.js. These tests read
// them back out of that file and check them against what the hook actually
// emits and handles.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const GAME_JS = fs.readFileSync(path.join(__dirname, '../src/preload/game.js'), 'utf-8');

function listFrom(name) {
  const m = GAME_JS.match(new RegExp('const ' + name + ' = \\[([^\\]]*)\\];'));
  assert.ok(m, 'missing list ' + name + ' in game.js');
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
}

function typesFrom(re) {
  const out = new Set();
  let m;
  while ((m = re.exec(GAME_JS))) out.add(m[1]);
  return out;
}

const HOOK_EVENTS = listFrom('HOOK_EVENTS');
const HOST_COMMANDS = listFrom('HOST_COMMANDS');

// isAllowed is plain, dependency-free source — lift it out and exercise it.
const isAllowed = new Function(
  'list',
  'payload',
  GAME_JS.match(/function isAllowed\([\s\S]*?\n}/)[0] + '\nreturn isAllowed(list, payload);'
);

test('isAllowed accepts a listed type only', () => {
  assert.ok(isAllowed(HOOK_EVENTS, { type: 'my-turn' }));
  assert.ok(!isAllowed(HOOK_EVENTS, { type: 'not-a-real-event' }));
  assert.ok(isAllowed(HOST_COMMANDS, { type: 'travel', x: 1, y: 2 }));
  assert.ok(!isAllowed(HOST_COMMANDS, { type: 'eval-result' }), 'an event is not a command');
});

test('isAllowed rejects anything that is not a typed object', () => {
  for (const bad of [null, undefined, 'my-turn', 42, [], {}, { type: 7 }]) {
    assert.ok(!isAllowed(HOOK_EVENTS, bad), 'should reject ' + JSON.stringify(bad));
  }
});

test('every event the hook emits is on the allowlist', () => {
  const emitted = typesFrom(/emit\(\{\s*type:\s*'([a-z-]+)'/g);
  assert.ok(emitted.size > 20, 'expected to find the hook events, found ' + emitted.size);
  for (const type of emitted) {
    assert.ok(HOOK_EVENTS.includes(type), 'missing from HOOK_EVENTS: ' + type);
  }
});

test('every command the hook handles is on the allowlist', () => {
  const handled = typesFrom(/p\.type === '([a-z-]+)'/g);
  assert.ok(handled.size > 15, 'expected to find the hook commands, found ' + handled.size);
  for (const type of handled) {
    assert.ok(HOST_COMMANDS.includes(type), 'missing from HOST_COMMANDS: ' + type);
  }
});

test('the bridge checks the sender, the token and the type', () => {
  assert.ok(GAME_JS.includes('e.source !== window'), 'expected a same-window check');
  assert.ok(GAME_JS.includes('d.token !== BRIDGE_TOKEN'), 'expected a token check on events');
  assert.ok(GAME_JS.includes('e.data.token !== TOKEN'), 'expected a token check on commands');
  assert.ok(!GAME_JS.includes("postMessage({ __qol: 'cmd', payload }, '*')"), 'no unguarded wildcard relay');
});

test('the sandboxed preload requires nothing but electron', () => {
  const requires = [...GAME_JS.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
  assert.deepStrictEqual([...new Set(requires)], ['electron']);
});
