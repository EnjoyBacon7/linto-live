import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cleanNames, createNameCorrector, parseCommonWords } from '../../src/main/linto/properNouns'

const COMMON = parseCommonWords(readFileSync('resources/proper-nouns/fr-common-words.txt', 'utf8'))
const NAMES = [
  'Camille Bizeul', 'Bizeul', 'Linagora', 'LinTO', 'Michel Rocard', 'Saint-Brieuc', 'Quimper', 'Anne Hidalgo',
  'Macron', 'Thiers', 'Jean-Luc Mélenchon', 'Plougastel-Daoulas', 'Kerjean', 'Issy-les-Moulineaux', 'LINAGORA'
]
const correct = createNameCorrector(NAMES, COMMON)

describe('proper noun correction (experimental)', () => {
  it.each([
    ['Merci à camille biseul pour son intervention.', 'Merci à Camille Bizeul pour son intervention.'],
    ['chez lina gora nous développons', 'chez Linagora nous développons'],
    ["l'équipe de linnagora est là", "l'équipe de Linagora est là"],
    ['le logiciel linto est libre', 'le logiciel LinTO est libre'],
    ['Michel roquard était premier ministre', 'Michel Rocard était premier ministre'],
    ['on se retrouve à saint brieu demain', 'on se retrouve à Saint-Brieuc demain'],
    ['la maire anne idalgo a déclaré', 'la maire Anne Hidalgo a déclaré'],
    ['jean luc mélanchon prend la parole', 'Jean-Luc Mélenchon prend la parole'],
    ['nous partons pour plougastel daoulas', 'nous partons pour Plougastel-Daoulas'],
    ["d'Hidalgo à macron", "d'Hidalgo à Macron"],
    ['au château de kerjan', 'au château de Kerjean'],
    // LinTO's commas do not stop a name (real transcript, 2026-11-17).
    ['Ici, les Moulineaux.', 'Issy-les-Moulineaux.'],
    ['un étudiant à Issy-les-Moulineaux.', 'un étudiant à Issy-les-Moulineaux.'],
    // No elision before a consonant: LinTO's « l' » in front of a name is an error, even when the name is right.
    ["Je travaille chez l'LINAGORA.", 'Je travaille chez LINAGORA.'],
    ["l'équipe d'lina gora", "l'équipe de Linagora"],
    ["c'est ce qu'Macron a dit", "c'est ce que Macron a dit"],
    // Real transcript, 2026-11-17: a short name tolerates one vowel sound less; a right name never eats a neighbour.
    ["si je m'appelle Camille Bizzle, je travaille à Issy-les-Moulineaux chez LINAGORA.",
      "si je m'appelle Camille Bizeul, je travaille à Issy-les-Moulineaux chez LINAGORA."],
    ['merci monsieur Bizzle', 'merci monsieur Bizeul'],
    ['merci monsieur Bizzol', 'merci monsieur Bizeul']
  ])('corrects « %s »', (text, want) => {
    expect(correct(text).text).toBe(want)
  })

  it.each([
    'une macro dans le tableur', 'des macros', 'un manteau marron', 'le tiers des votants', 'une tierce personne',
    "je lui fais une bise sur l'œil", 'ni seuls ni accompagnés', 'à Basel en Suisse', 'un an. Anne est là',
    'un camping près de la plage', 'il faut le lire en entier', 'le quai en pierre', 'Merci à tous et à toutes',
    // Before a vowel or an h, the elision is right and stays.
    "l'Hidalgo du jour", "d'Issy-les-Moulineaux à Paris"
  ])('leaves « %s » alone', (text) => {
    expect(correct(text)).toEqual({ text, replacements: [] })
  })

  it('reports what it replaced, keeps the rest of the text byte for byte', () => {
    expect(correct('  Bonjour, lina gora !  ')).toEqual({
      text: '  Bonjour, Linagora !  ',
      replacements: [{ original: 'lina gora', name: 'Linagora', distance: 0 }]
    })
  })

  it('does nothing without names; cleans the list', () => {
    expect(createNameCorrector([], COMMON)('lina gora').text).toBe('lina gora')
    expect(cleanNames(['  Lina  gora ', '', 'Lina gora', ' '])).toEqual(['Lina gora'])
  })
})
