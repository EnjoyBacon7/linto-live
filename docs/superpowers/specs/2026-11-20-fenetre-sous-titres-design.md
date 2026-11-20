# LinTO Live — fenêtre « sous-titres seuls » — design

*2026-11-20 — Camille Bizeul. Petit ajout ; tout le reste de
[`2026-11-13-langues-qr-sources-enregistrement-design.md`](2026-11-13-langues-qr-sources-enregistrement-design.md)
reste valable.*

## Intention

Pouvoir poser les sous-titres en direct **par-dessus n'importe quoi** (diapositives, visio, écran de
scène) sans passer par la sortie OBS complète : une fenêtre sans barre de titre, qui ne contient que la
bande de sous-titres, **toujours au premier plan**, que l'on place et dimensionne où l'on veut.

## Objectifs

1. Un bouton dans la barre d'outils, **à côté du bouton « fenêtre de sortie »**, ouvre et ferme
   (bascule) la fenêtre de sous-titres.
2. La fenêtre n'a pas de cadre, reste au-dessus des autres applications, se déplace en la saisissant
   n'importe où et se redimensionne par ses bords.
3. Elle montre exactement ce qui part à l'antenne : mêmes sous-titres, même watermark, mêmes remises à zéro.

## Non-objectifs

- Pas de QR code dans cette fenêtre (il appartient à l'image de sortie).
- Pas de fond transparent ni de clics traversants : la bande reste noire, lisible sur tout fond.
- Pas de réglages propres à la fenêtre (police, couleurs) dans cette version.

## Contraintes

- **GNOME sous Wayland** ne laisse pas une appli se mettre au premier plan d'elle-même : Electron ignore
  `alwaysOnTop`. On le documente (clic droit sur la fenêtre → « Toujours au premier plan ») ; pas de
  contournement par XWayland.
- La page de sous-titres vit sur le serveur local à jeton (`127.0.0.1`, `?k=`) ; la fenêtre la charge
  comme OBS, sans preload ni Node, dans le cadre des règles de `security.ts`.

## Approches

- **A — fenêtre Electron sans cadre qui charge la page de sous-titres existante (retenue).** Réutilise le
  serveur, le WebSocket, le découpage des lignes et le watermark : rien de nouveau côté sous-titres,
  aucune dérive possible avec ce que montre OBS. Coût : un mode « fenêtre » dans la page et une fenêtre
  de plus dans `main.ts`.
- B — écran React alimenté par IPC : dupliquerait `layout.js`/`watermark.js` et un second canal de
  sous-titres ; écarté.
- C — second projecteur OBS : barre de titre imposée, ni sans cadre ni premier plan pilotables ; écarté.

## Ce qui est décidé

- **Page :** paramètre `mode=window` dans l'URL. Dans ce mode la page n'a plus la toile 1920×1080 : la
  bande remplit toute la fenêtre, la taille de police découle de la **hauteur** de la fenêtre (2 lignes
  à 1,2 × la police) et non du réglage de l'appli, et les lignes se calent sur la **largeur réelle**
  (recalcul au redimensionnement). Le QR code est ignoré. Le watermark suit la session comme à l'antenne.
- **Sans sous-titre**, la bande noire reste affichée (vide) pour qu'on puisse placer la fenêtre.
- **Fenêtre :** `frame: false`, `alwaysOnTop` (niveau « floating » au-dessus des applis en plein écran
  sur macOS, visible sur tous les bureaux), redimensionnable, taille minimale raisonnable, pas dans la
  barre des tâches, fond noir. Toute la page est zone de glissement ; une petite croix de fermeture
  apparaît au survol, et Échap ferme aussi.
- **Position et taille** mémorisées dans les réglages et réutilisées à la réouverture (ramenées sur un
  écran visible si l'écran a disparu). Par défaut : centrée en bas de l'écran principal, environ
  960 × 120.
- **Bouton :** icône « sous-titres », libellé accessible « Afficher la fenêtre de sous-titres » /
  « Fermer la fenêtre de sous-titres » (état pressé), actif dès que le serveur de sous-titres tourne,
  à l'antenne ou non. Fermer la fenêtre par la croix remet le bouton à l'état non pressé. La fenêtre se
  ferme avec l'appli.

## Laissé au constructeur

Valeurs exactes (taille minimale, marges internes, dessin de l'icône), forme de l'IPC
(ouvrir/fermer + événement d'état), clé de réglage, tests (rendu de la barre d'outils, mode fenêtre de la
mise en page, restauration des bornes).
