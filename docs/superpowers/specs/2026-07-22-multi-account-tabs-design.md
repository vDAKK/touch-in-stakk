# Touch in STAKK — Sous-projet 1 : Multi-comptes + sessions persistantes

**Date**: 2026-07-22
**But**: Gérer plusieurs comptes Dofus Touch dans une fenêtre à onglets, chaque compte avec sa session isolée et **persistée** (reconnexion automatique au relancement). Fondation pour les features QoL (sous-projet 2/3).

## Contexte

État actuel : un seul `<webview id="game">` charge le client via le proxy local, spoofing + auth-capture installés sur `session.defaultSession`. Login fonctionne.

Cible : N comptes = N webviews, un par compte, chacun sur une partition Electron **persistante** distincte.

## Principe

- Chaque compte a un id numérique stable et une partition `persist:acct-<id>`.
- Une partition `persist:` stocke cookies + localStorage sur disque (`userData/Partitions/`), donc :
  - sessions **isolées** entre comptes (pas de collision de login),
  - sessions **persistées** : au relancement, le cookie Ankama est encore là → compte déjà connecté / reconnexion rapide.
- Le proxy local reste **unique et partagé** : tous les webviews chargent le même `http://127.0.0.1:<port>/game/index.html` ; l'isolation vient de la partition, pas du serveur.

## Architecture

```
src/main/
├── index.js       # + câblage sessions par partition, IPC comptes
├── accounts.js    # NOUVEAU : CRUD liste de comptes persistée (accounts.json)
├── proxy.js        (inchangé)
├── patcher.js      (inchangé)
├── spoof.js        (inchangé — installSpoofing(session) déjà paramétrable)
└── settings.js     (inchangé)
src/preload/index.js   # + API comptes
src/renderer/
├── index.html     # barre d'onglets + conteneur webviews + menu réglages
├── style.css
└── renderer.js    # gestion onglets/webviews/switch/add/rename/remove
```

### `accounts.js`
Persistance dans `userData/accounts.json`, forme `{ nextId: number, accounts: [{ id: number, name: string }] }`.
- `loadAccounts(userDataDir) -> { nextId, accounts }` (défaut `{ nextId: 1, accounts: [] }`)
- `addAccount(userDataDir, name) -> { id, name }` (attribue `nextId`, incrémente, persiste)
- `renameAccount(userDataDir, id, name) -> account | null`
- `removeAccount(userDataDir, id) -> boolean`
- `partitionFor(id) -> "persist:acct-" + id`

### Refactor sessions (index.js)
Aujourd'hui `installSpoofing`/`blockThirdParty`/`installDiagnostics` visent `session.defaultSession`. Les webviews de compte utilisent des partitions → il faut préparer **chaque** session.
- `prepareSession(sess)` : `installSpoofing(sess)` + `blockThirdParty(sess)` + `installDiagnostics(sess)`.
- `app.on('session-created', prepareSession)` enregistré tôt (couvre chaque partition créée à la volée quand un webview charge).
- Appel explicite `prepareSession(session.defaultSession)` au boot (la defaultSession peut préexister à l'écouteur).
- `blockThirdParty(sess)` et `installDiagnostics(sess)` prennent désormais la session en paramètre.
- L'auth-capture reste par-webContents (`did-create-window` sur chaque webview) — déjà multi-compte car le handler capture le `contents` d'origine et n'injecte que dans celui-là.

### IPC (index.js ↔ preload)
- `accounts:list` → `{ accounts }`
- `accounts:add` (name) → `{ id, name }`
- `accounts:rename` (id, name) → account | null
- `accounts:remove` (id) → boolean
- `game:url`, `settings:*`, `patch:*`, `window:*`, `app:version` : inchangés.

### Renderer
- **Barre d'onglets** : un onglet par compte (nom + bouton ✕), un bouton **+** (ajouter), un bouton **⚙** (réglages).
- **Conteneur webviews** : un `<webview>` par compte, `partition="persist:acct-<id>"`, `allowpopups`, `src` = game url. Seul l'onglet actif est visible (`hidden` sur les autres) ; les webviews cachés **restent vivants** (session maintenue).
- **Ajouter** : bouton + → crée un compte (`accounts:add`, nom par défaut `Compte N`) → nouvel onglet + webview → l'utilisateur se connecte une fois → mémorisé.
- **Renommer** : double-clic sur l'onglet → champ éditable → `accounts:rename`.
- **Supprimer** : ✕ sur l'onglet → confirmation → `accounts:remove` → retire onglet + webview.
- **Réglages** : bouton ⚙ ouvre un panneau overlay (résolution + coupe-son, déplacés depuis l'écran d'accueil actuel). Réglages **globaux** (pas par compte).
- **État vide** : si aucun compte, afficher un message + bouton "Ajouter un compte".
- **Bandeau patchs** (existant) : conservé, au-dessus des onglets.

## Flux de données

1. Boot → renderer : `getSettings`, `accounts:list`.
2. Pour chaque compte sauvegardé → créer onglet + webview (partition persistante) → charge le jeu → session restaurée depuis les cookies persistés.
3. Aucun compte → état vide.
4. Switch d'onglet → affiche le webview correspondant, cache les autres.
5. Fermeture app → les partitions persistent sur disque ; `accounts.json` garde la liste.

## Gestion d'erreurs
- `accounts.json` illisible/corrompu → défaut `{ nextId: 1, accounts: [] }` (pas de crash).
- `game:url` échoue (proxy) → l'onglet affiche l'erreur (réutilise le try/catch existant du chargement webview).
- Suppression d'un compte : retire de la liste ; les données de partition sur disque restent (nettoyage explicite hors scope MVP — noté).

## Tests
- `accounts.js` : unitaires sur dossier temp — défaut sans fichier ; add attribue nextId et incrémente ; rename ; remove ; round-trip persistance ; `partitionFor`.
- `spoof.js`/`blockThirdParty`/`installDiagnostics` : les fonctions prennent une session injectable → test que `prepareSession` appelle bien `onBeforeSendHeaders`/`onBeforeRequest`/`onErrorOccurred` sur la session fournie (session factice mock).
- Renderer/webviews : pas de test auto (runtime Electron/DOM) → smoke manuel : ajouter 2 comptes, se connecter sur chacun, relancer l'app, vérifier reconnexion, switch d'onglet, renommer, supprimer.

## Hors scope (sous-projet suivant)
Features QoL (switch au tour, follow auto, groupe auto, actions groupées), infra de hook in-game, grille multi-vues, réglages par compte, nettoyage disque des partitions supprimées.

## Avertissement
Multi-comptes multibox = même statut CGU que le launcher (usage à risque). Sessions gérées par Chromium par partition ; aucun identifiant stocké par l'app. QoL assistif uniquement (pas de bot autonome).
