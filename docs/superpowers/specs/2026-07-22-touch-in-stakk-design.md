# Touch in STAKK — Design (MVP)

**Date**: 2026-07-22
**Projet**: `Touch in STAKK` (npm name: `touch-in-stakk`, productName: `Touch in STAKK`)
**Emplacement**: `C:\Users\david\Downloads\STAKK Touch` (dossier actuel)
**But**: Launcher desktop minimal pour jouer à Dofus Touch sur PC, en se présentant aux serveurs Ankama comme le client Android officiel. Fonctions basiques : lancer et se connecter à un compte, jouer dans une fenêtre desktop.

## Contexte & mécanisme (rétro-ingénierie de Retouch 1.1.3)

Dofus Touch n'est pas une appli Android à émuler : c'est un jeu HTML5/JS servi par le CDN d'Ankama, embarqué dans un wrapper Android (Cordova) sur mobile. Le client vérifie qu'il tourne dans ce wrapper (plateforme = `android`, bridges natifs présents). Un simple Electron chargeant les fichiers échoue à booter.

Le launcher contourne ça par une **couche proxy + patch + spoofing** :
- **Proxy local** (Express sur `localhost:<port>`) qui récupère les fichiers du client depuis le CDN Ankama et les sert localement.
- **Patchs de compatibilité communautaires** (`zenoxs/lindo-game-base`, manifest récupéré en direct) : injectés dans les fichiers servis pour remplacer les bridges natifs Android et forcer la plateforme à `"android"` (+ `appVersion`/`buildVersion`).
- **Spoofing headers** au niveau session Electron : User-Agent Android rotatif, suppression des en-têtes qui trahissent un navigateur desktop (`sec-ch-ua`, `sec-ch-ua-mobile`, `sec-ch-ua-platform`, `Sec-Fetch-Dest/Mode/Site`, `Referer` sur hosts Ankama).
- **Auth** via popup webview vers `auth.ankama.com` / `haapi.ankama.com`, callback capturé (scheme `dofustouch://` ou retour `?delayed=true`).

Constantes réelles extraites du binaire :
- Origine jeu : `https://dt-proxy-production-login.ankama-games.com/`
- Auth : `https://auth.ankama.com/`, compte : `haapi.ankama.com/json/Ankama/v5/Account/Account`
- CDN static : `static.ankama.com`
- Patch manifest : `https://raw.githubusercontent.com/zenoxs/lindo-game-base/popup/manifest.json`
- Viewport jeu : 1440×800, titlebar 68px, port par défaut 3000
- User-Agents Android rotatifs (SM-G991B/Android 12, Pixel 6/7, Redmi Note 8 Pro, SM-A125U…), suffixe ` DofusTouch Client`
- Patch plateforme (forme) : `..."android"...window._["appVersion"]...window._["buildVersion"]`

## Décision stack

**Electron minimal + patchs live.** Plain Electron (pas de React/TS/build step), UI en HTML/CSS/JS vanilla. Patchs récupérés en direct depuis lindo-game-base à chaque lancement — toujours à jour, maintenance minimale.

## Architecture

```
STAKK Touch/
├── package.json
├── src/
│   ├── main/
│   │   ├── index.js       # entrée: app lifecycle, création fenêtre, câblage IPC
│   │   ├── proxy.js       # serveur Express local: fetch CDN Ankama + sert /game /app
│   │   ├── patcher.js     # fetch game manifest + patch manifest, applique patchs à la volée
│   │   ├── spoof.js       # session.webRequest: UA Android rotatif + strip headers fingerprint
│   │   └── settings.js    # lecture/écriture settings JSON dans userData
│   ├── preload/
│   │   └── index.js       # contextBridge: API sûre renderer↔main (settings, window, jouer)
│   └── renderer/
│       ├── index.html     # UI sombre frameless: bouton Jouer, réglages, titlebar custom
│       ├── style.css
│       └── renderer.js
```

