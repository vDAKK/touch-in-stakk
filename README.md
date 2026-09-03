# Touch in STAKK

Launcher desktop pour **Dofus Touch** (macOS / Windows), pensé pour le multi-compte.
Il charge le client officiel du jeu dans une fenêtre par compte, se présente aux
serveurs comme une tablette Android, et ajoute par-dessus les outils qui manquent
sur PC : suivi du chef de groupe, jonction automatique des combats, récolte
automatique, déplacement auto sur la carte, raccourcis clavier, diffusion des
touches.

> Non affilié à Ankama Games. Se présenter comme le client Android peut violer les
> CGU de Dofus Touch — usage à tes risques, avec tes propres identifiants uniquement.

## Installation

Télécharge la dernière version dans [Releases](../../releases) :

| Plateforme | Fichier |
|---|---|
| macOS Apple Silicon | `Touch-in-STAKK-<version>-arm64.dmg` |
| macOS Intel | `Touch-in-STAKK-<version>-x64.dmg` |
| Windows (installeur) | `Touch-in-STAKK-Setup-<version>.exe` |
| Windows (portable) | `Touch-in-STAKK-portable-<version>.exe` |

Les builds ne sont pas signés. Sur macOS, au premier lancement : clic droit →
Ouvrir (ou `xattr -dr com.apple.quarantine "/Applications/Touch in STAKK.app"`).
Sur Windows, SmartScreen demandera une confirmation.

L'application se met à jour toute seule : elle surveille les releases GitHub et
propose l'installation quand une nouvelle version est prête.

## Fonctions

### Multi-compte
- **Un onglet par compte**, chaque compte avec sa propre session persistante
  (cookies, connexion mémorisée) et sa propre identité d'appareil.
- **Ctrl+1…9** pour passer d'un compte à l'autre, **Ctrl+Tab** pour cycler.
- **Basculement automatique** sur le compte dont c'est le tour en combat.
- **Grouper** : invite tous les comptes du launcher dans le groupe du compte actif ;
  les invitations entre tes propres comptes sont acceptées automatiquement.
- **Suivre le chef** : les autres comptes rejoignent le chef de groupe — cellule
  voisine sur la même map, saut de map ou trajet complet sinon. Ne touche jamais
  au chef lui-même ni aux comptes en combat.
- **Rejoindre les combats du chef** (réglage) : quand le chef de groupe lance un
  combat, les mules entrent dedans et se mettent « prêt » en même temps que lui.
- **Diffusion des touches** : les raccourcis du compte actif sont rejoués sur tous
  les autres.
- **F2** : tous les comptes « prêt ».
- Son global ou **uniquement sur l'onglet actif**.

### Déplacement automatique
- Sur la carte du monde, clic (ou clic droit) sur une zone → **« Courir ici »**
  dans le menu du jeu. Le personnage voyage jusqu'aux coordonnées.
- Itinéraire calculé par **A\*** sur la carte du monde, avec apprentissage des
  bordures infranchissables et recalcul en cours de route.
- Toute action manuelle (déplacement, clic sur une ressource) **interrompt** le
  trajet en cours, avec une notification dans le jeu.

### Récolte automatique
- Bouton **Récolte** dans la barre : ramasse toutes les ressources que le
  personnage peut exploiter sur la map (niveau de métier et outil pris en compte
  par le jeu lui-même), la plus proche d'abord.
- Optionnel : un **circuit** de coordonnées à parcourir en boucle
  (`stakkHarvest([{x:5,y:-18},{x:5,y:-17}])` depuis la console du launcher).
- Pause automatique en combat, reprise après. Délais variables entre les actions.
- S'arrête dès que tu joues à la main.

### Confort
- Suppression des confirmations de déplacement et de sort (un seul clic).
- Raccourcis clavier configurables pour les fenêtres du jeu (inventaire, sorts,
  carte, quêtes, métiers…) et pour « afficher les entités ».
- Saisie au clavier physique dans les pavés numériques du jeu, Entrée pour
  confirmer les popups.
- Étiquettes des ressources sur la map, masquage du bouton boutique.
- Notifications (tour de combat, message privé, invitation, déconnexion) sur les
  onglets en arrière-plan.
- Les onglets en arrière-plan **continuent de tourner à pleine vitesse** : ni
  Chromium ni le client ne les ralentissent.

### Identité d'appareil
Chaque compte se présente comme **une tablette Android différente et stable**
(User-Agent HTTP, `navigator`, écran, touch, mémoire, cœurs — tous cohérents entre
eux). Un même compte garde le même appareil d'un lancement à l'autre.

## Réglages

Bouton engrenage dans la barre. Résolution (curseur, presets, adaptation à
l'écran, aperçu en direct), son, multi-compte, confort, raccourcis. Sauvegardés
dans `userData/settings.json`. Logs dans `userData/logs/app.log`.

## Console du launcher (avancé)

`Cmd/Ctrl+Alt+I` sur le launcher ouvre sa console. Quelques commandes agissant
sur le compte actif :

```js
stakkTravel(null, 5, -18)                      // voyager vers les coordonnées
stakkTravelCancel()
stakkHarvest()                                 // récolter la map courante
stakkHarvest([{x:5,y:-18},{x:5,y:-17}])        // circuit en boucle
stakkHarvestStop() / stakkHarvestStatus()
stakkEval("navigator.userAgent")               // exécuter du code dans le jeu
```

## Développement

```
npm install
npm start          # depuis un terminal VS Code : env -u ELECTRON_RUN_AS_NODE npm start
npm test
npm run dist:mac   # .dmg + .zip (arm64 + x64)
npm run dist       # installeur NSIS + portable Windows
```

Comment ça marche : un serveur Express local proxifie les fichiers du client
depuis le CDN Ankama et leur applique les patchs de compatibilité communautaires
(`regex.json` de `zenoxs/lindo-game-base`). Chaque compte tourne dans un
`<webview>` Electron avec un preload qui injecte un hook dans le jeu (bus
d'événements `window.gui`, moteur `isoEngine`) — c'est par là que passent le
suivi, la récolte, le trajet et les raccourcis.

| Fichier | Rôle |
|---|---|
| `src/main/index.js` | Cycle de vie, fenêtre, proxy, IPC, mises à jour |
| `src/main/proxy.js` | Proxy CDN + application des patchs |
| `src/main/patcher.js` | Récupération et application des règles regex |
| `src/main/spoof.js` | Profils d'appareil (UA, écran…) par compte |
| `src/main/session-prep.js` | Préparation d'une session de compte |
| `src/main/settings.js` / `accounts.js` | Persistance |
| `src/preload/game.js` | Hook injecté dans le jeu : suivi, combat, récolte, trajet, raccourcis |
| `src/preload/index.js` | Pont IPC `window.touch` |
| `src/renderer/` | Interface du launcher (onglets, barre, réglages) |

## Publier une version

Le workflow GitHub Actions construit macOS et Windows à chaque push sur `master`
(artefacts) et **publie une release** quand un tag `vX.Y.Z` est poussé :

```
npm version minor        # ou patch / major — met à jour package.json et crée le tag
git push && git push --tags
```

Les fichiers de mise à jour (`latest.yml`, `latest-mac.yml`) sont joints à la
release ; l'auto-updater des installations existantes les détecte.
