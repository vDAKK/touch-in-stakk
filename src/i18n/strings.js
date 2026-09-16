// Every user-visible string of the launcher, in French and English.
//
// Three very different consumers read this file, which is why it registers
// itself twice at the bottom: the main process and the preloads require() it,
// while the renderer — no bundler, no node integration — pulls it in with a
// plain <script> tag and reads globalThis.STAKK_I18N.
//
// The two dictionaries must stay key-for-key identical; test/i18n.test.js
// fails the build otherwise, so a forgotten translation never ships.

const FR = {
  // --- Title bar -------------------------------------------------------------
  'title.discord': 'Rejoindre le Discord STAKK',
  'title.discordAria': 'Discord STAKK',
  'win.minimize': 'Réduire',
  'win.maximize': 'Agrandir',
  'win.close': 'Fermer',

  // --- Banners ---------------------------------------------------------------
  'patch.warn': 'Patchs de compatibilité indisponibles — le jeu risque de ne pas démarrer.',
  'patch.retry': 'Réessayer',
  'update.idle': 'Mise à jour disponible.',
  'update.install': 'Redémarrer & installer',
  'update.available': 'Mise à jour {version} disponible — téléchargement…',
  'update.downloading': 'Téléchargement de la mise à jour… {percent}%',
  'update.ready': 'Mise à jour {version} prête.',

  // --- Toolbar ---------------------------------------------------------------
  'bar.addAccount': 'Ajouter un compte',
  'bar.group': 'Grouper : invite tous les comptes dans ton groupe',
  'bar.groupAria': 'Grouper les comptes',
  'bar.stats': 'Gains de la session (XP et kamas)',
  'bar.statsAria': 'Gains de la session',
  'bar.mule': 'Suivre le chef : les autres comptes rejoignent le chef de groupe, même sur une autre map',
  'bar.muleAria': 'Suivre le chef',
  'bar.harvest': "Récolte auto : ramasse les ressources de la map (s'arrête si tu joues)",
  'bar.harvestAria': 'Récolte auto',
  'bar.broadcast': 'Diffusion : les touches de ce compte sont rejouées sur les autres',
  'bar.broadcastAria': 'Diffuser les touches',
  'bar.settings': 'Réglages',

  // --- Empty state / panels --------------------------------------------------
  'empty.title': 'Aucun compte',
  'empty.desc': 'Ajoute un compte Dofus Touch pour commencer à jouer.',
  'empty.add': 'Ajouter un compte',
  'stats.title': 'Gains de la session',
  'stats.empty': 'Aucun compte.',
  'stats.xp': 'XP',
  'stats.kamas': 'K',
  'common.close': 'Fermer',
  'account.fallback': 'Compte',
  'account.remove': 'Supprimer le compte « {name} » ?',

  // --- Settings: window ------------------------------------------------------
  'settings.title': 'Réglages',
  'settings.sub': "Réglages du launcher, ou d'un compte en particulier",
  'settings.scope.label': 'Régler',
  'settings.scope.global': 'Tous les comptes',
  'settings.scope.custom': 'Réglages propres à ce compte',
  'settings.scope.inherited': 'Ce compte suit les réglages de tous les comptes.',
  'settings.window': 'Fenêtre',
  'field.lang.label': 'Langue',
  'field.lang.desc': "Interface du launcher et messages affichés dans le jeu",
  'lang.auto': 'Automatique',
  'lang.fr': 'Français',
  'lang.en': 'English',
  'field.size.label': 'Taille de la fenêtre',
  'field.size.desc': "La fenêtre s'ouvre à la taille de l'écran par défaut ; le jeu s'adapte à la zone disponible",
  'aria.width': 'Largeur',
  'aria.height': 'Hauteur',
  'aria.windowSize': 'Taille de la fenêtre',
  'res.full': 'Pleine largeur',
  'res.percent': "{pct} % de l'écran",
  'preset.compact': 'Compact',
  'preset.default': 'Défaut',
  'preset.large': 'Large',
  'preset.xl': 'XL',
  'preset.screen': 'Écran',
  'field.tabside.label': 'Onglets sur le côté',
  'field.tabside.desc': "Barre verticale à gauche au lieu d'en haut",
  'field.muted.label': 'Couper le son',
  'field.muted.desc': "Tous les comptes, y compris l'onglet actif",
  'field.muteInactive.label': "Son uniquement sur l'onglet actif",
  'field.muteInactive.desc': 'Les comptes en arrière-plan sont muets, celui affiché garde le son',

  // --- Settings: multi-account ----------------------------------------------
  'settings.multi': 'Multi-compte',
  'field.switchTurn.label': "Basculer sur le compte dont c'est le tour",
  'field.switchTurn.desc': "En combat, l'onglet change tout seul quand un compte doit jouer",
  'field.joinFight.label': 'Rejoindre les combats du chef',
  'field.joinFight.desc': 'Quand le chef de groupe lance un combat, les autres comptes entrent dedans et se mettent prêts en même temps que lui',
  'field.acceptGroup.label': 'Accepter les invitations de groupe',
  'field.acceptGroup.desc': 'Uniquement celles envoyées par un autre compte de ce launcher',
  'field.acceptOwn.label': 'Accepter échanges et défis entre tes comptes',
  'field.acceptOwn.desc': "Uniquement quand la demande vient d'un de tes autres onglets",

  // --- Settings: comfort -----------------------------------------------------
  'settings.comfort': 'Confort de jeu',
  'field.noConfirm.label': 'Sans confirmation',
  'field.noConfirm.desc': 'Un seul clic pour se déplacer ou lancer un sort',
  'field.resources.label': 'Étiquettes des ressources',
  'field.resources.desc': 'Nom des ressources récoltables affiché sur la map',
  'field.hideShop.label': 'Masquer le bouton boutique',
  'field.notifications.label': 'Notifications sonores',
  'field.notifications.desc': 'Tour de combat, message privé, déconnexion, sur un onglet inactif',

  // --- Settings: shortcuts ---------------------------------------------------
  'settings.keys': 'Raccourcis clavier',
  'settings.keysSub': '— compte actif',
  'settings.launcherKeys': 'Raccourcis du launcher',
  'sc.switch': "Passer d'un compte à l'autre",
  'sc.cycle': 'Compte suivant / précédent',
  'sc.ready': 'Tous les comptes « prêt »',
  'sc.fullscreen': 'Plein écran',
  'key.space': 'Espace',
  'key.numpad': 'Pavé num. {n}',
  'key.escape': 'Échap',

  // --- Settings: advanced / actions -----------------------------------------
  'settings.advanced': 'Avancé',
  'field.devtools.label': 'Console du jeu',
  'field.devtools.desc': "DevTools de l'onglet actif, pour le diagnostic",
  'field.devtools.open': 'Ouvrir',
  'settings.cancel': 'Annuler',
  'settings.save': 'Enregistrer',

  // --- Keybindable in-game actions ------------------------------------------
  'action.inventory': 'Inventaire',
  'action.character': 'Caractéristiques',
  'action.spells': 'Sorts',
  'action.quests': 'Quêtes',
  'action.jobs': 'Métiers',
  'action.bestiary': 'Bestiaire',
  'action.achievements': 'Succès',
  'action.map': 'Carte',
  'action.social': 'Amis',
  'action.guild': 'Guilde',
  'action.alliance': 'Alliance',
  'action.market': 'Hôtel de vente',
  'action.koliseum': 'Koliseum',
  'action.dailyQuest': 'Quêtes du jour',
  'action.groupSeeker': 'Recherche de groupe',
  'action.toa': 'Temple (TOA)',
  'action.titles': 'Titres / Ornements',
  'action.zaap': 'Zaap / Téléportation',
  'action.goultines': 'Boutique (goultines)',
  'action.options': 'Options',
  'action.mount': 'Monture',
  'action.directory': 'Annuaire',
  'action.conquest': 'Conquête (AvA)',
  'action.alignment': 'Alignement',
  'action.spouse': 'Conjoint',
  'action.entities': 'Afficher les entités',
  'action.passTurn': 'Passer le tour',
  'action.close': 'Fermer les interfaces',
  'action.spell': 'Sort {n}',

  // --- Desktop notifications -------------------------------------------------
  'notify.whisper': 'Message privé de {from}',
  'notify.partyInvite': 'Invitation de groupe de {from}',
  'notify.challenge': 'Défi en combat de {from}',
  'notify.travelStart': 'Voyage vers {x},{y}',
  'notify.arrived': 'Arrivé à destination',
  'notify.travelStopped': 'Voyage interrompu ({reason}){where}',
  'notify.travelAt': ' à {x},{y}',
  'notify.interrupted': '{what} interrompu (action manuelle)',
  'notify.harvestStopped': 'Récolte arrêtée ({n})',
  'notify.disconnected': 'Déconnecté du jeu',

  // --- Pastilles d'état sur les onglets --------------------------------------
  'tab.state.turn': "C'est à ce compte de jouer",
  'tab.state.fight': 'En combat',
  'tab.state.travel': 'Trajet en cours',
  'tab.state.harvest': 'Récolte en cours',
  'tab.state.offline': 'Pas connecté au jeu',
  'group.notInGame': "Grouper : ce compte n'est pas encore en jeu",
  'group.noOthers': 'Grouper : aucun autre compte en jeu',

  // --- Messages drawn inside the game (injected hook) ------------------------
  'game.runHere': 'Courir ici',
  'game.travelStopped': 'Voyage interrompu',
  'game.fightPause': 'Combat — récolte en pause',
  'game.harvestDone': 'Récolte terminée — {n} ressource(s)',
  'game.joinedLeaderFight': 'Rejoint le combat du chef',
  'game.joiningLeaderFight': 'Rejoint le combat du chef…',
  'game.harvestOn': 'Récolte auto activée',
  'game.harvestCircuit': ' — circuit de {n} points',
  'game.interrupted': '{what} interrompu (action manuelle)',
  'game.harvest': 'récolte',
  'game.travel': 'trajet',
};

