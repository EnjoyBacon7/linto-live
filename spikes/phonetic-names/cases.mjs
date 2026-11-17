// Invented mishearings (no real LinTO transcript yet). `want`: expected output; same as `text` => no change.
export const NAMES = [
  'Camille Bizeul',
  'Bizeul',
  'Linagora',
  'LinTO',
  'Michel Rocard',
  'Saint-Brieuc',
  'Quimper',
  'Anne Hidalgo',
  'Macron',
  'Thiers',
  'Jean-Luc Mélenchon',
  'Plougastel-Daoulas',
  'Kerjean'
]

export const CASES = [
  // Should be corrected
  { text: 'Merci à camille biseul pour son intervention.', want: 'Merci à Camille Bizeul pour son intervention.' },
  { text: 'Je passe la parole à Bise œil.', want: 'Je passe la parole à Bizeul.' },
  { text: 'chez lina gora nous développons', want: 'chez Linagora nous développons' },
  { text: "l'équipe de linnagora est là", want: "l'équipe de Linagora est là" },
  { text: 'le logiciel linto est libre', want: 'le logiciel LinTO est libre' },
  { text: 'Michel roquard était premier ministre', want: 'Michel Rocard était premier ministre' },
  { text: 'on se retrouve à saint brieu demain', want: 'on se retrouve à Saint-Brieuc demain' },
  { text: 'la maire anne idalgo a déclaré', want: 'la maire Anne Hidalgo a déclaré' },
  { text: 'jean luc mélanchon prend la parole', want: 'Jean-Luc Mélenchon prend la parole' },
  { text: 'nous partons pour plougastel daoulas', want: 'nous partons pour Plougastel-Daoulas' },
  { text: "d'Hidalgo à macron", want: "d'Hidalgo à Macron" },
  { text: 'au château de kerjan', want: 'au château de Kerjean' },
  // Must NOT be changed (everyday words that sound like a name)
  { text: 'une macro dans le tableur', want: 'une macro dans le tableur' },
  { text: 'un manteau marron', want: 'un manteau marron' },
  { text: 'le tiers des votants', want: 'le tiers des votants' },
  { text: "je lui fais une bise sur l'œil", want: "je lui fais une bise sur l'œil" },
  { text: 'une tierce personne', want: 'une tierce personne' },
  { text: 'un camping près de la plage', want: 'un camping près de la plage' },
  { text: 'il faut le lire en entier', want: 'il faut le lire en entier' },
  { text: 'ils ont gagné un camembert', want: 'ils ont gagné un camembert' },
  { text: 'le quai en pierre', want: 'le quai en pierre' },
  { text: 'Merci à tous et à toutes', want: 'Merci à tous et à toutes' }
]