(Le `Retouch-1.1.3-Setup.exe` de référence reste dans le dossier, ignoré par le projet.)

### Rôles des unités

| Unité | Fait quoi | Dépend de |
|---|---|---|
| `main/index.js` | Cycle de vie app, crée la fenêtre frameless, démarre proxy, branche spoof + IPC | proxy, spoof, settings, Electron |
| `proxy.js` | Express local ; proxifie les fichiers jeu depuis le CDN, applique patchs via patcher, expose `/game` et `/app` ; renvoie le port utilisé | patcher, express, cors, axios |
| `patcher.js` | Récupère game manifest + patch manifest ; applique les remplacements (bridges natifs, plateforme `android`) sur les fichiers JS servis | axios |
| `spoof.js` | Pose les règles `session.webRequest.onBeforeSendHeaders` : UA Android rotatif, strip `sec-ch-ua*`/`Sec-Fetch-*`/`Referer` | Electron session |
| `settings.js` | Charge/sauve `{resolution, muted}` en JSON dans `app.getPath('userData')` | fs, path |
| `preload/index.js` | Expose `window.touch` : `getSettings/setSettings`, `windowMinimize/Maximize/Close`, `getGameUrl` | Electron contextBridge/ipcRenderer |
| `renderer/*` | UI : titlebar custom, bouton Jouer (charge le jeu), panneau réglages résolution/son | preload API |

## Flux de données

1. **Démarrage** : `index.js` lance `proxy.js` → Express écoute sur un port libre. `spoof.js` installe les règles headers sur la session par défaut.
2. **Fetch** : `patcher.js` récupère le game manifest (origine Ankama) + patch manifest (lindo-game-base).
3. **UI** : fenêtre frameless charge la page renderer (bouton Jouer + réglages).
4. **Jouer** : clic → renderer navigue (webview) vers `http://localhost:<port>/game/index.html`. Le proxy sert les fichiers patchés.
5. **Auth** : le client ouvre popup vers `auth.ankama.com`/`haapi.ankama.com` ; l'utilisateur saisit SES identifiants Ankama ; callback capturé → session ouverte.
6. **Jeu** : tourne dans la fenêtre desktop, headers spoofés → Ankama voit un client Android légitime.

## Gestion d'erreurs

- Manifest jeu ou patch injoignable → écran d'erreur clair dans le renderer (message + bouton Réessayer), pas de crash silencieux. Logs dans `userData/logs`.
- Port occupé → `proxy.js` choisit un port libre automatiquement.
- Échec auth / body compte illisible → message utilisateur, retour à l'écran d'accueil.

## Tests

- **patcher** : test unitaire — un fichier JS d'entrée connu + manifest patch factice → sortie contient l'injection `"android"` et les bridges attendus (pas de dépendance réseau, manifest mocké).
- **spoof** : test unitaire — objet requête factice → headers `sec-ch-ua*`/`Sec-Fetch-*` retirés, UA remplacé par un UA Android de la liste.
- **settings** : round-trip lecture/écriture dans un dossier temp.
- **proxy** : test d'intégration léger — serveur up, `/game/<fichier>` renvoie du contenu patché (CDN mocké).
- **Smoke manuel** : `npm start`, la fenêtre s'ouvre, bouton Jouer charge le client, écran de login Ankama s'affiche.

## Hors scope MVP (YAGNI)

Auto-updater, multi-comptes/onglets, installeur/packaging (NSIS), tablet mode, obfuscation du code, presets multi-plateforme. Aucune automation/bot/triche — strictement lancer et jouer un compte.

## Avertissement légal

Le launcher fait croire aux serveurs Ankama qu'il est le client Android officiel (comme le projet open-source Lindo). Cet usage **peut violer les CGU de Dofus Touch**. Non affilié à Ankama Games. Usage aux risques de l'utilisateur, avec ses propres identifiants uniquement.
