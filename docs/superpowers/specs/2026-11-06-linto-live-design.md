# LinTO Live — design

*2026-11-06 — Camille Bizeul*

## Intention

Pour des prestations client, Camille affiche en salle (sur un second écran / vidéoprojecteur en
HDMI) la vidéo de la salle avec les sous-titres LinTO en temps réel incrustés. Aujourd'hui ça
demande d'ouvrir OBS, Chrome, de cropper une fenêtre à la main (`~/GitHub/linto-obs-setup`).

LinTO Live remplace ça par **une seule appli** : on se connecte à LinTO (SSO compris), on tape un
nom de session, on choisit l'entrée vidéo, et l'image part sur le HDMI. Tout le reste (OBS,
navigateur, réglages) est invisible pour l'utilisateur.

## Objectifs

1. Appli de bureau **macOS (Apple Silicon) et Linux (x86_64)**.
2. **Login LinTO** dans l'appli, y compris **SSO** (tous les fournisseurs proposés par l'instance).
3. **Nom de session** : si une session de ce nom existe déjà, on la **réutilise** (pas de doublon) ;
   sinon on la crée.
4. **Choix de l'entrée vidéo** (carte de capture / caméra) **et de l'entrée audio** de l'ordinateur
   (micro, son de la carte de capture…) — c'est cet audio qui est transcrit par LinTO.
5. **OBS fait tout le travail vidéo** (capture, composition, sortie) — exigence de Camille pour la
   stabilité. L'appli ne manipule jamais d'image elle-même ; elle pilote OBS par son API.
6. **Sortie HDMI** : image composée en plein écran sur l'écran choisi.
7. **Seule l'appli est visible** : ni fenêtre OBS, ni navigateur.
8. **Autonome** : OBS est embarqué dans l'appli avec sa propre config, séparée de l'OBS
   personnel. **Désinstaller l'appli supprime tout** (binaires, config OBS, cookies, cache).

## Non-objectifs

