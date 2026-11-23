import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ n: 0 }))
vi.mock('talisman/phonetics/french/sonnex.js', async (orig) => {
  const real = (await orig<{ default: (w: string) => string }>()).default
  return { default: (w: string) => { calls.n++; return real(w) } }
})

import { createNameCorrector, parseCommonWords } from '../../src/main/linto/properNouns'

const COMMON = parseCommonWords(readFileSync('resources/proper-nouns/fr-common-words.txt', 'utf8'))
const TEXT = 'merci à camille biseul et à lina gora pour la réunion avec michel roquard à saint brieu demain matin'

function run(count: number): { n: number; text: string } {
  const names = ['Camille Bizeul', 'Linagora', 'Michel Rocard', 'Saint-Brieuc', ...Array.from({ length: count }, (_, i) => `Nom${i}x Zorglub${i}`)]
  const correct = createNameCorrector(names, COMMON)
  calls.n = 0
  const { text } = correct(TEXT)
  return { n: calls.n, text }
}

describe('proper noun corrector cost (A-006)', () => {
  it('computes window phonetic codes once, independent of the number of names', () => {
    const few = run(0)
    const many = run(300)
    expect(many.text).toBe('merci à Camille Bizeul et à Linagora pour la réunion avec Michel Rocard à Saint-Brieuc demain matin')
    expect(few.text).toBe(many.text)
    // Each (token, length) window is encoded once: no more than tokens x (max name words + 2).
    expect(many.n).toBeLessThanOrEqual(TEXT.split(' ').length * 4)
    expect(many.n).toBe(few.n)
  })
})
