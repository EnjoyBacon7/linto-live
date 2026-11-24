# Suivre une session envoyée par un autre appareil — design (court)

## Intention

Un ordinateur A envoie l'audio d'une session LinTO. Un ordinateur B, sur LinTO Live, doit pouvoir afficher les
sous-titres de cette session (fenêtre de sortie OBS et fenêtre de sous-titres) sans envoyer son propre son, qui
entrerait en conflit avec celui de A. Peu importe qui est à B ni avec quel compte.

## Buts / non-buts

- But : une session sélectionnée qui est en direct ailleurs peut être « suivie » : sous-titres, fenêtre de sortie,
  fenêtre de sous-titres, QR code, transcription, comme un direct normal, mais sans aucun envoi audio.
- Non-but : reprendre l'envoi à la place de A (B attend que A arrête, puis Démarrer redevient possible).
- Anti-but : B qui envoie son micro par erreur sur une session déjà alimentée.

## Approches

- **A (retenue)** — Le bouton principal devient « Suivre » quand la session choisie est `active` dans la liste et
  que ce n'est pas ce poste qui l'envoie. Un clic de plus, mais parcourir la liste ne change jamais ce qu'affiche
  la sortie.
- B — Suivre automatiquement à la sélection. Écartée : cliquer dans la liste changerait la sortie sous les yeux,
  donc seulement possible hors direct ; cas particulier pour peu de gain.

## Design

- **Renderer** (`MainWindow.tsx`, `Toolbar.tsx`) : `follow = statut de la session choisie === 'active'` (hors
  session en cours ici). Le bouton s'intitule « Suivre » ; le micro n'est pas exigé pour suivre (pas de « Choisis un
  micro. »). `live.start(name, …, { follow: true })` porte l'intention explicitement.
- **Main** (`live.ts` `doStart`) : avec `follow`, `cur.service = null` comme aujourd'hui sans droit d'envoi, mais
  `stream: 'following'` (nouvel état) et aucun avertissement « Impossible d'envoyer l'audio ». Les sous-titres,
  l'historique, l'overlay, le QR, l'enregistrement ou la diffusion suivent les réglages comme pour un direct normal.
  L'intention vient du renderer plutôt que d'une relecture du statut : juste après un Arrêter ici, LinTO peut encore
  dire `active` et ce poste ne doit pas se mettre à suivre sa propre session.
- **Barre d'outils** : légende « suivie — audio envoyé par un autre appareil » à la place de « réutilisée ».
- **A s'arrête puis reprend** : B reste en suivi, les sous-titres reprennent seuls (le socket reste ouvert).
- **Arrêter** sur B arrête le suivi ; rien n'est envoyé à LinTO.

## Laissé au développeur

- Libellés exacts, icône du bouton Suivre, entrée du menu/plateau correspondante.
- Tests : `doStart` en mode suivi (pas de `startStream`, état `following`, pas d'avertissement), et le choix du
  libellé côté renderer.
