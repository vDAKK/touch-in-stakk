const $ = (id) => document.getElementById(id);

$('min').onclick = () => window.touch.windowMinimize();
$('max').onclick = () => window.touch.windowToggleMaximize();
$('close').onclick = () => window.touch.windowClose();

async function loadSettingsIntoUI() {
  const s = await window.touch.getSettings();
  $('res-w').value = s.resolution.width;
  $('res-h').value = s.resolution.height;
  $('muted').checked = s.muted;
}

$('save').onclick = async () => {
  await window.touch.setSettings({
    resolution: { width: Number($('res-w').value), height: Number($('res-h').value) },
    muted: $('muted').checked,
  });
  $('status').textContent = 'Réglages enregistrés.';
};

$('play').onclick = async () => {
  $('status').textContent = 'Chargement du client…';
  try {
    const url = await window.touch.getGameUrl();
    const game = $('game');
    game.src = url;
    game.hidden = false;
    $('home').hidden = true;
  } catch (e) {
    $('status').textContent = 'Erreur: ' + e.message;
  }
};

loadSettingsIntoUI();
