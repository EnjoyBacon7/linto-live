# LinTO Live v2 — appli native et sous-titres LinTO — design

*2026-11-09 — Camille Bizeul. Complète [`2026-11-06-linto-live-design.md`](2026-11-06-linto-live-design.md) :
tout ce qui n'est pas modifié ici reste valable (OBS moteur vidéo caché, login SSO, même nom ⇒ même
session, Arrêter ≠ Terminer, désinstallation complète, Linux en v1).*

## Intention

La v1 marche (essai réel du 2026-11-09 : OBS → LinTO en SRT, sous-titres exacts), mais :

1. **L'appli est « hideuse » et fait « appli web »** : un formulaire sombre générique dans une
   fenêtre, qui ne profite pas d'être une vraie appli installée sur l'ordinateur.
2. **Les sous-titres incrustés ne ressemblent pas à ceux de la page LinTO**, que Camille et ses
   clients connaissent.
3. **Le choix de l'écran de sortie est inutile** : Camille préfère que « Démarrer » fasse apparaître
   une fenêtre qu'elle place elle-même où elle veut (typiquement : glissée sur l'écran HDMI).

## Objectifs

1. **Une appli qui se comporte comme une appli macOS** (et proprement sous Linux) : fenêtre native,
   barre latérale, menus, raccourcis clavier, icône dans la barre des menus, notifications système,
   thème clair/sombre du système.
2. **Sous-titres identiques à la page LinTO** (rendu et comportement, voir plus bas).
3. **Sortie = une fenêtre OBS que l'utilisateur place** ; plus aucun choix d'écran dans l'appli.

## Non-objectifs

- Réécrire l'appli dans un toolkit natif (SwiftUI, GTK…) : on garde Electron + React pour garder
  Linux et le code existant (process principal, OBS, LinTO, tests).
- Le filigrane (watermark) de la page LinTO, les traductions, le choix de taille de police par
  l'utilisateur.
- Plusieurs fenêtres de sortie.

## Anti-objectifs

- Une interface qui ressemble encore à une page web (formulaire centré, boutons HTML génériques,
  police web, couleurs fixes qui ignorent le thème du système).
- Des sous-titres qui « sautent » (texte entier réaffiché à chaque mot, lignes qui se recoupent
  différemment à chaque correction du moteur).
- L'appli qui compose ou dessine l'image de sortie elle-même : la sortie reste le projecteur OBS
  (la page de sous-titres reste une source navigateur **dans** OBS).
- Une fenêtre OBS autre que le projecteur visible (interface principale, dialogues).

## Décidé avec Camille

- Direction « vraie appli de bureau » validée sur maquette (2026-11-09) : barre latérale avec les
  sessions, barre d'outils avec l'état du direct, aperçu de la sortie, panneau de réglages à droite,
  barre d'état, icône dans la barre des menus.
- **Pas de choix d'écran de sortie.** « Démarrer » ouvre une **fenêtre projecteur OBS** (projecteur
  fenêtré du programme) que l'utilisateur déplace et redimensionne où il veut.
- Sous-titres : reproduire ceux de la page LinTO.

## Sous-titres : le modèle à reproduire

Référence : linto-studio, `studio-frontend/src/components/SessionSubtitle.vue`,
`models/SubtitleDrawer.js`, `tools/splitPartialSubtitles.js` (licence **AGPL-3.0** : on
**réimplémente** le comportement, on ne copie pas les fichiers).

Rendu LinTO :
- **Bandeau noir opaque** sur **toute la largeur**, collé en **bas** de l'image.
- **Exactement 2 lignes**, texte **blanc**, police **Arial**, **alignées à gauche** avec une marge
  horizontale fixe (100 px pour une page web ; à l'échelle du canvas 1920×1080).
- Hauteur de ligne = 1,2 × taille de police ; hauteur du bandeau = 2,4 × taille de police.

Comportement LinTO :
- Le texte en cours (partial) s'écrit sur la ligne du bas ; quand une ligne est pleine
  (mesure de la largeur réelle du texte), elle **monte** et une nouvelle ligne commence en bas.
  On voit donc toujours l'avant-dernière ligne et la dernière.
- Les **coupures de ligne sont stables** : quand le moteur corrige des mots d'un partial, on
  compare l'ancien et le nouveau texte mot à mot et on décale les coupures au lieu de tout
  recouper — une ligne déjà affichée ne se reformate pas.
- Quand un `final` arrive, il remplace le partial puis devient « l'état précédent » : la ligne
  suivante démarre sous la dernière ligne de ce final.
- Pas de distinction visuelle partial/final (pas de grisé).

Choix (le mien, accepté par Camille le 2026-11-09 en attendant de juger sur pièce) : le bandeau
**n'apparaît qu'au premier mot transcrit** du direct, puis **reste affiché** (comme sur la page
LinTO) jusqu'à Arrêter ; taille de police **48 px** sur le canvas 1080p (lisible sur un
vidéoprojecteur ; la page LinTO utilise 40 px par défaut dans un navigateur), bandeau collé en bas,
par-dessus la vidéo. Réglable plus tard si besoin, pas d'interface pour ça en v2.

