# LinTO Live v0.4 — langues, QR code, sources vidéo de secours, enregistrement — design

*2026-11-13 — Camille Bizeul. Complète [`2026-11-09-linto-live-v2-ui-native-design.md`](2026-11-09-linto-live-v2-ui-native-design.md) :
tout ce qui n'est pas modifié ici reste valable (OBS caché, projecteur fenêtré, sous-titres façon page LinTO,
session créée au Démarrer, même nom ⇒ même session).*

## Intention

LinTO Live sert en salle : une caméra ou un mélangeur (aujourd'hui un **ATEM Mini Pro** en USB) part
vers le vidéoprojecteur avec les sous-titres LinTO incrustés. Il manque quatre choses :

1. **Plusieurs langues de sous-titres.** Le public n'a pas tous la même langue : la session doit
   être traduite dans plusieurs langues, comme LinTO Studio le permet, et chacun choisit la sienne
   sur son téléphone depuis la page publique LinTO. La bande incrustée, elle, n'affiche qu'une
   langue, choisie dans l'appli.
2. **Un QR code dans l'image de sortie**, qui mène à cette page publique : c'est ce qui rend les
   langues utiles au public.
3. **Une source de secours.** L'ATEM envoie une **image noire** quand son entrée est vide (orateur
   qui débranche son portable) : la sortie doit alors basculer sur une autre source (caméra de
   salle, image fixe, vidéo en boucle) puis revenir dès que l'image principale revient.
4. **Enregistrer** l'audio et la vidéo de la sortie sur le disque.

## Objectifs

1. Choisir, à la création d'une session, **plusieurs langues de traduction** (celles que le profil
   de transcription propose) et la **visibilité** de la session.
2. Choisir, pendant ou avant le direct, la **langue affichée** dans la bande : originale, une des
   traductions de la session, ou les sous-titres croisés de LinTO Studio (voir § 1).
3. Afficher dans la sortie un **QR code** vers la page publique de la session : par intermittence,
   ou en permanence (épinglé).
4. **Source principale + source de secours**, chacune : périphérique vidéo, image fixe ou vidéo.
   Bascule automatique sur la secours quand la principale est absente ; option (case à cocher) :
   un **écran noir compte comme absent**.
5. **Enregistrer la sortie complète** (image avec sous-titres, QR code, bascules ; son du micro)
   dans un fichier sur le disque.

## Non-objectifs

- Un enregistrement « propre » sans les incrustations (pas de deuxième chaîne de sortie).
- Plus de deux sources, un mélangeur, des transitions, de l'incrustation image dans l'image.
- Changer les langues de traduction ou la visibilité d'une **session existante** depuis l'appli
  (cela reste dans LinTO Studio).
- Un QR code vers autre chose que la page publique LinTO de la session.
- Le son des fichiers vidéo utilisés comme source (toujours coupé).

## Anti-objectifs

- Une sortie qui **clignote** entre les deux sources (seuils et délais trop courts, fondus qui
  « bégaient »).
- La bascule qui **endort l'ATEM** (source principale désactivée par OBS quand on la masque, donc
  impossible de savoir qu'elle est revenue).
- Un QR code qui mène à une page de connexion LinTO sans que l'utilisateur en soit prévenu.
- Changer la visibilité d'une session LinTO dans son dos.
- Un enregistrement perdu en entier si l'appli ou OBS plante.

## Approches retenues

| Partie | Retenu | Écarté, et pourquoi |
|---|---|---|
| QR code | **A. Dessiné dans la page de sous-titres** (source navigateur OBS existante), généré par une petite bibliothèque, même mécanique d'intermittence que le filigrane. *Choisi par Camille.* | B. Image PNG générée par l'appli + source image OBS montrée/masquée par un minuteur côté appli : doublon du cycle du filigrane, une source de plus à ordonner. |
| Bascule | **Capture d'écran minuscule de la source principale** (`GetSourceScreenshot`) toutes les ~500 ms depuis l'appli, luminosité calculée par l'appli ; secours **au-dessus** de la principale et rendue visible quand la principale est absente. *Mon choix.* | Script Lua/Python OBS : ne lit pas les pixels. Plugin OBS compilé : à maintenir pour macOS et Linux. Masquer la principale : OBS peut désactiver le périphérique, on ne voit plus son retour. |
| Enregistrement | **Enregistreur intégré d'OBS** (`StartRecord`/`StopRecord`), dossier et format réglés par l'API. *Mon choix.* | Sortie supplémentaire ou ffmpeg externe : inutile, la sortie complète suffit. |
| Langues / visibilité | **Les mêmes appels API que LinTO Studio** (`translations` et `visibility` à la création ; événement socket `translation` pour les traductions). *Mon choix.* | — |

## 1. Langues de sous-titres et visibilité

### Ce que fait LinTO Studio (référence, AGPL : on réimplémente)

