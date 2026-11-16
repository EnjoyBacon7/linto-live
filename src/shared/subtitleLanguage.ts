import type { Channel, SubtitleLanguageOption, TranslationEvent } from './types'

export const ORIGINAL = 'original'
export const CROSS = 'crossSubtitles'

export type { SubtitleLanguageOption } from './types'
export type Routed = { kind: 'partial' | 'final'; text: string } | null

const base = (code: string | null | undefined): string => (code ?? '').split('-')[0]

/** Display name of a language code in `locale`, first letter upper-cased; the code itself when unknown. */
export function languageLabel(code: string, locale = 'fr'): string {
  let name = code
  try { name = new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code } catch { /* invalid code */ }
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1)
}

/** Exactly two spoken languages of different base codes, each with a translation to its base language. */
export function isQualifiedForCrossSubtitles(languages: string[] | undefined, translations: string[] | undefined): boolean {
  if (languages?.length !== 2 || !translations) return false
  if (base(languages[0]) === base(languages[1])) return false
  const targets = translations.map(base)
  return languages.every((l) => targets.includes(base(l)))
}

export function subtitleLanguageOptions(
  channel: Pick<Channel, 'languages' | 'translations'>,
  locale = 'fr'
): SubtitleLanguageOption[] {
  const out: SubtitleLanguageOption[] = [{ value: ORIGINAL, label: 'Langue originale' }]
  if (isQualifiedForCrossSubtitles(channel.languages, channel.translations)) {
    out.push({ value: CROSS, label: 'Sous-titres croisés' })
  }
  const tr = [...new Set(channel.translations ?? [])].map((value) => ({ value, label: languageLabel(value, locale) }))
  tr.sort((a, b) => a.label.localeCompare(b.label, locale))
  return [...out, ...tr]
}

export function routeOriginal(choice: string, final: boolean, text: string): Routed {
  return choice === ORIGINAL ? { kind: final ? 'final' : 'partial', text } : null
}

export function routeTranslation(choice: string, channelLanguages: string[] | undefined, e: TranslationEvent): Routed {
  const routed: Routed = { kind: e.final ? 'final' : 'partial', text: e.text }
  if (choice === e.targetLang) return routed
  if (choice !== CROSS) return null
  const target = base(e.targetLang)
  if (target === base(e.sourceLang)) return null
  return (channelLanguages ?? []).some((l) => base(l) === target) ? routed : null
}
