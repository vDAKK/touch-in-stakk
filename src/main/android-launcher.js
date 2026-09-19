const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');

const DEFAULT_WSA_ADDRESS = '127.0.0.1:58526';
const DEFAULT_ADB_EXECUTABLE = 'adb.exe';
const PACKAGE_HINTS = ['dofus', 'ankama'];
const PLATFORM_TOOLS_URL = 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip';
const WSA_APP_ID = 'MicrosoftCorporationII.WindowsSubsystemForAndroid_8wekyb3d8bbwe!App';

function runAdb(args, options = {}) {
  const execute = options.execFile || execFile;
  return new Promise((resolve, reject) => {
    execute(options.adbPath || DEFAULT_ADB_EXECUTABLE, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout || '';
        error.stderr = stderr || '';
        reject(explainAdbError(error));
        return;
      }
      resolve({ stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        downloadFile(response.headers.location, destination).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error('Téléchargement ADB impossible (HTTP ' + response.statusCode + ')'));
        return;
      }
      const output = fs.createWriteStream(destination);
      response.pipe(output);
      output.on('finish', () => output.close(resolve));
      output.on('error', reject);
    });
    request.on('error', reject);
  });
}

async function ensureAdb(config, options = {}) {
  const configured = String(config.adbPath || '').trim();
  if (options.skipBootstrap) return configured || DEFAULT_ADB_EXECUTABLE;
  if (configured && configured.toLowerCase() !== DEFAULT_ADB_EXECUTABLE) return configured;
  const root = options.toolsDir || path.join(options.userDataDir || process.cwd(), 'tools');
  const adbPath = path.join(root, 'platform-tools', 'adb.exe');
  try {
    await fsp.access(adbPath, fs.constants.X_OK);
    return adbPath;
  } catch {}
  await fsp.mkdir(root, { recursive: true });
  const archive = path.join(root, 'platform-tools.zip');
  await downloadFile(options.platformToolsUrl || PLATFORM_TOOLS_URL, archive);
  await new Promise((resolve, reject) => {
    const extract = options.execFile || execFile;
    extract('tar.exe', ['-xf', archive, '-C', root], { windowsHide: true }, (error, _stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message || 'Extraction ADB impossible').trim()));
      else resolve();
    });
  });
  return adbPath;
}

async function startWsa(options = {}) {
  const launch = options.spawn || spawn;
  const child = launch('explorer.exe', ['shell:AppsFolder\\' + (options.wsaAppId || WSA_APP_ID)], {
    windowsHide: true,
    detached: true,
    stdio: 'ignore',
  });
  if (child && typeof child.unref === 'function') child.unref();
  return true;
}

function parsePackages(stdout) {
  return String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^package:/, ''))
    .filter(Boolean);
}

function chooseGamePackage(packages) {
  return packages.find((name) => PACKAGE_HINTS.some((hint) => name.toLowerCase().includes(hint))) || null;
}

function validateAndroidConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('Configuration Android absente');
  if (!String(config.adbPath || '').trim()) throw new Error('Chemin ADB absent');
  if (!String(config.address || '').trim()) throw new Error('Adresse WSA absente');
}

function explainAdbError(error) {
  const detail = String((error && (error.stderr || error.stdout)) || error && error.message || '').trim();
  if (/unauthorized|failed to authenticate|ADB_VENDOR_KEYS/i.test(detail)) {
    return new Error('WSA refuse la clé ADB. Ouvre WSA, active le débogage développeur et accepte la demande « Autoriser le débogage USB », puis relance.');
  }
  return error;
}

async function connectWsa(config, options = {}) {
  validateAndroidConfig(config);
  const adbPath = await ensureAdb(config, options);
  const result = await runAdb(['connect', String(config.address).trim()], { ...options, adbPath });
  const output = (result.stdout + result.stderr).trim();
  if (/unauthorized|failed to authenticate|ADB_VENDOR_KEYS/i.test(output)) throw explainAdbError(new Error(output));
  if (!/connected|already connected/i.test(output)) throw new Error(output || 'Connexion ADB à WSA impossible');
  return output;
}

async function connectWsaWithRetry(config, options = {}) {
  const attempts = options.connectAttempts || 10;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await connectWsa(config, options);
    } catch (error) {
      if (/WSA refuse la clé ADB/i.test(error.message || '')) throw error;
      lastError = error;
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs == null ? 1000 : options.retryDelayMs));
    }
  }
  throw lastError;
}

async function discoverWsa(config, options = {}) {
  validateAndroidConfig(config);
  let adbPath;
  try {
    adbPath = await ensureAdb(config, options);
    await connectWsa({ ...config, adbPath }, options);
  } catch (error) {
    if (options.startWsa !== false && !/WSA refuse la clé ADB/i.test(error.message || '')) {
      await startWsa(options);
      adbPath = await ensureAdb(config, options);
      await connectWsaWithRetry({ ...config, adbPath }, options);
    } else throw error;
  }
  const result = await runAdb(['-s', config.address, 'shell', 'pm', 'list', 'packages'], { ...options, adbPath });
  const packages = parsePackages(result.stdout);
  return { address: config.address, packages, gamePackage: chooseGamePackage(packages) };
}

async function launchAndroidClient(config, options = {}) {
  const found = await discoverWsa(config, options);
  const packageName = config.packageName || found.gamePackage;
  if (!packageName) throw new Error('Package Dofus Touch introuvable dans WSA');
  const adbPath = await ensureAdb(config, options);
  await runAdb(['-s', config.address, 'shell', 'monkey', '-p', packageName, '1'], { ...options, adbPath });
  return { address: config.address, packageName };
}

module.exports = {
  DEFAULT_WSA_ADDRESS,
  DEFAULT_ADB_EXECUTABLE,
  PLATFORM_TOOLS_URL,
  parsePackages,
  chooseGamePackage,
  runAdb,
  connectWsa,
  connectWsaWithRetry,
  discoverWsa,
  launchAndroidClient,
  validateAndroidConfig,
  explainAdbError,
  ensureAdb,
  startWsa,
};