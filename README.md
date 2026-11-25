# LinTO Live

Application de bureau qui affiche en salle (second écran, vidéoprojecteur en HDMI) la vidéo d'une
caméra ou d'une carte de capture avec les **sous-titres LinTO en temps réel** incrustés.

Sans caméra, c'est aussi un simple client LinTO : on envoie le son d'un micro et on lit la
transcription qui défile, avec son historique, dans la fenêtre principale.

On se connecte à LinTO, on choisit une session, une caméra et un micro, et on clique sur
**Démarrer** : le son part vers LinTO pour la transcription, et la fenêtre de sortie (à ouvrir sur
le second écran) affiche la vidéo sous-titrée. Tout le travail vidéo est fait par un OBS Studio embarqué et invisible (sa
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

L'application embarque son propre OBS Studio 32.1. Les trois paquets fonctionnent sur
**Ubuntu 24.04 et suivantes** sans rien installer à côté : le `.deb` (recommandé), le Flatpak et
l'AppImage. Le `.deb` et l'AppImage demandent **glibc 2.39 ou plus récente** (Ubuntu 24.04+,
Debian 13+) ; sur les distributions plus anciennes, dont **Ubuntu 22.04**, utiliser le **Flatpak**,
qui apporte ses propres bibliothèques. Testés : Ubuntu 24.04 et 26.04 ; le Flatpak est aussi
installé et vérifié sur Ubuntu 22.04 par la CI ; les autres distributions sont « au mieux ».

**Ubuntu 24.04+ / Debian 13+ : paquet `.deb` (recommandé)**

Dans un terminal, depuis le dossier du fichier téléchargé :

```bash
sudo apt install ./LinTO-Live-<version>-amd64.deb
```

(Le `./` est nécessaire.) Sans terminal : clic droit sur le fichier › « Ouvrir avec » ›
**App Center** ou **GDebi** (`sudo apt install gdebi`). Un simple double-clic ouvre souvent le
`.deb` dans le gestionnaire d'archives au lieu de l'installer.

`apt` installe en même temps tout ce dont l'application a besoin : rien d'autre à faire.
LinTO Live apparaît ensuite dans le menu des applications.

**Flatpak : Ubuntu 22.04+ et toute distribution avec Flatpak**

Sur Ubuntu, installer d'abord Flatpak s'il n'y est pas : `sudo apt install flatpak`. Le runtime Freedesktop
est téléchargé depuis Flathub à l'installation :

```bash
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user ./LinTO-Live-<version>-x86_64.flatpak
flatpak run ai.linto.live
```

Le Flatpak a le droit de lancer des commandes sur le système (`org.freedesktop.Flatpak`), utilisé
uniquement pour vérifier et charger le module `v4l2loopback` de la caméra virtuelle : il n'est donc
pas isolé du système comme un Flatpak ordinaire.

**AppImage : Ubuntu 24.04+ et autres distributions (Arch…)**

Un seul fichier, rien n'est installé sur le système. Il n'a pas besoin de `libfuse2` (absente
d'Ubuntu depuis la 24.04) : il se monte avec `fusermount3` (paquet `fuse3`, présent sur Ubuntu),
ou à défaut s'extrait dans un dossier temporaire.

```bash
chmod +x LinTO-Live-<version>-x86_64.AppImage
./LinTO-Live-<version>-x86_64.AppImage
```

Paquets nécessaires selon la distribution :

| Distribution | Paquets à installer |
|---|---|
| Ubuntu 24.04+ (bureau) | aucun |
| Debian 13 (trixie) | `sudo apt install libnss3 libxcb-cursor0 libpulse0` |
| Arch Linux | `sudo pacman -S nss xcb-util-cursor libpulse` (+ `pipewire-pulse` avec PipeWire) |

Conseils :

- Au premier lancement, si le système n'a pas tout ce que le direct ou certaines fonctions
  demandent (serveur X / XWayland pour OBS, serveur de son PulseAudio ou `pipewire-pulse` pour le
  micro, accélération graphique pour les sous-titres, trousseau de clés pour retenir la connexion,
  `v4l2loopback` pour la caméra virtuelle, zone de notification), une page le signale et indique
  quoi installer.
- Avec une carte **NVIDIA** (pilote propriétaire), l'enregistrement et la diffusion en ligne sont
  encodés par la carte graphique (NVENC) ; sinon par le processeur (x264).
- Préférer une **session X11** (« Ubuntu on Xorg » à l'écran de connexion). Sous Wayland, ça
  fonctionne via XWayland, mais le placement de la fenêtre de sortie sur le bon écran n'est pas
  garanti.
- Les sous-titres sont dessinés par un navigateur intégré à OBS, qui a besoin d'une
  **accélération graphique** fonctionnelle (pas de VM sans 3D).
- AppImage : quand le système interdit les espaces de noms utilisateur (Ubuntu 24.04+, AppArmor),
  l'AppImage démarre Electron sans son bac à sable (sandbox) ; le `.deb` et le Flatpak gardent le
  leur.
- S'il manque une bibliothèque (AppImage), la liste s'obtient avec :
  ```bash
  ./LinTO-Live-*.AppImage --appimage-extract
  ldd squashfs-root/resources/obs/bin/obs | grep 'not found'
  ```

## Utilisation

1. **Se connecter** : indiquer l'instance LinTO (par défaut `studio.linto.ai`), puis se connecter
   par email / mot de passe ou par SSO. « Se souvenir de moi » garde la session ouverte.
2. **Choisir une session** dans la barre latérale, ou en créer une avec **Nouvelle session…**
   (⌘N / Ctrl+N) : nom, organisation, profil de transcription, **Traductions** (langues dans
   lesquelles LinTO traduit la session, proposées par le profil) et **Visibilité** (Organisation,
   Public, Protégée par mot de passe ou Privée). Un nom déjà utilisé reprend la session existante
   au lieu d'en créer une deuxième.
3. **Régler** dans le panneau de droite : **caméra** (ou carte de capture, facultative : « Aucune »
   pour n'envoyer que le son ; « Écran… » ou « Fenêtre… » diffusent à la place un écran ou la
   fenêtre d'une application, par exemple une présentation), **micro** (c'est ce son qui est transcrit ; **Écouter le retour
   audio** le fait entendre, au casque, tel qu'il part vers LinTO et est enregistré), taille des sous-titres,
   affichage des sous-titres et du filigrane.
   Avec une caméra, son aperçu s'affiche en haut du centre de la fenêtre. En dessous, la
   transcription au fil de la parole, avec tout ce qui a été dit depuis le démarrage (elle reste lisible après Arrêter, jusqu'au prochain Démarrer). Remonter
   dans le texte suspend le défilement ; « Revenir au direct » le reprend. Comme sur LinTO Studio,
   chaque segment porte son heure et la langue détectée (là où elle change). Après Arrêter,
   **Exporter…** (en bas) enregistre la transcription en texte, SRT, WebVTT ou JSON. La fenêtre
   n'affiche que les 5 000 derniers segments ; l'export les contient tous (jusqu'à 100 000, soit plusieurs jours de parole).
4. Ouvrir la **fenêtre de sortie** (bouton écran de la barre d'outils, ou menu Fenêtre ›
   **Afficher la fenêtre de sortie**, ⌘1 / Ctrl+1), avant ou pendant le direct : elle ne s'ouvre
   jamais seule. La glisser sur l'écran de la salle ; clic droit › « Plein écran » pour la passer en
   plein écran sur cet écran. Sous Linux, F11 la passe aussi en plein écran sur l'écran où elle se
   trouve (sans barre de titre) et l'en sort ; Échap quitte le plein écran, puis ferme la fenêtre.

   Pour poser les sous-titres **par-dessus autre chose** (diapositives, visio), le bouton
   sous-titres, juste à côté, ouvre une **fenêtre de sous-titres** : sans barre de titre, toujours au
   premier plan, elle ne montre que la bande (sans QR code). La saisir n'importe où pour la
   déplacer, tirer ses bords pour la redimensionner (le texte suit sa hauteur) ; la croix qui
   apparaît au survol, la touche Échap ou le même bouton la ferment. Sa place est retenue. En
   **session Wayland**, elle passe par XWayland (GNOME ne laisse pas une fenêtre Wayland se mettre
   d'elle-même au premier plan).
5. **Démarrer** (⌘↩ / Ctrl+Entrée) : les sous-titres apparaissent sur la vidéo.
6. **Arrêter** (⌘. / Ctrl+.) coupe les sous-titres et l'envoi du son **sans terminer** la session
   LinTO, qui peut être reprise plus tard ; la fenêtre de sortie reste ouverte, sur la caméra.
   **Terminer la session…** (menu Session) la clôt définitivement côté LinTO, comme « Arrêter et
   enregistrer » dans LinTO Studio : la transcription (et ses traductions) est enregistrée comme
   média dans LinTO Studio, puis la session est supprimée.

La barre d'état en bas indique si LinTO reçoit bien le son. L'icône LinTO Live dans la barre des
menus (macOS) ou la zone de notification (Linux) signale quand un direct est en cours. Quitter
l'application pendant un direct revient à cliquer sur Arrêter.

### Langues, QR code, source de secours, enregistrement

- **Langues des sous-titres** : le panneau de droite propose, pour la session choisie, la langue
  affichée sur la vidéo (originale ou une traduction de la session). Le choix est gardé par
  session. Le lien public (QR code) n'est utilisable que si la session est **publique** sur LinTO ;
  sinon une note le rappelle (rendre la session publique dans LinTO Studio).
- **QR code** : « Afficher le QR code » place un QR code vers la session sur la vidéo ; « Épingler »
  le garde visible en permanence ; sinon il apparaît périodiquement, par défaut toutes les 60 s
  pendant 15 s (fréquence et durée réglables dans « Paramètres du QR code… »).
- **Capture d'écran ou de fenêtre** : « Écran… » et « Fenêtre… » (source principale ou de secours)
  listent les écrans ou les fenêtres ouvertes. Sur macOS, il faut autoriser LinTO Live dans
  Réglages Système › Confidentialité et sécurité › **Enregistrement de l'écran**, puis relancer
  l'app ; la fenêtre de choix y mène. Sous Linux, en session X11, la capture passe par X11 (XSHM,
  XComposite) ; en session Wayland, par le portail du bureau : après « Choisir », le système demande
  lui-même quel écran ou quelle fenêtre partager, et retient ce choix aux démarrages suivants. Une fenêtre fermée ou réduite
  compte comme une source absente : le secours prend le relais.
- **Source de secours** : en plus de la source principale, une caméra, une image ou une vidéo (ou
  un écran, une fenêtre) peut servir de secours. Si la principale disparaît (câble débranché, caméra coupée), la sortie bascule
  sur le secours en 2 s environ, puis revient à la principale de même quand elle réapparaît. Le
  panneau indique laquelle est à l'antenne. Avec « Écran noir = source absente » (activé par
  défaut), un écran noir fixe, comme celui qu'envoie un ATEM quand son entrée est perdue, est
  traité comme une source absente.
- **Enregistrement** : « Enregistrer le direct » écrit la sortie (vidéo, sous-titres incrustés et
  son) en 1920×1080 dans un fichier MKV du dossier choisi, par défaut Vidéos (Films sur macOS) ›
  `LinTO Live`. Une pastille rouge **REC** s'affiche dans la barre d'outils pendant
  l'enregistrement. Le réglage s'applique au prochain Démarrer ; une panne d'enregistrement
  n'interrompt jamais le direct.
- **Effacer la transcription…** (pendant un direct) fait comme le bouton du même nom dans LinTO
  Studio : la transcription de la session est effacée sur LinTO, et disparaît à la fois des
  sous-titres de LinTO Live et de LinTO Studio. À l'inverse, effacer la transcription depuis LinTO
  Studio vide aussi les sous-titres et la transcription de LinTO Live. Le direct continue.
- **Diffusion en ligne** : « Diffuser en ligne » envoie la même sortie (1920×1080, sous-titres
  incrustés et son) à une plateforme de streaming (YouTube, Twitch, PeerTube, serveur RTMP…).
  L'adresse du serveur (`rtmp://` ou `rtmps://`) et la clé de stream fournies par la plateforme se
  saisissent dans « Paramètres de diffusion… » ; la clé est chiffrée comme le mot de passe mémorisé
  et n'est jamais réaffichée. OBS ne la reçoit jamais : il envoie l'image à l'application, sur un port
  local, et c'est l'application qui la publie sur la plateforme ; la clé n'apparaît donc ni dans la
  configuration ni dans les journaux d'OBS. Une clé refusée est signalée, avec la raison donnée par la
  plateforme, avant même qu'OBS ne démarre. Une pastille rouge **EN LIGNE** s'affiche pendant la diffusion. OBS
  n'ayant qu'une sortie en plus de l'envoi vers LinTO, diffusion et enregistrement s'excluent :
  cocher l'un décoche l'autre. Comme l'enregistrement, le réglage s'applique au prochain Démarrer
  et une coupure de la diffusion n'interrompt pas le direct (pas de reconnexion automatique : elle
  reprend au Démarrer suivant).
- **Caméra virtuelle** (section Enregistrement et diffusion) : la sortie (image et sous-titres
  incrustés, sans le son) apparaît comme une webcam « OBS Virtual Camera » dans les autres
  applications (Zoom, Teams, Visio, navigateur…). Indépendante de l'enregistrement et de la
  diffusion, elle s'active immédiatement, direct ou non, et n'est pas mémorisée d'un lancement à
  l'autre.
  - macOS : à la première utilisation, autoriser l'extension caméra d'OBS dans Réglages Système →
    Général → Ouverture et extensions → Extensions de caméra. macOS n'active cette extension que
    depuis le dossier Applications : LinTO Live y place sa copie d'OBS, dans le dossier masqué
    `/Applications/.LinTO Live` (droits d'administrateur nécessaires ; supprimé à la
    désinstallation).
  - Linux : nécessite le module `v4l2loopback` (paquet `v4l2loopback-dkms`), chargé à la demande
    (mot de passe administrateur), aussi depuis le Flatpak. Sans lui, l'option est grisée et son
    infobulle indique quoi faire.

### Droits LinTO nécessaires

Ce que l'application permet dépend du rôle du compte dans l'organisation LinTO ; ce qui n'est pas
permis est grisé, avec la raison au survol :

| Action | Rôle minimum | Autre condition |
|---|---|---|
| Voir les sessions, recevoir les sous-titres | Membre | les sessions privées des autres ne sont visibles qu'à partir de Gestionnaire de réunion |
| Envoyer le son à une session | — | être propriétaire de la session, ou Gestionnaire de réunion |
| Lister les profils de transcription | Réunion rapide | |
| Créer une session, régler son filigrane, effacer sa transcription, la terminer | Gestionnaire de réunion | l'organisation doit avoir l'option « Sessions » activée |

Si l'accès à une session est perdu en plein direct (compte retiré de l'organisation), l'envoi du
son continue mais les sous-titres s'arrêtent, avec un message : il ne s'agit pas d'une
déconnexion, se reconnecter n'y changerait rien.

## Désinstallation

Menu **LinTO Live › Désinstaller LinTO Live…** (macOS) ou **Fichier › Désinstaller LinTO Live…**
(Linux). L'application arrête OBS, supprime toutes ses données (configuration, OBS embarqué et sa
configuration, cookies, cache) et se met à la corbeille.

Avec le paquet `.deb`, l'application elle-même se retire ensuite avec
`sudo apt remove linto-live` (la désinstallation intégrée efface les données, pas le paquet) ;
avec le Flatpak, `flatpak uninstall --delete-data ai.linto.live`.

Données concernées, si besoin de les retirer à la main :

- macOS : `/Applications/LinTO Live.app`, `~/Library/Application Support/LinTO Live`, et les
  entrées `LinTO Live` / `ai.linto.live` de `~/Library/Caches`, `~/Library/Logs`,
  `~/Library/Preferences` et `~/Library/Saved Application State`
- Linux : `~/.config/LinTO Live`, `~/.cache/LinTO Live`, le fichier `.AppImage` (ou le paquet
  `linto-live` avec `.deb`)

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
  → `dist/LinTO-Live-<version>-x86_64.AppImage` et `dist/LinTO-Live-<version>-amd64.deb`
- Linux, sur Ubuntu 24.04 : voir [`docs/linux-build.md`](docs/linux-build.md) ; `npm run dist:linux`
  construit aussi le Flatpak (`flatpak` et `flatpak-builder` requis, pas dans le build Docker)
- Versions : pousser un tag `v<version>` (égal à celui de `package.json`) ; la CI construit les
  quatre paquets et publie la version GitHub avec les notes du `CHANGELOG.md`

## OBS Studio

LinTO Live embarque **OBS Studio 32.1.0** (licence GPL-2.0), piloté comme un processus séparé via
obs-websocket. Sur macOS, c'est le binaire officiel non modifié ; sur Linux, il est compilé depuis
les sources avec trois petits correctifs. Provenance, sources et correctifs :
[`resources/obs/SOURCE.md`](resources/obs/SOURCE.md).
