# Touch in STAKK

Launcher desktop minimal pour jouer à **Dofus Touch** sur PC, sans émulateur.
Reimplémentation propre du pattern Lindo : proxy local + patchs de compatibilité
communautaires + spoofing d'en-têtes pour se présenter comme le client Android officiel.

## Lancer

```
npm install
npm start
```

Clique **Jouer** → l'écran de connexion Ankama officiel s'affiche → connecte-toi
avec **tes** identifiants Ankama.

## Comment ça marche

1. Un serveur Express local proxifie les fichiers du client Dofus Touch depuis le
   CDN Ankama (`src/main/proxy.js`).
2. Les patchs de compatibilité (`regex.json` de `zenoxs/lindo-game-base`) sont
   récupérés en direct et appliqués aux fichiers `.js` du jeu — dont l'injection
   qui force la plateforme à `android` (`src/main/patcher.js`).
3. La session Electron réécrit les en-têtes HTTP : User-Agent Android rotatif,
   suppression des en-têtes qui trahissent un desktop (`src/main/spoof.js`).
4. Une fenêtre frameless charge le client patché servi en local (`src/main/index.js`).

## Réglages

Résolution (largeur/hauteur) et coupe-son, persistés dans
`app.getPath('userData')/settings.json`. Logs d'erreur dans `userData/logs/app.log`.

## Tests

```
npm test
```

## Structure

| Fichier | Rôle |
|---|---|
| `src/main/index.js` | App lifecycle, fenêtre, démarrage proxy, IPC |
| `src/main/proxy.js` | Serveur local : proxy CDN Ankama + application des patchs |
| `src/main/patcher.js` | Fetch `regex.json` lindo + application des règles regex |
| `src/main/spoof.js` | Réécriture des en-têtes (UA Android, strip fingerprint) |
| `src/main/settings.js` | Réglages persistés |
| `src/preload/index.js` | Pont IPC `window.touch` |
| `src/renderer/` | UI sombre frameless |

## Avertissement

Se présente aux serveurs Ankama comme le client Android officiel — **peut violer
les CGU de Dofus Touch** (comme Lindo). Non affilié à Ankama Games. Usage à tes
propres risques, avec tes propres identifiants uniquement.
