#!/usr/bin/env bash
# Prints the GitHub release notes of a version: its CHANGELOG.md sections (from <version> down to,
# not including, <previous published version>, so versions never published as a release are not
# lost), then the downloads table and the quick install guide.
#
#   bash scripts/release-notes.sh 0.3.0 0.1.0
set -euo pipefail

VERSION="${1:?usage: release-notes.sh <version> [<previous published version>]}"
PREVIOUS="${2:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

changes="$(awk -v v="$VERSION" -v p="$PREVIOUS" '
  /^## \[/ {
    s = $0; sub(/^## \[/, "", s); sub(/\].*/, "", s)
    if (s == v) on = 1
    else if (p != "" && s == p) on = 0
    else if (on && p == "") on = 0
    if (on) { sub(/^## /, "### "); print; next }
  }
  /^\[[^]]+\]: / { on = 0 }
  on { if ($0 ~ /^### /) sub(/^### /, "#### "); print }
' "$ROOT/CHANGELOG.md")"
[[ -n "$changes" ]] || { echo "No CHANGELOG.md section for $VERSION" >&2; exit 1; }

cat <<EOF
LinTO Live affiche la vidéo d'une caméra ou d'une carte de capture, avec les sous-titres LinTO en temps réel incrustés, sur un second écran ou un vidéoprojecteur. OBS Studio 32.1.0 est embarqué et invisible.

## Nouveautés

$changes

## Téléchargements

| Système | Fichier |
|---|---|
| macOS, Apple Silicon (M1 et suivants) | \`LinTO-Live-$VERSION-arm64.dmg\` |
| Linux : Ubuntu 24.04+, Debian 13+ (recommandé) | \`LinTO-Live-$VERSION-amd64.deb\` |
| Linux : toute distribution avec Flatpak | \`LinTO-Live-$VERSION-x86_64.flatpak\` |
| Linux : autres distributions x86_64 (glibc ≥ 2.39, ex. Arch) | \`LinTO-Live-$VERSION-x86_64.AppImage\` |

Les sommes de contrôle sont dans \`SHA256SUMS.txt\`.

## Installation rapide

**macOS** : glisser l'app dans Applications. Elle n'est pas notarisée ; au premier lancement, passer par Réglages Système › Confidentialité et sécurité › « Ouvrir quand même », ou lancer :
\`\`\`bash
xattr -dr com.apple.quarantine "/Applications/LinTO Live.app"
\`\`\`

**Linux (Ubuntu, Debian)** : dans un terminal, depuis le dossier du fichier (le \`./\` est nécessaire) :
\`\`\`bash
sudo apt install ./LinTO-Live-$VERSION-amd64.deb
\`\`\`
\`apt\` installe toutes les dépendances : il n'y a rien d'autre à faire.

**Linux (Flatpak)** : le runtime Freedesktop est téléchargé depuis Flathub à l'installation :
\`\`\`bash
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user ./LinTO-Live-$VERSION-x86_64.flatpak
flatpak run ai.linto.live
\`\`\`

**Linux (AppImage)** :
\`\`\`bash
chmod +x LinTO-Live-$VERSION-x86_64.AppImage && ./LinTO-Live-$VERSION-x86_64.AppImage
\`\`\`

Les détails (paquets, utilisation, désinstallation) sont dans le [README](https://github.com/EnjoyBacon7/linto-live#readme).

## Limites connues

- macOS : pas de signature Apple ni de notarisation, pas de version pour Mac Intel.
- Linux : seule Ubuntu 24.04 (X11) a été testée ; les autres distributions sont « au mieux ». L'incrustation des sous-titres demande une accélération graphique qui fonctionne.
EOF