## La sortie : fenêtre projecteur

- « Démarrer » lance le direct (audio → LinTO, sous-titres) et **ouvre le projecteur fenêtré** du
  programme OBS (`OpenVideoMixProjector` sans `monitorIndex`). Il apparaît une fois par lancement
  d'OBS ; s'il est déjà ouvert, Démarrer n'en ouvre pas un second.
- L'utilisateur le place où il veut. Pour le plein écran, il utilise le menu clic droit du
  projecteur OBS (« Plein écran » → écran) — **à vérifier par le builder** sur OBS 32.1 macOS et
  Linux ; si ce menu n'existe pas, le dire avant de construire un contournement.
- « Arrêter » : la fenêtre **reste ouverte** à sa place et passe au noir (comme aujourd'hui la sortie
  passe au noir) ; « Démarrer » suivant réaffiche l'image dans la même fenêtre.
- Si l'utilisateur ferme le projecteur : bouton / menu **« Afficher la fenêtre de sortie »** (⌘1)
  qui en rouvre un. L'appli ne sait pas forcément détecter la fermeture (aucune requête
  obs-websocket ne liste les projecteurs) : le builder évalue une détection côté système
  (liste des fenêtres) ; à défaut, le bouton est toujours disponible pendant le direct, et un
  double projecteur est accepté plutôt qu'aucun.
- Position mémorisée d'une fois sur l'autre : **souhaitable, pas obligatoire**. Le builder évalue
  `projectorGeometry` (obs-websocket) + une source de géométrie fiable ; si ce n'est pas fiable,
  on s'en passe.
- **À supprimer** : choix de l'écran (réglages et direct), « Changer d'écran », état
  « écran introuvable », surveillance branchement/débranchement des écrans, relance d'OBS pour
  changer d'écran. (Ce qui fait disparaître les défauts connus liés au HDMI de la v1.)

## L'appli : structure de la fenêtre

Une seule fenêtre principale, mise en page type appli macOS (maquette validée) :

- **Barre de titre intégrée** (boutons de fenêtre dans la barre latérale, pas de barre de titre
  séparée) ; **barre latérale translucide** (vibrancy) sous macOS, unie sous Linux.
