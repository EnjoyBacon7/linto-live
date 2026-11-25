# LinTO Live — position de la bande de sous-titres — design

*2026-11-25 — Camille Bizeul. Petit ajout.*

## Intention

Dans l'image de sortie (projetée, enregistrée, diffusée), la bande de sous-titres est collée en bas.
Selon ce qui est filmé ou partagé (bas de diapositive, bandeau, sous-titres déjà présents), elle gêne :
on veut pouvoir la remonter, jusqu'en haut de l'image.

## Approches

- **A — curseur de position dans l'inspecteur (retenue, choix de Camille).** Placement libre de 0 %
  (en bas, comme avant) à 100 % (en haut), l'aperçu suit en direct.
- B — glisser la bande dans l'aperçu, avec des positions prédéfinies : plus direct mais plus de code
  (l'aperçu est une image d'OBS, pas la page) ; écarté.
- C — menu Bas / Milieu / Haut seul : pas de placement libre ; écarté.

## Ce qui est décidé

- Réglage local `subtitlePosition` (entier 0–100, défaut 0), section « Sous-titres » de l'inspecteur,
  sous la taille ; double-clic : retour en bas.
- La bande garde toute la largeur : seule sa hauteur dans l'image change (0 = bord bas, 100 = bord haut).
- La fenêtre « sous-titres seuls » n'est pas concernée (elle se déplace déjà librement).
- *Choix du constructeur :* quand la bande passe dans la moitié haute, le QR code (en haut à droite)
  descend en bas à droite, pour ne jamais se chevaucher ; sans sous-titre à l'écran, la bande vide
  apparaît 2 s quand on la déplace, pour voir où elle se pose.