- Un profil de transcription a ses langues parlées (`config.languages[].candidate`) et ses
  traductions possibles (`config.availableTranslations`, normalisées par
  `tools/translationUtils.js`) ; à la création, l'utilisateur coche les traductions voulues et
  Studio envoie `channels[0].translations` (codes de langue) — voir
  `components/TranscriberProfileSelector.vue`, `SessionCreateContent.vue`.
- Page de direct : sélecteur `SessionTranslationSelection.vue` avec « Langue originale »,
  « Sous-titres croisés » (si le canal y est éligible) puis chaque traduction triée par nom
  (`Intl.DisplayNames`).
- **Sous-titres croisés** (`tools/getTextTurnWithTranslation.js`, `isQualifiedForCrossSubtitles`) :
  **une seule langue à l'écran à la fois**, chaque segment est affiché dans *l'autre* langue d'un
  canal bilingue (un passage dit en français apparaît en anglais et inversement). Proposé
  seulement si le profil parle exactement deux langues et que chacune a sa traduction. On
  reproduit ce mode tel quel : la bande garde ses deux lignes, pas de bande bilingue empilée.
- Les traductions arrivent sur le même socket que `partial` / `final`, événement **`translation`**
  (`services/websocket/ApiEventWebSocket.js`). **Le builder relève la forme exacte du message**
  (langue, segment, partial/final) sur le code de Studio ou une vraie session avant de coder.
- Visibilité (`views/SessionSettings.vue`) : `private`, `organization`, `public`, et « mot de
  passe » (envoyé comme `public` + mot de passe : le builder relève le champ exact).

### Dans l'appli

- **« Nouvelle session… »** gagne :
  - **Traductions** : liste à cocher des traductions du profil choisi (nom de langue en français
    via `Intl.DisplayNames`), aucune par défaut ; masquée si le profil n'en propose pas.
  - **Visibilité** : Organisation (défaut, comportement actuel) / Public / Protégée par mot de
    passe (+ champ mot de passe) / Privée.
  - Ces choix sont gardés avec la session en attente (comme le profil) et envoyés à
    `createSession` au Démarrer. Le mot de passe n'est **pas** enregistré dans les réglages.
  - Un nom qui existe déjà renvoie, comme aujourd'hui, sur la session existante : les champs
    Traductions / Visibilité ne s'appliquent donc qu'à une vraie création. Les traductions et la
    visibilité affichées ailleurs (langue affichée, note du QR code) sont toujours **celles de la
    session sur LinTO** (`getSession` : ajouter `visibility` et les `translations` du canal au
    modèle `Session`), jamais celles saisies dans la feuille.
