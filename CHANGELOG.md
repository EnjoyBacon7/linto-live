# Journal des modifications

Toutes les modifications notables de LinTO Live sont consignées ici.
Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet respecte le
[versionnage sémantique](https://semver.org/lang/fr/).

## [Non publié]

## [0.7.0] - 2026-11-23

### Ajouté

- **Fenêtre de sous-titres** : un bouton à côté de la fenêtre de sortie ouvre une fenêtre sans
  barre de titre, toujours au premier plan, qui ne montre que la bande de sous-titres (avec le
  filigrane, sans QR code). Elle se déplace en la saisissant n'importe où, se redimensionne par ses
  bords (le texte suit sa hauteur) et retient sa place. Sous GNOME/Wayland, le premier plan se
  règle depuis le menu de la fenêtre.

## [0.6.2] - 2026-11-19

### Modifié

- **AppImage sans libfuse2** : l'AppImage utilise le runtime statique d'AppImage et démarre sur
  Ubuntu 24.04 et suivantes sans rien installer (`libfuse2t64` n'est plus nécessaire). Les trois
  paquets Linux (`.deb`, Flatpak, AppImage) sont pris en charge sur Ubuntu 24.04 et suivantes.

### Corrigé

- **Capture d'écran et de fenêtre en session Wayland (Linux), suite** : choisir « Écran… » ou
  « Fenêtre… » n'ouvrait pas la fenêtre de choix du système et la source restait noire jusqu'au
  redémarrage d'OBS (l'OBS embarqué ne traitait les réponses du portail que pour les sources qu'il
  crée lui-même). Corrigé dans l'OBS embarqué : la fenêtre de choix s'ouvre aussitôt.

## [0.6.1] - 2026-11-19

### Corrigé

- **Capture d'écran et de fenêtre en session Wayland (Linux)** : choisir une fenêtre faisait planter
  OBS, et un écran restait noir (X11 ne voit rien des fenêtres Wayland). La capture passe désormais
  par le portail du bureau (PipeWire) : le système demande quel écran ou quelle fenêtre partager, et
  retient ce choix aux démarrages suivants.

## [0.6.0] - 2026-11-19

### Ajouté

- **Capture d'écran et de fenêtre** : la source vidéo (principale ou de secours) peut être un écran
  ou la fenêtre d'une application (« Écran… », « Fenêtre… »), choisis dans une liste. Sur macOS, la
  fenêtre de choix aide à accorder l'autorisation d'enregistrement de l'écran ; sous Linux, la
  capture passe par X11 (XSHM, XComposite).
- **Caméra virtuelle** : la sortie de LinTO Live (image et sous-titres, sans le son) est proposée
  comme webcam aux autres applications. Grisée, avec une infobulle explicative, quand le système
  n'en dispose pas (Linux sans le module `v4l2loopback`). Sous Linux, le module est chargé à la
  demande (mot de passe administrateur), y compris depuis le Flatpak. Sur macOS, qui n'autorise
  l'extension caméra d'OBS que depuis le dossier Applications, la copie d'OBS utilisée par LinTO
  Live est placée dans `/Applications/.LinTO Live` (dossier masqué, supprimé à la désinstallation).
- **Gain du micro** : un curseur (-30 à +20 dB) sous le vumètre amplifie ou atténue le micro, suivi
  d'un limiteur (-1 dBFS) pour que l'amplification ne sature pas le son. Le réglage est retenu.
- **Page de premier lancement** : avant la connexion, elle explique et demande ce dont LinTO Live a
  besoin.
  - macOS : accès à la caméra, au micro et aux notifications. OBS ne démarre qu'une fois la page
    validée si macOS n'a encore jamais posé la question ; un accès refusé propose d'ouvrir le bon
    panneau des Réglages Système.
  - Linux : elle s'affiche si le système n'a pas ce dont le direct ou certaines fonctions ont besoin,
    et dit comment l'obtenir : serveur X / XWayland (nécessaire à OBS), serveur de son PulseAudio ou
    `pipewire-pulse` (micro), accélération graphique (sous-titres), trousseau de clés (connexion
    retenue), module `v4l2loopback` (caméra virtuelle), zone de notification (GNOME sans l'extension
    AppIndicator). Elle signale aussi une session Wayland (placement de la fenêtre de sortie non
    garanti).
  - Les deux permettent d'essayer les notifications.
- **Encodage matériel sous Linux** : avec une carte NVIDIA (NVENC), l'enregistrement et la diffusion
  en ligne sont encodés par la carte graphique au lieu du processeur, comme avec VideoToolbox sur
  macOS. Si l'encodeur matériel refuse de démarrer, LinTO Live repasse aussitôt sur x264, et s'y
  tient aux lancements suivants.
- **Zone de notification (Linux)** : fermer la fenêtre pendant un direct la masque, comme sur macOS,
  quand le bureau affiche l'icône (sinon elle est réduite) ; un clic sur l'icône la rouvre. L'icône
  devient foncée sur un panneau clair (KDE, Xfce… en thème clair).
- Diagnostic : la sortie d'OBS à son lancement est gardée dans `obs-home/obs-launch.log` (données de
  l'application), pour comprendre un OBS qui ne démarre pas.

### Modifié

- **Panneau de réglages en sections repliables** (Vidéo, Micro, Transcription, Incrustations,
  Enregistrement et diffusion), avec un résumé des valeurs une fois fermées ; l'état est retenu. Micro
  fermé : vumètre compact dans l'en-tête. Enregistrement et diffusion se choisissent par un choix
  unique (boutons radio) au lieu de deux cases qui s'excluaient.
- Notes retirées sous « Écouter le retour audio », « Paramètres de diffusion… » et le gain du micro.
- **Flatpak** : l'application peut désormais lancer des commandes sur le système hôte
  (`--talk-name=org.freedesktop.Flatpak`, une sortie du bac à sable), utilisé uniquement pour
  vérifier et charger le module `v4l2loopback` de la caméra virtuelle. La mise à jour du Flatpak
  affiche cette nouvelle autorisation.
- CI : OBS officiel démarré et arrêté à chaque build macOS, comme l'OBS embarqué sous Linux.

### Corrigé

- **Transcription synchronisée avec LinTO** : au démarrage ou à la reprise d'une session, l'historique
  stocké sur LinTO s'affiche avant les mots en direct (sans doublon) ; hors direct, choisir une
  session affiche sa transcription depuis LinTO, et l'export enregistre celle-ci.
- **Statut des sessions** : la liste est relue quand l'envoi du son change d'état, pour que le statut
  affiché suive celui de LinTO.
- La fenêtre principale ne défile plus en entier.
- **Icône sur Linux** : la fenêtre de LinTO Live s'affichait sans icône dans le dock, la barre des
  tâches et Alt-Tab (Flatpak notamment, sous Wayland). Son identifiant (`app_id` / `WM_CLASS`) est
  désormais `ai.linto.live`, le même que celui de son entrée de menu, et l'icône est installée dans
  les tailles standard (16 à 512 px) : la seule icône de 1024 px n'était ni trouvée par GNOME
  (paquet `.deb`) ni exportée par Flatpak.
- Listes déroulantes lisibles sous Linux en thème sombre (texte blanc sur fond blanc).
- **À propos (Linux)** : la fenêtre « À propos de LinTO Live » affiche le nom, la version, l'icône
  et le site du projet.

## [0.5.0] - 2026-11-17

### Ajouté

- **Correction des noms propres (expérimental)** : dans les sous-titres, case « Corriger les noms
  propres » et liste des noms attendus (un par ligne). Les mots de LinTO qui se prononcent comme
  l'un de ces noms sont remplacés dans la bande, la transcription et l'export (« lina gora » →
  Linagora, « Ici, les Moulineaux » → Issy-les-Moulineaux), une fois la phrase finalisée. Les
  traductions, LinTO Studio et la page publique gardent le texte de LinTO.
- **Effacer la transcription…** : comme dans LinTO Studio, efface la transcription de la session
  sur LinTO ; les sous-titres et la transcription se vident dans LinTO Live **et** dans LinTO
  Studio. Un effacement fait depuis LinTO Studio vide aussi LinTO Live. Remplace « Effacer les
  sous-titres », qui ne vidait que le bandeau localement.
- **Écouter le retour audio** (réglage Micro) : le son du micro tel qu'il est envoyé à LinTO et
  enregistré est joué sur la sortie audio du système, pour vérifier sa qualité. Désactivé à
  chaque lancement ; à utiliser au casque (sur haut-parleurs, le micro le reprend : larsen).
- **Diffusion en ligne** (YouTube, Twitch, PeerTube, serveur RTMP/RTMPS) : la sortie Full HD,
  sous-titres compris, est envoyée au serveur et à la clé de stream saisis dans « Paramètres de
  diffusion… » (clé chiffrée). L'application publie elle-même le flux : la clé ne passe jamais par
  OBS (ni sa configuration ni ses journaux), et une clé refusée est signalée avec la raison de la
  plateforme. Pastille **EN LIGNE** pendant la diffusion. Diffusion et
  enregistrement s'excluent (OBS n'a qu'une sortie en plus de celle vers LinTO).

### Modifié

- L'enregistrement passe par la sortie FFmpeg d'OBS (même MKV 1920×1080 H.264/AAC), qui sert aussi
  à la diffusion en ligne.
- **Terminer la session** fait désormais comme « Arrêter et enregistrer » dans LinTO Studio : la
  transcription et ses traductions sont enregistrées comme média dans LinTO Studio, puis la session
  est supprimée. Auparavant, la session était seulement close et n'apparaissait pas dans les médias.
- **Accessibilité** : bouton principal et élément de menu surligné plus contrastés (4,9:1), anneau
  de focus opaque visible sur tous les fonds, textes informatifs plus lisibles. Démarrer, Terminer,
  Nouvelle session et Effacer la transcription restent atteignables au clavier quand ils sont
  indisponibles, et le lecteur d'écran annonce pourquoi.

### Corrigé

- **Fiabilité du direct** : le flux ne reste plus affiché « actif » quand OBS est perdu ; la
  relance du flux repart de zéro à chaque direct ; Arrêter interrompt les tentatives de relance
  d'OBS et n'attend plus indéfiniment l'arrêt du flux.
- **Connexion** : la connexion SSO échoue avec un message au bout de 20 s au lieu de rester bloquée ;
  l'écran de connexion réaffiche l'instance mémorisée quand la nouvelle est refusée ; Entrée dans le
  champ mot de passe valide le formulaire.
- **Clavier et lecteur d'écran** : le menu Compte se pilote au clavier (flèches, Début/Fin, Tab) ;
  le statut de chaque session est annoncé ; un nombre invalide dans les réglages du QR code ou du
  filigrane affiche une erreur.
- Un chemin d'enregistrement long ne fait plus défiler l'inspecteur horizontalement.

## [0.4.0] - 2026-11-16

### Ajouté

- **Langues des sous-titres** : choix de la langue affichée sur la vidéo parmi celles de la
  session, mémorisé par session, avec rappel quand la session n'est pas publique.
- **QR code** vers la session sur la vidéo, affiché ou épinglé, avec ses paramètres.
- **Source de secours** (caméra, image ou vidéo) : bascule automatique en 2 s environ quand la
  principale disparaît, retour de même ; un écran noir (ATEM sans entrée) compte comme absence.
- **Enregistrement du direct** en MKV 1920×1080 dans le dossier choisi (par défaut Vidéos (Films
  sur macOS) › LinTO Live), avec pastille REC dans la barre d'outils.

### Modifié

- **Ubuntu 22.04** : pris en charge par le Flatpak, installé et vérifié sur Ubuntu 22.04 à chaque
  build de la CI (le `.deb` et l'AppImage demandent toujours glibc 2.39).

## [0.3.1] - 2026-11-16

### Corrigé

- **Flatpak sous Wayland** : l'application plantait au lancement dans une session Wayland (GNOME,
  KDE…). Le Flatpak a désormais accès à Wayland ; OBS embarqué continue de passer par XWayland.
- **Arrêter / Démarrer ne se bloquent plus** quand OBS plante ou que LinTO ne répond pas : chaque
  appel est borné dans le temps, Arrêter n'attend plus une action en cours, et un OBS figé est
  relancé automatiquement.
- **Diffusion en SRT uniquement** : une session LinTO sans point SRT n'est plus diffusée en RTMP
  (qui ne fonctionnait pas) ; un message l'explique.
- **Export de la transcription complet** : il n'est plus tronqué à 5 000 segments ; un export
  incomplet le signale.

## [0.3.0] - 2026-11-10

### Ajouté

- **Paquet Flatpak** (`LinTO-Live-<version>-x86_64.flatpak`) pour toute distribution Linux avec
  Flatpak : `flatpak install --user ./LinTO-Live-<version>-x86_64.flatpak`. Le runtime Freedesktop
  est récupéré sur Flathub à l'installation.
- Chaque version est désormais construite et publiée par la CI : dmg, `.deb`, Flatpak, AppImage et
  `SHA256SUMS.txt`, avec les notes de ce journal.

### Modifié

- Désinstallation depuis le Flatpak : le message indique `flatpak uninstall --delete-data
  ai.linto.live` au lieu d'`apt remove`.

### Corrigé

- OBS embarqué démarre sans la bibliothèque préchargée par le bac à sable Electron du Flatpak.
- CI : contrôle des bibliothèques d'OBS sur le `.deb` réellement installé ; job macOS remis en
  service (macos-15).

## [0.2.0] - 2026-11-10

### Ajouté

- **Transcription dans la fenêtre principale**, au fil de la parole et avec son historique (gardé
  jusqu'au prochain Démarrer). Le défilement suit le direct, sauf si on remonte lire.
- **Heure et langue des segments**, comme sur LinTO Studio : l'heure s'affiche quand le locuteur
  change ou après une pause de plus de 5 s ; la langue détectée là où elle change.
- **Export de la transcription** après Arrêter : texte, SRT, WebVTT ou JSON.
- **Caméra facultative** (« Aucune ») : l'application sert aussi de simple client LinTO, avec
  seulement une session et un micro.
- **Aperçu caméra** au-dessus de la transcription dans la fenêtre principale.
- **Fenêtre de sortie à la demande** : bouton de la barre d'outils, menu Fenêtre (⌘1 / Ctrl+1) ou
  zone de notification, aussi hors direct pour la placer sur le second écran avant le spectacle.
  Elle reste au-dessus de la fenêtre principale.
- **Droits d'accès LinTO** : Nouvelle session, Terminer et filigrane sont grisés, avec la raison,
  quand le rôle ou les permissions de l'utilisateur ne les autorisent pas. Messages clairs pour
  chaque refus (création, modification, fin, niveau de sécurité, compte désactivé, e-mail non
  vérifié). Le README détaille les droits nécessaires.
- **Nouvelle session** vérifie d'abord le nom : une session existante et utilisable est proposée
  (« existe déjà ») ; une session sans les droits ou terminée est refusée.
- Bandeaux « aucune organisation » et « choisis une organisation » ; une organisation enregistrée
  qui a disparu est oubliée.

### Modifié

- La barre latérale ne liste plus que les sessions utilisables (fini les lignes grisées).
- La fenêtre de sortie ne s'ouvre plus d'elle-même, ni à Démarrer ni au choix d'une caméra.
- Arrêter ne bascule plus sur la scène noire : la fenêtre de sortie reste sur la caméra.
- Barre d'état du bas et statut « prête » de la barre d'outils retirés.
- Les relances du flux prennent en compte les nouveaux points d'envoi LinTO.

### Corrigé

- Changer de session dans la barre latérale n'affiche plus la transcription (ni l'export) du
  dernier direct d'une autre session.
- Un refus d'accès (401 « not authorized to access this resource ») n'est plus pris pour une
  session expirée.
- Sous-titres refusés : l'application indique s'il faut se reconnecter, si l'accès est perdu (le
  son continue), ou si la session est terminée ou supprimée.
- Une session supprimée pendant le direct arrête le direct avec un message.
- Profils refusés : liste vide au lieu d'un échec du chargement ; une session existante démarre
  sans profil.
- L'entrée vide d'OBS n'apparaît plus dans les listes de caméras et de micros.

## [0.1.0] - 2026-11-09

Première version : la vidéo d'une caméra ou d'une carte de capture, avec les sous-titres LinTO en
temps réel incrustés, sur un second écran ou un vidéoprojecteur. OBS Studio 32.1.0 est embarqué et
invisible. Paquets pour macOS (Apple Silicon) et Linux (.deb pour Ubuntu 24.04+ / Debian 13+,
AppImage pour les autres distributions x86_64).

[0.7.0]: https://github.com/EnjoyBacon7/linto-live/compare/v0.6.2...v0.7.0
[0.6.2]: https://github.com/EnjoyBacon7/linto-live/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/EnjoyBacon7/linto-live/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/EnjoyBacon7/linto-live/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/EnjoyBacon7/linto-live/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/EnjoyBacon7/linto-live/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/EnjoyBacon7/linto-live/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/EnjoyBacon7/linto-live/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/EnjoyBacon7/linto-live/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/EnjoyBacon7/linto-live/releases/tag/v0.1.0
