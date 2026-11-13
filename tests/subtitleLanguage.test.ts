import { describe, it, expect } from 'vitest'
import {
  subtitleLanguageOptions, isQualifiedForCrossSubtitles, routeOriginal, routeTranslation, languageLabel
} from '../src/shared/subtitleLanguage'
import type { TranslationEvent } from '../src/main/linto/captions'

const ev = (o: Partial<TranslationEvent>): TranslationEvent =>
  ({ segmentId: 1, text: 'b', targetLang: 'en', final: false, ...o })

describe('subtitleLanguageOptions', () => {
  it('lists original, cross and translations sorted by French label', () => {
    const o = subtitleLanguageOptions({ languages: ['fr-FR', 'en-US'], translations: ['en', 'fr', 'de'] })
    expect(o.map((x) => x.value)).toEqual(['original', 'crossSubtitles', 'de', 'en', 'fr'])
    expect(o.map((x) => x.label).slice(2)).toEqual(['Allemand', 'Anglais', 'Français'])
    expect(o[0].label).toBe('Langue originale')
    expect(o[1].label).toBe('Sous-titres croisés')
  })
  it('has no cross option with a single spoken language', () => {
    const o = subtitleLanguageOptions({ languages: ['fr-FR'], translations: ['en'] })
    expect(o.map((x) => x.value)).toEqual(['original', 'en'])
  })
})

describe('languageLabel', () => {
  it('capitalizes and falls back to the code', () => {
    expect(languageLabel('fr')).toBe('Français')
    expect(languageLabel('not a code!')).toBe('Not a code!')
  })
})

describe('isQualifiedForCrossSubtitles', () => {
  it('needs exactly 2 languages each with a translation', () => {
    expect(isQualifiedForCrossSubtitles(['fr-FR', 'en-US'], ['en', 'fr'])).toBe(true)
    expect(isQualifiedForCrossSubtitles(['fr-FR', 'en-US'], ['en'])).toBe(false)
    expect(isQualifiedForCrossSubtitles(['fr-FR'], ['fr'])).toBe(false)
    expect(isQualifiedForCrossSubtitles(undefined, undefined)).toBe(false)
  })
})

describe('routeOriginal', () => {
  it('passes only for the original choice', () => {
    expect(routeOriginal('original', true, 'a')).toEqual({ kind: 'final', text: 'a' })
    expect(routeOriginal('original', false, 'a')).toEqual({ kind: 'partial', text: 'a' })
    expect(routeOriginal('en', true, 'a')).toBeNull()
  })
})

describe('routeTranslation', () => {
  const langs = ['fr-FR', 'en-US']
  it('passes the chosen target language', () => {
    expect(routeTranslation('en', langs, ev({}))).toEqual({ kind: 'partial', text: 'b' })
    expect(routeTranslation('en', langs, ev({ final: true }))).toEqual({ kind: 'final', text: 'b' })
    expect(routeTranslation('de', langs, ev({}))).toBeNull()
  })
  it('cross subtitles keep only the other spoken language', () => {
    expect(routeTranslation('crossSubtitles', langs, ev({ sourceLang: 'fr-FR', targetLang: 'en' }))).toEqual({ kind: 'partial', text: 'b' })
    expect(routeTranslation('crossSubtitles', langs, ev({ sourceLang: 'en-US', targetLang: 'en' }))).toBeNull()
    expect(routeTranslation('crossSubtitles', langs, ev({ sourceLang: 'en-US', targetLang: 'fr' }))).toEqual({ kind: 'partial', text: 'b' })
    expect(routeTranslation('crossSubtitles', langs, ev({ sourceLang: 'fr-FR', targetLang: 'de' }))).toBeNull()
  })
})