- **Panneau de droite, groupe Sous-titres** : menu **« Langue affichée »** : Originale, chaque
  traduction de la session, et Sous-titres croisés quand LinTO le permet pour ce canal (le
  builder reprend la règle d'éligibilité de Studio). Changeable en direct : la bande se vide
  (comme « Effacer les sous-titres ») et repart dans la nouvelle langue. Mémorisé **par session**
  dans les réglages locaux, Originale par défaut.
- La transcription affichée dans la fenêtre principale reste la **langue originale** (mon choix :
  c'est le contrôle de ce que dit l'orateur ; à revoir si besoin).

## 2. QR code dans la sortie

- Lien : `<instance>/interface/<orgId>/sessions/<alias ou id>` — comme `publicLink` de Studio
  (`mixins/sessionModel.js`, premier alias sinon l'id). Le builder vérifie comment lire les alias
  via l'API ; sans alias lisible, l'id suffit.
- **Panneau de droite, groupe Sous-titres** (ou un groupe « QR code » à côté, au choix du builder) :
  - **« Afficher le QR code »** : par intermittence, toutes les *N* s pendant *M* s ;
  - **« Épingler le QR code »** : toujours affiché (n'a d'effet que si la première est cochée,
    comme pour le filigrane).
  - *N* et *M* réglables (feuille « Paramètres du QR code… » sur le modèle du filigrane) ; défauts :
    mon choix, toutes les **60 s pendant 15 s**.
  - Réglages **locaux** à l'appli (pas sur la session LinTO, contrairement au filigrane).
- Rendu : dans la page de sous-titres, **coin en haut à droite**, environ **240 px** de côté sur le
  canvas 1080p, fond blanc avec marge (zone calme) pour être lisible au vidéoprojecteur ; ne
  recouvre jamais la bande de sous-titres. Apparition/disparition en fondu court. Affiché même
  si la bande de sous-titres est masquée.
- Si la session n'est **pas publique** (ni protégée par mot de passe), une note sous les cases :
  « Le public devra se connecter à LinTO pour ouvrir ce lien : rendre la session publique dans
  LinTO Studio. » L'appli ne modifie pas la visibilité.
- Bibliothèque : une bibliothèque QR **sous licence permissive** (MIT), servie par le serveur
  d'overlay comme les autres fichiers de la page ; le builder choisit (p. ex. `qrcode-generator`,
  celle de Studio, ou `qrcode`).

## 3. Source principale et source de secours

### Interface

Le groupe **Caméra** devient **Vidéo** :

- **Source principale** : Aucune / un périphérique vidéo / « Image… » / « Vidéo… » (sélecteur de
  fichier ; le nom du fichier s'affiche ensuite dans le menu).
- **Source de secours** : mêmes choix.
- **« Écran noir = source absente »** (case, cochée par défaut) — n'a de sens que si une source de
  secours est choisie.
- Indication de l'état : « À l'antenne : principale » / « À l'antenne : secours ».
- Migration : l'ancien `videoDeviceId` devient la source principale.

### Fonctionnement

- Deux entrées OBS dans la scène LinTO Live : principale en dessous, secours au-dessus (et la
  source des sous-titres tout en haut). Le type d'entrée suit le choix : périphérique
  (`macos-avcapture` / `v4l2_input`), image (`image_source`), vidéo (`ffmpeg_source`, en boucle,
  son coupé). Les deux sont mises à l'échelle 1920×1080 comme aujourd'hui.
- La principale **reste toujours visible** ; la bascule montre/masque **la secours**. La source de
  secours, si c'est un périphérique, peut donc s'endormir masquée : accepté (temps de réveil à
  mesurer par le builder ; s'il est gênant, garder la secours visible en opacité nulle ou
  équivalent).
- Toutes les ~500 ms (direct en cours ou non, dès qu'une secours est choisie) : capture
  `GetSourceScreenshot` de **l'entrée principale seule**, très petite (p. ex. 32 px de large).
  « Absente » si : erreur de capture, image vide, ou — option cochée — image **noire** (seuil de
  luminosité moyenne et maximale bas, à régler par le builder sur l'ATEM : son noir est en
  plage limitée, ~16/255). Une image fixe ou une vidéo comme principale n'est jamais « absente »
  sauf fichier illisible.
- Hystérésis : bascule sur la secours après **~2 s** d'absence continue, retour sur la principale
  après **~2 s** de présence continue. Transition : coupe franche ou fondu court, au choix du
  builder, tant que ça ne clignote pas.
- Sans source de secours : comportement actuel (rien ne bascule).
- Le contrôle s'arrête proprement quand OBS redémarre et reprend après.

## 4. Enregistrement

- Panneau de droite, nouveau groupe **Enregistrement** : case **« Enregistrer le direct »** et
  dossier (bouton « Choisir… », chemin affiché). Défaut : `~/Movies/LinTO Live` (macOS),
  `~/Vidéos/LinTO Live` ou dossier vidéo XDG (Linux).
- Case cochée : l'enregistrement démarre avec **Démarrer** et s'arrête avec **Arrêter** /
  **Terminer** ; un fichier par direct, nommé `<nom de session> <AAAA-MM-JJ HH-MM-SS>.mkv`
  (caractères interdits remplacés).
- Contenu : la sortie programme complète d'OBS + le son du micro (piste 1). **MKV** (résiste à un
  plantage). Qualité : réglages d'OBS raisonnables (encodeur matériel si disponible) — au choix du
  builder.
- Barre d'outils : pastille **« REC »** rouge pendant l'enregistrement. À l'arrêt, une notification
  « Enregistrement sauvegardé » avec un bouton pour afficher le fichier.
- Erreurs (disque plein, dossier inaccessible) : bannière d'avertissement, le direct continue.
- **OBS redémarre pendant le direct** : l'enregistrement reprend tout seul dans un **nouveau
  fichier** (suffixe « (2) », « (3) »…) — l'intention « enregistrer » est un état du
  LiveController qui survit au redémarrage, comme le flux. **Démarrer sur une autre session
  sans Arrêter** : on ferme le fichier en cours et on en ouvre un nouveau au nom de la nouvelle
  session. (Mes choix.)
- Cocher ou décocher la case en cours de direct ne change rien au direct en cours : la case vaut
  pour le prochain Démarrer (mon choix, plus simple et prévisible ; à revoir si besoin).

## Contraintes

- OBS 32.1 embarqué, piloté uniquement par obs-websocket (v5) ; macOS Apple Silicon et Linux
  x86_64 (deb, Flatpak, AppImage — le Flatpak doit pouvoir lire les images/vidéos et écrire le
  dossier d'enregistrement choisis : vérifier les permissions de fichiers du Flatpak).
- Interface en français, style natif existant (PopUp, Sheet, Check du panneau).
- Code de LinTO Studio sous AGPL : on réimplémente le comportement, on ne copie pas.
- Les tests existants (vitest, faux client OBS) couvrent les nouvelles parties côté processus
  principal : création de session, langue affichée, logique de bascule (seuils, hystérésis),
  démarrage/arrêt d'enregistrement.

## Laissé au builder

- Forme exacte de l'événement `translation`, du champ mot de passe de visibilité, de l'éligibilité
  aux sous-titres croisés, de la lecture des alias (à relever dans Studio ou sur une vraie session).
- Seuils de noir, période de capture, transition, réveil de la source de secours.
- Bibliothèque QR, mise en page exacte des réglages dans le panneau.
- Réglages d'encodage de l'enregistrement.
- Ordre de livraison : langues et visibilité → QR code → sources vidéo → enregistrement, chaque
  partie livrable seule.
