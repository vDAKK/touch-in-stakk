const $ = (id) => document.getElementById(id);

$('min').onclick = () => window.touch.windowMinimize();
$('max').onclick = () => window.touch.windowToggleMaximize();
$('close').onclick = () => window.touch.windowClose();

let currentMuted = false;

async function loadSettingsIntoUI() {
  const s = await window.touch.getSettings();
  $('res-w').value = s.resolution.width;
  $('res-h').value = s.resolution.height;
  $('muted').checked = s.muted;
  currentMuted = s.muted;
}

function applyMuteToGame() {
  const game = $('game');
  if (game && typeof game.setAudioMuted === 'function') game.setAudioMuted(currentMuted);
}

async function refreshPatchStatus() {
  const ok = await window.touch.getPatchStatus();
  $('patch-warn').hidden = ok;
}

$('retry').onclick = async () => {
  $('retry').disabled = true;
  $('status').textContent = 'Nouvelle tentative…';
  const ok = await window.touch.retryPatch();
  $('patch-warn').hidden = ok;
  $('status').textContent = ok ? 'Patchs chargés.' : 'Échec — vérifie ta connexion.';
  $('retry').disabled = false;
};

$('save').onclick = async () => {
  currentMuted = $('muted').checked;
  await window.touch.setSettings({
    resolution: { width: Number($('res-w').value), height: Number($('res-h').value) },
    muted: currentMuted,
  });
  applyMuteToGame();
  $('status').textContent = 'Réglages enregistrés.';
};

$('play').onclick = async () => {
  $('status').textContent = 'Chargement du client…';
  try {
    const url = await window.touch.getGameUrl();
    const game = $('game');
    game.addEventListener('dom-ready', applyMuteToGame, { once: true });
    game.src = url;
    game.hidden = false;
    $('home').hidden = true;
  } catch (e) {
    $('status').textContent = 'Erreur: ' + e.message;
  }
};

loadSettingsIntoUI();
refreshPatchStatus();
