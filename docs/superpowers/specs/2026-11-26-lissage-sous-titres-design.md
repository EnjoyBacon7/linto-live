# LinTO Live — lissage des sous-titres — design

*2026-11-26 — Camille Bizeul. Petit ajout.*

## Intention

La bande de sous-titres affiche chaque partiel de LinTO dès qu'il arrive : le texte avance par à-coups, les
lignes défilent tantôt vite tantôt lentement, et en traduction les mots changent de place sous les yeux du
public tant que la phrase n'est pas finie. On veut un curseur qui échange de la latence contre une lecture
plus calme : défilement régulier des lignes, mots traduits qui ne bougent plus à l'écran.

- **Objectifs** : un seul réglage ; à 0 rien ne change par rapport à aujourd'hui ; plus on monte, plus c'est
  stable et régulier, au prix d'un retard borné par le réglage.
- **Non-objectifs** : la transcription de l'application (Stage) et l'export ne sont pas lissés (vue de
  l'opérateur, textes bruts).
- **Anti-objectif** : un retard qui grossit sans fin quand l'orateur parle vite.

## Approches

- **A — lisseur dans le processus principal (retenue, choix de Camille).** Entre le routage de langue et la
  bande : un mot n'entre dans la file d'affichage qu'une fois stable pendant le délai (ou son segment final),
  puis la file libère les mots à un rythme régulier. La sortie OBS et la fenêtre sous-titres reçoivent le même
  flux lissé ; testable avec des horloges factices.
- B — même logique dans la page de la bande (`layout.js`) : chaque client aurait ses minuteries et pourrait
  diverger, logique temporelle dans du JS sans typage ; écarté.
- C — traductions en finals seulement + rythme des lignes : masque tout, mais une phrase traduite n'apparaît
  qu'une fois dite, même curseur à 0 ; contredit l'échange réglable ; écarté.

## Ce qui est décidé

- Curseur « Lissage » dans la section « Sous-titres » de l'inspecteur, sous « Position ».
- Le lisseur s'applique au flux routé (original, traduction, sous-titres croisés) avant `overlay.push` ;
  les finals restent seuls à porter les corrections de noms propres, comme aujourd'hui.
- Stabilité : un mot du partiel courant n'est admis qu'après être resté identique (même mot, même rang)
  pendant le délai ; un final ferme le segment sans raccourcir le délai de ses mots.
- *Révisé le 2026-11-26 :* rythme : la bande est une ligne à retard. Chaque mot sort exactement le délai
  après avoir pris sa valeur (un final ne raccourcit pas le délai) : la bande suit le rythme de la parole,
  toujours le délai en retard, sans file ni rattrapage. Un mot déjà affiché le reste ; une correction
  ultérieure le remplace sur place. La vitesse max. (curseur séparé) borne ce rythme en plus.
- *Remplacé :* les mots admis sortaient un par un à intervalle régulier ; si la file s'allongeait, l'intervalle se
  raccourcit pour que la file se vide dans le délai — le retard reste borné par le réglage.

## Choix du constructeur (à relire)

- Réglage local `subtitleSmoothingMs` (entier 0–10000, pas de 250 ms, **défaut 0** = comportement actuel) ;
  affiché « Direct » à 0, sinon « 1,5 s » ; double-clic : retour à 0. Appliqué à chaud aux mots suivants.
- Le lisseur envoie à la bande les mêmes messages qu'aujourd'hui (`partial` = préfixe libéré du segment,
  `final` = segment entier une fois tous ses mots libérés) : `layout.js` et la page ne changent pas.
- Si un final diffère de mots déjà affichés (rare : un mot stable corrigé ensuite), la bande prend la version
  finale à la sortie suivante, sans effacer la ligne.
- Effacement (LinTO ou fin d'émission), `reset`, changement de langue des sous-titres : la file est vidée,
  minuteries annulées.
- Rythme de base : ~ 4 mots/s quand la file est courte (débit de parole), accélération au-delà.
