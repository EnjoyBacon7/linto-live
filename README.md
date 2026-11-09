# LinTO Live

Application de bureau qui affiche en salle (second écran, vidéoprojecteur en HDMI) la vidéo d'une
caméra ou d'une carte de capture avec les **sous-titres LinTO en temps réel** incrustés.

On se connecte à LinTO, on choisit une session, une caméra et un micro, et on clique sur
**Démarrer** : le son part vers LinTO pour la transcription, et une fenêtre de sortie affiche la
vidéo sous-titrée. Tout le travail vidéo est fait par un OBS Studio embarqué et invisible (sa
configuration est séparée de celle d'un OBS déjà installé sur la machine).

Plateformes : **macOS (Apple Silicon)** et **Linux (x86_64)**.

## Installation

Télécharger le fichier correspondant à votre système dans la
[dernière release](https://github.com/EnjoyBacon7/linto-live/releases/latest).

### macOS (Apple Silicon : M1 et suivants)

1. Ouvrir `LinTO-Live-<version>-arm64.dmg` et glisser **LinTO Live** dans **Applications**.
2. L'application n'est pas notarisée par Apple. Au premier lancement, macOS la bloque
   (« impossible de vérifier le développeur » ou « LinTO Live est endommagé »). Au choix :
   - **Réglages Système › Confidentialité et sécurité**, en bas : « Ouvrir quand même » ;
   - ou, dans le Terminal :
     ```bash
     xattr -dr com.apple.quarantine "/Applications/LinTO Live.app"
     ```
3. Au premier démarrage d'un direct, autoriser l'accès à la **caméra** et au **micro**.

Les Mac Intel ne sont pas pris en charge.

### Linux (x86_64)

Un seul fichier **AppImage**, qui contient l'application et son propre OBS Studio 32.1 : rien n'est
installé sur le système.

```bash
chmod +x LinTO-Live-<version>-x86_64.AppImage
./LinTO-Live-<version>-x86_64.AppImage
```

Prérequis : une distribution avec **glibc 2.39 ou plus récente**.

| Distribution | Paquets à installer |
|---|---|
| Ubuntu 24.04+ | `sudo apt install libfuse2t64` |
| Debian 13 (trixie) | `sudo apt install libfuse2t64 libnss3 libxcb-cursor0 libpulse0` |
| Arch Linux | `sudo pacman -S fuse2 nss xcb-util-cursor libpulse` (+ `pipewire-pulse` avec PipeWire) |

Debian 12 et les distributions plus anciennes ne sont **pas** prises en charge (glibc trop
ancienne). Seule Ubuntu 24.04 a été testée ; les autres distributions sont « au mieux ».

Conseils :

- Préférer une **session X11** (« Ubuntu on Xorg » à l'écran de connexion). Sous Wayland, ça
  fonctionne via XWayland, mais le placement de la fenêtre de sortie sur le bon écran n'est pas
  garanti.
- Les sous-titres sont dessinés par un navigateur intégré à OBS, qui a besoin d'une
  **accélération graphique** fonctionnelle (pas de VM sans 3D).
- Si l'application ne démarre pas à cause du bac à sable (sandbox) d'Electron, la lancer avec
  `--no-sandbox`.
- S'il manque une bibliothèque, la liste s'obtient avec :
  ```bash
  ./LinTO-Live-*.AppImage --appimage-extract
  ldd squashfs-root/resources/obs/bin/obs | grep 'not found'
  ```

## Utilisation

1. **Se connecter** : indiquer l'instance LinTO (par défaut `studio.linto.ai`), puis se connecter
   par email / mot de passe ou par SSO. « Se souvenir de moi » garde la session ouverte.
2. **Choisir une session** dans la barre latérale, ou en créer une avec **Nouvelle session…**
   (⌘N / Ctrl+N) : nom, organisation, profil de transcription. Un nom déjà utilisé reprend la
   session existante au lieu d'en créer une deuxième.
3. **Régler** dans le panneau de droite : **caméra** (ou carte de capture), **micro** (c'est ce son
   qui est transcrit), taille des sous-titres, affichage des sous-titres et du filigrane.
   L'aperçu au centre montre l'image de sortie.
4. **Démarrer** (⌘↩ / Ctrl+Entrée) : une **fenêtre de sortie** s'ouvre. La glisser sur l'écran de la
   salle ; clic droit › « Plein écran » pour la passer en plein écran sur cet écran.
   Si elle a été fermée : menu Fenêtre › **Afficher la fenêtre de sortie** (⌘1 / Ctrl+1).
5. **Arrêter** (⌘. / Ctrl+.) coupe la vidéo et l'envoi du son **sans terminer** la session LinTO :
   elle peut être reprise plus tard. **Terminer la session…** (menu Session) la clôt
   définitivement côté LinTO.

La barre d'état en bas indique si LinTO reçoit bien le son. L'icône LinTO Live dans la barre des
menus (macOS) ou la zone de notification (Linux) signale quand un direct est en cours. Quitter
l'application pendant un direct revient à cliquer sur Arrêter.

## Désinstallation

Menu **LinTO Live › Désinstaller LinTO Live…** (macOS) ou **Fichier › Désinstaller LinTO Live…**
(Linux). L'application arrête OBS, supprime toutes ses données (configuration, OBS embarqué et sa
configuration, cookies, cache) et se met à la corbeille.

Données concernées, si besoin de les retirer à la main :

- macOS : `/Applications/LinTO Live.app`, `~/Library/Application Support/LinTO Live`, et les
  entrées `LinTO Live` / `ai.linto.live` de `~/Library/Caches`, `~/Library/Logs`,
  `~/Library/Preferences` et `~/Library/Saved Application State`
- Linux : `~/.config/LinTO Live`, `~/.cache/LinTO Live`, le fichier `.AppImage`

L'OBS personnel éventuellement installé sur la machine n'est jamais touché.

## Développement

Prérequis : Node 22.

```bash
npm ci
npm run dev          # application en mode développement
npm test             # tests unitaires
npm run typecheck
```

Paquets :

- macOS : `npm run fetch:obs:mac` (télécharge l'OBS officiel) puis `npm run dist:mac`
  → `dist/LinTO-Live-<version>-arm64.dmg`
- Linux, depuis n'importe quel hôte Docker : `npm run dist:linux:docker`
  → `dist/LinTO-Live-<version>-x86_64.AppImage`
- Linux, sur Ubuntu 24.04 : voir [`docs/linux-build.md`](docs/linux-build.md)

## OBS Studio

LinTO Live embarque **OBS Studio 32.1.0** (licence GPL-2.0), piloté comme un processus séparé via
obs-websocket. Sur macOS, c'est le binaire officiel non modifié ; sur Linux, il est compilé depuis
les sources avec un petit correctif. Provenance, sources et correctif :
[`resources/obs/SOURCE.md`](resources/obs/SOURCE.md).