- Streaming public / enregistrement / caméra virtuelle (sortie image = HDMI uniquement ; le seul
  flux sortant est l'audio envoyé à la session LinTO).
- Mise en page multi-caméras, scènes multiples, régie.
- Gestion avancée des sessions LinTO (traductions, planification, mots de passe) : on reste sur
  « une session, un canal ».
- Windows.

## Anti-objectifs (ce qui serait un échec même si « ça marche »)

- L'appli touche aux images (composition maison, capture d'écran recollée…) au lieu d'OBS.
- Une fenêtre OBS, un dialogue OBS (assistant de 1er lancement, « What's new », mise à jour,
  « OBS n'a pas été fermé correctement ») ou un Chrome apparaît pendant l'usage.
- L'appli modifie ou lit la config de l'OBS personnel de l'utilisateur.
- Il reste des fichiers sur la machine après désinstallation.
- Taper deux fois le même nom crée deux sessions.
- « Arrêter » termine une session que le client voulait reprendre.

## Faits établis (recherche du 2026-11-06, code source à l'appui)

### LinTO Studio (studio.linto.ai, branche `next` de linto-ai/linto-studio + linto-studio-plugins)

- Bases : API `https://studio.linto.ai/cm-api/api`, auth `https://studio.linto.ai/cm-api/auth`,
  socket.io `https://studio.linto.ai` path `/cm-api/socket.io`, transport websocket.
  Ces URL sont lues depuis `https://<instance>/config.js` (`VUE_APP_CONVO_API`, `VUE_APP_CONVO_AUTH`,
  `VUE_APP_SESSION_WS`, `VUE_APP_SESSION_WS_PATH`).
- `GET /auth/list` (sans auth) liste les méthodes : `local`, `oidc` (Linagora), `oidc/organization`
  (SSO par domaine d'email : `POST /auth/oidc/organization/resolve {email}`), `oidc/google`,
  `oidc/github`. Entrée : `GET {AUTH}/{path}/login`.
- Login local : `POST /auth/login {email,password}` → `{auth_token, refresh_token, user_id}`.
- SSO : après le fournisseur, retour sur `https://<instance>/login/oidc`, soit avec `?token=` dans
  l'URL (google/github/organization), soit avec un cookie httpOnly 5 min échangé via
  `GET /auth/oidc/token` → `{auth_token, user_id}` (Linagora). Pas de refresh token en SSO.
- Appels API : `Authorization: Bearer <auth_token>`. Refresh local suspect (bug de secret) →
  sur 401, re-login.
- Orgas : `GET /api/organizations`. Sessions sous `/api/organizations/:orgId/sessions`.
  - Recherche : `?searchName=<préfixe>&statusList=...` (préfixe, probablement sensible à la casse)
    → filtrer côté appli sur égalité exacte du nom.
  - Statuts : `on_schedule | ready | active | paused | terminated`. **Une session `terminated` ne
    peut pas être réutilisée** (ni redémarrée ni modifiée).
  - Création : `POST` `{name, channels:[{transcriberProfileId, name, translations:[], diarization:false,
    keepAudio:true, compressAudio:true}], meta:{}, scheduleOn:null, endOn:null, autoStart:true,
    autoEnd:false, visibility}` ; nécessite le rôle MEETING_MANAGER (4) et la permission SESSION
    de l'orga. Profils : `GET /api/organizations/:orgId/transcriber_profiles`.
  - Pas d'endpoint « start » : la session passe `active` dès qu'un flux audio arrive sur un canal.
  - Arrêt : `PUT .../sessions/:id/stop?force=true&waitFinal=true`.
- Transcription live : socket.io avec `auth:{token}`, `emit("join_room", "<sessionId>/<channel.id>")`,
  événements `partial` / `final` `{segmentId, text, start, end, lang, locutor, ...}` (les partiels
  partagent un `segmentId`, le final le clôt).
- Audio : chaque canal expose `streamEndpoints {srt?, rtmp?, ws?}` (visibles par le propriétaire /
  MEETING_MANAGER). WS : `{"type":"init","sampleRate":16000,"encoding":"pcm"}` → `ack` → PCM16 16 kHz.
- Les appels HTTP se font depuis le process principal (CORS ne connaît pas l'origine Electron).

### OBS 32.1 + obs-websocket 5.7

- Pas de `--portable` sur les builds officiels macOS/Linux.
  - Linux : config déplacée par `XDG_CONFIG_HOME` (+ `XDG_CACHE_HOME`).
  - macOS : seul `CFFIXED_USER_HOME` déplace `Application Support` (testé) ; `HOME` est ignoré.
    `NSUserDefaults` écrit encore dans `~/Library/Preferences/<bundle-id>.plist`.
- Flags utiles : `--multi`, `--minimize-to-tray`, `--disable-updater`,
  `--disable-missing-files-check`, `--collection`, `--profile`, `--scene`, `--websocket_port`,
  `--websocket_password`. `--disable-shutdown-check` n'existe plus en 32.x.
- Dialogues neutralisés par pré-remplissage de `global.ini` / `user.ini` (FirstRun, LastVersion,
  InfoLastVersion/InfoIncrement, EnableAutoUpdates=false, MacOSPermissionsDialogLastShown=1,
  ConfirmOnExit=false, SysTrayEnabled=true, Pre31Migrated=true) + suppression de `.sentinel/run_*`
  avant chaque lancement + arrêt propre (SIGTERM).
- obs-websocket : `plugin_config/obs-websocket/config.json`
  `{first_load:false, server_enabled:true, server_port, auth_required:true, server_password,
  alerts_enabled:false}`.
- Sources : caméra macOS `macos-avcapture` (setting `device`), Linux `v4l2_input` (`device_id`),
  overlay `browser_source` (`url, width, height, fps, fps_custom:true, css`). Liste des périphériques :
  `GetInputPropertiesListPropertyItems`.
- Sortie : `GetMonitorList` + `OpenVideoMixProjector {videoMixType: PROGRAM, monitorIndex}`.
  Aucune requête ne ferme un projecteur (il se ferme en quittant OBS ou au débranchement).
  Les index d'écran bougent au branchement → identifier l'écran par position/taille.
- Risques connus : sous macOS, projecteur peut-être invisible avec `--minimize-to-tray`
  (politique d'activation « Prohibited ») — **à tester en premier** ; sous Linux Wayland, placement
  du projecteur incertain → forcer `QT_QPA_PLATFORM=xcb`.
- Licence : OBS est GPLv2 ; le piloter par websocket en process séparé = agrégation. Livrer le
  texte GPL + les sources exactes de l'OBS embarqué (ou offre écrite). Ne pas utiliser la marque OBS.

## Le comment, tel que décidé avec Camille

- OBS est le moteur vidéo, piloté via ses API (obs-websocket). Pas de traitement d'image maison.
- Sortie = projecteur plein écran OBS sur l'écran HDMI.
- OBS est embarqué et caché ; seule la fenêtre de l'appli est visible.
- L'overlay est rendu **par OBS** (source navigateur), alimenté par la transcription LinTO récupérée
  via l'API avec le login de l'utilisateur — plus de capture de fenêtre Chrome.
- Le SSO doit fonctionner.
- Même nom de session ⇒ même session.
- L'appli laisse choisir une **entrée audio** de l'ordinateur ; c'est elle qui est transcrite.
- **« Arrêter »** coupe la sortie HDMI et l'envoi audio **sans terminer** la session LinTO (on peut
  la reprendre plus tard avec le même nom). Terminer définitivement = bouton distinct
  (« Terminer la session », avec confirmation), qui appelle `PUT …/stop`. Fermer l'appli = Arrêter.
- Si le nom ne correspond qu'à une session **terminée**, l'appli le dit et demande un autre nom
  (pas de doublon).
- **Cible v1 : le Mac de Camille, mais Linux est important** → Linux fait partie de la v1.
  OBS embarqué non re-signé sur macOS accepté pour l'instant (cf. compromis ci-dessous).
- Si macOS empêche de cacher OBS sans casser le projecteur : **icône OBS dans le Dock acceptée**
  pour l'instant (aucune fenêtre OBS visible en revanche).

## Mes choix (proposés, à valider)

- **Stack : Electron + TypeScript**, packagé avec electron-builder. Raison : la fenêtre de login SSO
  s'ouvre *dans* l'appli (BrowserWindow) et on peut intercepter le retour `/login/oidc` ; même
  moteur sur macOS et Linux. Libs : `obs-websocket-js` (v5), `socket.io-client`.
- **Architecture (process principal)** :
  - `auth` : écran de login — liste des méthodes via `/auth/list`, email/mot de passe ou boutons SSO
    (fenêtre modale de l'appli, partition de session dédiée). Token chiffré avec `safeStorage`
    dans les données de l'appli. Sur 401 → retour à l'écran de login.
  - `linto` : client REST + socket.io (choix de l'orga si plusieurs, recherche/création de session,
    abonnement au canal 0).
  - `obs` : superviseur — génère la config OBS dans les données de l'appli, lance OBS caché avec
    mot de passe websocket aléatoire par lancement, s'y connecte, crée scène + sources, ouvre le
    projecteur, redémarre OBS s'il tombe, l'arrête proprement à la fermeture de l'appli.
  - `overlay` : petit serveur HTTP + WebSocket local (127.0.0.1, port aléatoire) qui sert la page
    de sous-titres chargée par la source navigateur d'OBS et lui pousse les `partial`/`final`.
    La page est en HTML/CSS seulement (texte blanc, 2 lignes, fond sombre semi-transparent, en bas).
- **Audio vers LinTO, par OBS** : la source audio choisie est une source OBS
  (`coreaudio_input_capture` sur macOS, `pulse_input_capture` sur Linux, ou l'audio de la carte de
  capture) et OBS l'envoie lui-même au canal de la session via sa sortie de diffusion configurée
  sur le `streamEndpoints` du canal (SRT de préférence, sinon RTMP). L'appli ne touche pas à l'audio.
  Seule cette source est routée vers la sortie (les autres pistes sont coupées). Démarrer = lancer la
  diffusion OBS ; Arrêter = l'arrêter.
  *Risque à tester dès le début* : que le transcripteur LinTO accepte un flux OBS (audio + vidéo
  minimale). Plan B : l'appli envoie l'audio en PCM 16 kHz sur l'endpoint `ws` (seule entorse au
  « l'appli ne touche pas aux médias », à valider avec Camille si on en arrive là).
  Comme les `streamEndpoints` ne sont visibles que du propriétaire ou d'un MEETING_MANAGER, si une
  session réutilisée ne les expose pas, l'appli affiche les sous-titres mais signale qu'elle ne peut
  pas envoyer l'audio.
- **Session** : recherche par nom exact parmi `ready | active | paused | on_schedule` → réutilisée.
  Sinon création (1 canal, profil de transcription choisi dans une liste, mémorisé ; visibilité
  `organization`). Orga et profil mémorisés pour les fois suivantes.
- **Fenêtre de l'appli** : 1) login, 2) réglages (session, orga, profil, entrée vidéo, entrée
  audio avec vumètre, écran de sortie), 3) « En direct » : aperçu de la sortie (images `GetSourceScreenshot` du programme OBS à
  ~5 i/s — c'est OBS qui produit l'image, l'appli ne fait que l'afficher), état de la session et des
  flux, dernière ligne transcrite, boutons Arrêter / Terminer la session / Changer de session.
- **Embarquement d'OBS**
  - macOS : OBS.app officiel copié tel quel dans le bundle (non re-signé — accepté tant que l'appli
    ne sert que sur le Mac de Camille ; compromis : il partage avec l'OBS perso le fichier
    `~/Library/Preferences/com.obsproject.obs-studio.plist`, qui reste après désinstallation), lancé directement
    (`Contents/MacOS/OBS`) avec `CFFIXED_USER_HOME=<données appli>/obs-home`. La re-signature avec
    un bundle id propre (pour supprimer le `.plist` résiduel et la collision avec l'OBS perso) est
    une étape ultérieure si on distribue l'appli.
  - Linux : AppImage unique contenant l'appli + un OBS 32.x compilé en CI (Ubuntu 24.04, navigateur
    CEF activé), lancé avec `XDG_CONFIG_HOME` / `XDG_CACHE_HOME` dans les données de l'appli.
- **Désinstallation** : bouton « Désinstaller » dans l'appli qui arrête OBS, efface toutes les
  données de l'appli (config OBS, cookies, token, cache, et sous macOS
  `~/Library/Preferences/com.obsproject.obs-studio.plist` *seulement si* aucun OBS perso n'est
  installé), puis met l'appli à la corbeille (macOS) / supprime l'AppImage (Linux). Mettre l'appli
  à la corbeille à la main ne déclenche rien sous macOS, d'où ce bouton. Toutes les données sont
  dans un seul dossier pour qu'un nettoyage manuel reste trivial (documenté).

## Laissé au builder

- Structure du code, découpage en modules, outillage de tests.
- Détails de style de l'overlay (police, taille) dans le cadre ci-dessus.
- Gestion fine des reconnexions socket.io / websocket OBS.
- Pipeline CI exact pour compiler OBS sous Linux.

## Ordre conseillé

Commencer par deux essais jetables qui peuvent remettre en cause l'architecture :
1. OBS caché (`--minimize-to-tray`) + projecteur plein écran sur un 2e écran, sous macOS.
2. OBS qui diffuse vers l'endpoint SRT/RTMP d'une session LinTO → la session passe `active` et des
   `final` arrivent.
