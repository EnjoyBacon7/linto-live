# Journal des modifications

Toutes les modifications notables de LinTO Live sont consignées ici.
Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet respecte le
[versionnage sémantique](https://semver.org/lang/fr/).

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

[0.2.0]: https://github.com/EnjoyBacon7/linto-live/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/EnjoyBacon7/linto-live/releases/tag/v0.1.0
