const { test } = require('node:test');
const assert = require('node:assert');
const { parsePackages, chooseGamePackage, discoverWsa, launchAndroidClient, startWsa, explainAdbError } = require('../src/main/android-launcher');

test('parsePackages extracts Android package names', () => {
  assert.deepStrictEqual(parsePackages('package:com.example.one\r\npackage:com.ankama.dofustouch\n'), ['com.example.one', 'com.ankama.dofustouch']);
});

test('chooseGamePackage prefers a Dofus or Ankama package', () => {
  assert.strictEqual(chooseGamePackage(['com.android.settings', 'com.ankama.dofustouch']), 'com.ankama.dofustouch');
});

test('discoverWsa connects and lists packages', async () => {
  const calls = [];
  const execFile = (_file, args, _options, callback) => {
    calls.push(args);
    callback(null, args[0] === 'connect' ? 'connected to 127.0.0.1:58526' : 'package:com.ankama.dofustouch\n', '');
  };
  const result = await discoverWsa({ adbPath: 'adb.exe', address: '127.0.0.1:58526' }, { execFile, skipBootstrap: true });
  assert.strictEqual(result.gamePackage, 'com.ankama.dofustouch');
  assert.deepStrictEqual(calls, [
    ['connect', '127.0.0.1:58526'],
    ['-s', '127.0.0.1:58526', 'shell', 'pm', 'list', 'packages'],
  ]);
});

test('launchAndroidClient starts the discovered package', async () => {
  const calls = [];
  const execFile = (_file, args, _options, callback) => {
    calls.push(args);
    callback(null, args[0] === 'connect' ? 'already connected to 127.0.0.1:58526' : 'package:com.ankama.dofustouch\n', '');
  };
  const result = await launchAndroidClient({ adbPath: 'adb.exe', address: '127.0.0.1:58526' }, { execFile, skipBootstrap: true });
  assert.strictEqual(result.packageName, 'com.ankama.dofustouch');
  assert.deepStrictEqual(calls[2], ['-s', '127.0.0.1:58526', 'shell', 'monkey', '-p', 'com.ankama.dofustouch', '1']);
});

test('startWsa does not treat Explorer exit status as a launch failure', async () => {
  let call;
  const spawn = (file, args, options) => {
    call = { file, args, options };
    return { unref() {} };
  };
  assert.strictEqual(await startWsa({ spawn }), true);
  assert.strictEqual(call.file, 'explorer.exe');
  assert.ok(call.args[0].includes('WindowsSubsystemForAndroid'));
  assert.strictEqual(call.options.detached, true);
});

test('explains an unauthorized WSA device without exposing raw ADB jargon', () => {
  assert.match(explainAdbError(new Error('adb.exe: device unauthorized')).message, /Ouvre WSA/);
});