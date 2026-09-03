#!/bin/sh
# Touch in STAKK — macOS installer.
#   curl -fsSL https://raw.githubusercontent.com/vDAKK/touch-in-stakk/master/install.sh | sh
# Downloads the latest release for this Mac, installs it in /Applications and
# clears the quarantine flag, so Gatekeeper does not block the unsigned build.
set -eu
REPO="vDAKK/touch-in-stakk"
APP="Touch in STAKK.app"
case "$(uname -m)" in arm64) ARCH=arm64;; *) ARCH=x64;; esac

echo "→ Recherche de la dernière version…"
URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep -o "https://[^\"]*-$ARCH\.dmg" | head -1)
[ -n "$URL" ] || { echo "Aucun .dmg $ARCH trouvé dans la dernière release."; exit 1; }
echo "→ $URL"

TMP=$(mktemp -d); trap 'rm -rf "$TMP"; [ -n "${MNT:-}" ] && hdiutil detach "$MNT" -quiet 2>/dev/null || true' EXIT
curl -fL --progress-bar -o "$TMP/app.dmg" "$URL"

echo "→ Installation…"
MNT=$(hdiutil attach -nobrowse -readonly "$TMP/app.dmg" | awk -F'\t' '/\/Volumes\//{print $NF}' | tail -1)
[ -d "$MNT/$APP" ] || { echo "Image inattendue : $APP introuvable."; exit 1; }
pkill -x "Touch in STAKK" 2>/dev/null || true
rm -rf "/Applications/$APP"
cp -R "$MNT/$APP" /Applications/
hdiutil detach "$MNT" -quiet; MNT=""
xattr -dr com.apple.quarantine "/Applications/$APP" 2>/dev/null || true

echo "✓ Installé dans /Applications. Lancement…"
open "/Applications/$APP"