- **Barre latérale — Sessions** : sessions non terminées de l'organisation (nom + pastille d'état :
  en direct / prête / en pause / planifiée), triées par activité récente, + « Nouvelle session… ».
  Choisir une session = la sélectionner pour le direct (même logique de réutilisation que la v1).
  *Mes choix :* la liste montre **toutes** les sessions non terminées de l'organisation, y compris
  celles créées dans LinTO Studio par d'autres ; celles vers lesquelles l'appli ne peut pas envoyer
  le son (pas d'endpoint SRT/RTMP visible) sont affichées grisées avec la raison, et ne peuvent pas
  être démarrées. « Nouvelle session… » ne demande que le **nom** et le **profil de transcription**
  et ne crée rien tout de suite : la session est créée sur LinTO au **Démarrer** (comme la v1), pour
  ne pas laisser de sessions vides. Taper un nom existant renvoie sur la session existante (pas de
  doublon). Le profil n'apparaît donc que pour une nouvelle session ; pour une session existante il
  est affiché en lecture seule.
  Pendant le direct, cliquer une autre session demande « Basculer le direct sur … ? » puis bascule
  sans couper la fenêtre de sortie (le « Changer de session » de la v1).
  En bas : instance + compte, menu (changer d'organisation si plusieurs, se déconnecter).
- **Barre d'outils** : nom de la session (et « réutilisée » / « nouvelle »), bouton principal
  **Démarrer** / pastille **EN DIRECT + durée** qui devient **Arrêter**, et **Terminer…**
  (confirmation, comme la v1).
- **Zone centrale** : aperçu de la sortie programme d'OBS (comme la v1, images produites par OBS),
  visible **dès qu'une caméra est choisie**, pas seulement en direct, pour vérifier le cadrage
  avant de démarrer. Légende « Sortie OBS — ce qui s'affiche dans la fenêtre de sortie ».
- **Panneau de droite (réglages)** : Caméra, Micro (+ vumètre), Profil de transcription (voir
  ci-dessus). Modifiable
  hors direct ; pendant le direct, changer caméra/micro s'applique à chaud si OBS le permet sans
  couper, sinon les champs sont verrouillés (au choix du builder, à dire).
- **Barre d'état** : LinTO reçoit le son · Sous-titres · OBS, chacun avec pastille d'état
  (vert / orange / rouge) et texte court ; dernière ligne transcrite si la place le permet.
- **Bannières** d'erreur/avertissement (OBS relancé, session expirée…) en haut de la zone centrale,
  sobres, natives d'aspect.
- **Écran de connexion** : même charte (fenêtre native, logo LinTO, champ instance, boutons SSO,
  email/mot de passe) — pas un formulaire web centré.

### Ce qui fait « appli de bureau »

- **Menus de l'application** (macOS : barre des menus ; Linux : menu de fenêtre) : Session
  (Nouvelle ⌘N, Démarrer ⌘↩, Arrêter ⌘., Terminer…), Fenêtre (Afficher la fenêtre de sortie ⌘1),
  Compte (Se déconnecter), Aide, Désinstaller (déplacé ici depuis l'interface).
- **Icône dans la barre des menus** (Tray) : pastille d'état ; menu : état du direct + session,
  Démarrer/Arrêter, Afficher la fenêtre de sortie, Afficher LinTO Live, Quitter. Fermer la fenêtre
  principale pendant le direct **ne coupe pas** le direct (la fenêtre se cache ; l'appli reste dans
  la barre des menus) ; Quitter = Arrêter (comme la v1, avec la confirmation existante).
- **Notifications système** : son plus reçu par LinTO, sous-titres coupés, OBS relancé,
  session expirée — seulement quand la fenêtre n'est pas au premier plan.
- **Thème** : suit clair/sombre du système ; police système (SF Pro sur macOS, celle du bureau sous
  Linux) ; couleur d'accent **vert LinTO `#11977c`** pour l'action principale et les sélections ;
  rouge système pour « EN DIRECT ».
- Contrôles d'aspect natif (listes déroulantes, champs, boutons, segmented control) ; tailles,
  espacements et typographie suivant les conventions macOS (Human Interface Guidelines) ;
  pas de largeur figée « carte web ».
- Fenêtre redimensionnable avec taille minimale ; position/taille mémorisées.

## Linux

Même structure. Pas de vibrancy (fond uni), barre de titre du système si l'intégration n'est pas
fiable, menus dans la fenêtre, icône de zone de notification si l'environnement de bureau la
supporte (sinon pas d'icône, la fenêtre reste le point d'entrée). Notifications via le système.

## Laissé au builder

- Découpage des composants React, CSS (pas de framework UI web imposé ; si une lib est utilisée,
  elle doit donner un rendu natif, pas « Material »/« Bootstrap »).
- Icônes (SF Symbols-like en SVG), logo LinTO (récupérer celui de studio.linto.ai).
- Implémentation du découpage stable des lignes (diff mot à mot) et mesure du texte dans la page
  overlay (canvas ou DOM, au choix, tant que le rendu est celui décrit).
- Détection de fermeture du projecteur, mémorisation de sa position (voir plus haut).
- Évolution de `LiveState` (suppression de l'état « écran »).

## Vérifications attendues

- Capture de chaque écran (connexion, sessions/réglages, direct) en clair et en sombre, montrée à
  Camille.
- Overlay : test automatisé du découpage de lignes (partials qui corrigent des mots, final, lignes
  pleines) + capture de la sortie OBS avec l'essai audio synthétique (`spikes/stream-to-linto.mjs`,
  `SPIKE_AUDIO_FILE`) pour comparer à la page LinTO.
- Projecteur fenêtré : s'ouvre au Démarrer, reste à sa place sur Arrêter/Démarrer, se rouvre avec ⌘1.