const EN = {
  // --- Title bar -------------------------------------------------------------
  'title.discord': 'Join the STAKK Discord',
  'title.discordAria': 'STAKK Discord',
  'win.minimize': 'Minimise',
  'win.maximize': 'Maximise',
  'win.close': 'Close',

  // --- Banners ---------------------------------------------------------------
  'patch.warn': 'Compatibility patches unavailable — the game may fail to start.',
  'patch.retry': 'Retry',
  'update.idle': 'Update available.',
  'update.install': 'Restart & install',
  'update.available': 'Update {version} available — downloading…',
  'update.downloading': 'Downloading update… {percent}%',
  'update.ready': 'Update {version} ready.',

  // --- Toolbar ---------------------------------------------------------------
  'bar.addAccount': 'Add an account',
  'bar.group': 'Party up: invite every account into your party',
  'bar.groupAria': 'Party up',
  'bar.stats': 'Session gains (XP and kamas)',
  'bar.statsAria': 'Session gains',
  'bar.mule': 'Follow the leader: the other accounts join the party leader, across maps too',
  'bar.muleAria': 'Follow the leader',
  'bar.harvest': 'Auto-harvest: gathers the resources on the map (stops as soon as you play)',
  'bar.harvestAria': 'Auto-harvest',
  'bar.broadcast': 'Broadcast: this account’s keys are replayed on the others',
  'bar.broadcastAria': 'Broadcast keys',
  'bar.settings': 'Settings',

  // --- Empty state / panels --------------------------------------------------
  'empty.title': 'No account',
  'empty.desc': 'Add a Dofus Touch account to start playing.',
  'empty.add': 'Add an account',
  'stats.title': 'Session gains',
  'stats.empty': 'No account.',
  'stats.xp': 'XP',
  'stats.kamas': 'K',
  'common.close': 'Close',
  'account.fallback': 'Account',
  'account.remove': 'Remove the account “{name}”?',

  // --- Settings: window ------------------------------------------------------
  'settings.title': 'Settings',
  'settings.sub': "Launcher settings, or one account's",
  'settings.scope.label': 'Editing',
  'settings.scope.global': 'Every account',
  'settings.scope.custom': 'Settings of its own for this account',
  'settings.scope.inherited': 'This account follows the every-account settings.',
  'settings.window': 'Window',
  'field.lang.label': 'Language',
  'field.lang.desc': 'Launcher interface and the messages shown inside the game',
  'lang.auto': 'Automatic',
  'lang.fr': 'Français',
  'lang.en': 'English',
  'field.size.label': 'Window size',
  'field.size.desc': 'The window opens at screen size by default; the game fits the space available',
  'aria.width': 'Width',
  'aria.height': 'Height',
  'aria.windowSize': 'Window size',
  'res.full': 'Full width',
  'res.percent': '{pct}% of the screen',
  'preset.compact': 'Compact',
  'preset.default': 'Default',
  'preset.large': 'Large',
  'preset.xl': 'XL',
  'preset.screen': 'Screen',
  'field.tabside.label': 'Tabs on the side',
  'field.tabside.desc': 'Vertical bar on the left instead of along the top',
  'field.muted.label': 'Mute sound',
  'field.muted.desc': 'Every account, the active tab included',
  'field.muteInactive.label': 'Sound on the active tab only',
  'field.muteInactive.desc': 'Background accounts are muted, the one on screen keeps its sound',

  // --- Settings: multi-account ----------------------------------------------
  'settings.multi': 'Multi-account',
  'field.switchTurn.label': 'Switch to the account whose turn it is',
  'field.switchTurn.desc': 'In combat, the tab changes by itself when an account has to play',
  'field.joinFight.label': 'Join the leader’s fights',
  'field.joinFight.desc': 'When the party leader starts a fight, the other accounts join it and ready up alongside them',
  'field.acceptGroup.label': 'Accept party invitations',
  'field.acceptGroup.desc': 'Only those sent by another account of this launcher',
  'field.acceptOwn.label': 'Accept trades and duels between your accounts',
  'field.acceptOwn.desc': 'Only when the request comes from one of your other tabs',

  // --- Settings: comfort -----------------------------------------------------
  'settings.comfort': 'Playing comfort',
  'field.noConfirm.label': 'No confirmation',
  'field.noConfirm.desc': 'A single click to move or cast a spell',
  'field.resources.label': 'Resource labels',
  'field.resources.desc': 'Name of the harvestable resources shown on the map',
  'field.hideShop.label': 'Hide the shop button',
  'field.notifications.label': 'Sound notifications',
  'field.notifications.desc': 'Combat turn, private message, disconnection, on an inactive tab',

  // --- Settings: shortcuts ---------------------------------------------------
  'settings.keys': 'Keyboard shortcuts',
  'settings.keysSub': '— active account',
  'settings.launcherKeys': 'Launcher shortcuts',
  'sc.switch': 'Switch between accounts',
  'sc.cycle': 'Next / previous account',
  'sc.ready': 'Ready up every account',
  'sc.fullscreen': 'Full screen',
  'key.space': 'Space',
  'key.numpad': 'Numpad {n}',
  'key.escape': 'Esc',

  // --- Settings: advanced / actions -----------------------------------------
  'settings.advanced': 'Advanced',
  'field.devtools.label': 'Game console',
  'field.devtools.desc': 'DevTools of the active tab, for diagnostics',
  'field.devtools.open': 'Open',
  'settings.cancel': 'Cancel',
  'settings.save': 'Save',

  // --- Keybindable in-game actions ------------------------------------------
  'action.inventory': 'Inventory',
  'action.character': 'Characteristics',
  'action.spells': 'Spells',
  'action.quests': 'Quests',
  'action.jobs': 'Professions',
  'action.bestiary': 'Bestiary',
  'action.achievements': 'Achievements',
  'action.map': 'Map',
  'action.social': 'Friends',
  'action.guild': 'Guild',
  'action.alliance': 'Alliance',
  'action.market': 'Auction house',
  'action.koliseum': 'Kolossium',
  'action.dailyQuest': 'Daily quests',
  'action.groupSeeker': 'Party finder',
  'action.toa': 'Temple (TOA)',
  'action.titles': 'Titles / Ornaments',
  'action.zaap': 'Zaap / Teleport',
  'action.goultines': 'Shop (goultines)',
  'action.options': 'Options',
  'action.mount': 'Mount',
  'action.directory': 'Directory',
  'action.conquest': 'Conquest (AvA)',
  'action.alignment': 'Alignment',
  'action.spouse': 'Spouse',
  'action.entities': 'Show entities',
  'action.passTurn': 'End turn',
  'action.close': 'Close interfaces',
  'action.spell': 'Spell {n}',

  // --- Desktop notifications -------------------------------------------------
  'notify.whisper': 'Private message from {from}',
  'notify.partyInvite': 'Party invitation from {from}',
  'notify.challenge': 'Duel challenge from {from}',
  'notify.travelStart': 'Travelling to {x},{y}',
  'notify.arrived': 'Arrived at destination',
  'notify.travelStopped': 'Travel stopped ({reason}){where}',
  'notify.travelAt': ' at {x},{y}',
  'notify.interrupted': '{what} stopped (manual action)',
  'notify.harvestStopped': 'Harvest stopped ({n})',
  'notify.disconnected': 'Disconnected from the game',

  // --- Tab state badges ------------------------------------------------------
  'tab.state.turn': "This account's turn to play",
  'tab.state.fight': 'In a fight',
  'tab.state.travel': 'Travelling',
  'tab.state.harvest': 'Harvesting',
  'tab.state.offline': 'Not logged in',
  'group.notInGame': 'Party up: this account is not in game yet',
  'group.noOthers': 'Party up: no other account in game',

  // --- Messages drawn inside the game (injected hook) ------------------------
  'game.runHere': 'Run here',
  'game.travelStopped': 'Travel stopped',
  'game.fightPause': 'Combat — harvest paused',
  'game.harvestDone': 'Harvest finished — {n} resource(s)',
  'game.joinedLeaderFight': 'Joined the leader’s fight',
  'game.joiningLeaderFight': 'Joining the leader’s fight…',
  'game.harvestOn': 'Auto-harvest on',
  'game.harvestCircuit': ' — circuit of {n} points',
  'game.interrupted': '{what} stopped (manual action)',
  'game.harvest': 'harvest',
  'game.travel': 'travel',
};

const LANGS = ['fr', 'en'];
const DICTS = { fr: FR, en: EN };
// Number grouping follows the interface language, not the machine's.
const LOCALES = { fr: 'fr-FR', en: 'en-GB' };

// The saved choice wins; without one, a French machine gets French and
// everything else English.
function resolveLang(saved, osLocale) {
  if (saved && LANGS.includes(saved)) return saved;
  return String(osLocale || '').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

// An unknown key shows as the key itself: a visible gap is easier to spot and
// report than a silently blank label.
function translate(lang, key, params) {
  const dict = DICTS[lang] || EN;
  let out = dict[key] != null ? dict[key] : (EN[key] != null ? EN[key] : key);
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      out = out.split('{' + name + '}').join(String(value));
    }
  }
  return out;
}

// The in-game hook is injected as source text into the page, so it cannot
// require this file: it receives its own strings as a plain object instead.
function gameStrings(lang) {
  const out = {};
  for (const key of Object.keys(DICTS.en)) {
    if (key.startsWith('game.')) out[key.slice(5)] = translate(lang, key);
  }
  return out;
}

const API = { LANGS, DICTS, LOCALES, resolveLang, translate, gameStrings };

if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof globalThis !== 'undefined') globalThis.STAKK_I18N = API;
