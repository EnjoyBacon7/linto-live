// EXPERIMENTAL: phonetic correction of the proper nouns the user expects (Settings.properNouns).
// Every run of 1..(name words + 2) transcribed words inside one phrase is encoded with the French « sonnex »
// phonetic code and compared to each name's code; close enough => the words are replaced by the name.
// See spikes/RESULTS.md (« Phonetic correction of proper nouns ») for how the thresholds were chosen.
import sonnex from 'talisman/phonetics/french/sonnex.js'

const WORD_RE = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu
// Elided articles stay in front of the name: « d'linagora » is « d' » + « linagora ».
const ELISION_RE = /^(?:[ldjmnstc]|qu|jusqu|lorsqu|puisqu)['’]/i
// A candidate never starts or ends on one of these (« le Macron » must not eat « le »).
const FUNCTION_WORDS = new Set(
  'le la les l de du des d un une et à a au aux en dans sur par pour avec ce cette ces se sa son ses il elle on nous vous ils elles que qui ne pas est'.split(' ')
)
/** Max edit distance, as a share of the name's phonetic code length. */
const MAX_RATIO = 0.25
/**
 * Names whose code is shorter only match an identical sound, or one a single vowel sound away (see
 * oneVowelApart: « Bizzle », « Bizzol » for Bizeul); any other edit is too many (« Basel », « Izel »).
 */
const MIN_FUZZY_CODE = 6
/** Vowel sounds in sonnex codes (E: è/é, U: ou, 1 2 3: in an on…). */
const SONNEX_VOWELS = new Set('aeiouyEU1234'.split(''))

/**
 * `a` and `b` differ by exactly one vowel sound inserted or deleted, or one vowel sound changed after the name's
 * first syllable (« Bizzol » for Bizeul; ASR rarely misses the onset: « Basel » is still not Bizeul).
 */
function oneVowelApart(a: string, b: string): boolean {
  if (a.length === b.length) {
    const diff = [...a].flatMap((ch, i) => (ch === b[i] ? [] : [i]))
    return diff.length === 1 && diff[0] >= 2 && SONNEX_VOWELS.has(a[diff[0]]) && SONNEX_VOWELS.has(b[diff[0]])
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a]
  if (long.length !== short.length + 1) return false
  for (let i = 0; i < long.length; i++) {
    if (long[i] !== short[i]) return SONNEX_VOWELS.has(long[i]) && long.slice(i + 1) === short.slice(i)
  }
  return false
}

export const fold = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/œ/gi, 'oe').replace(/æ/gi, 'ae').toLowerCase()

const phoneticCode = (s: string): string => {
  const l = fold(s).replace(/[^a-z0-9]/g, '')
  return l ? (sonnex as (w: string) => string)(l) : ''
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diag = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const up = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = up
    }
  }
  return row[b.length]
}

/** `elision`: the elided word glued in front (« l' » of « l'LINAGORA ») and where it starts. */
interface Token { word: string; start: number; end: number; key: string; phraseStart: boolean; elision?: { at: number; text: string } }

/**
 * French only elides before a vowel or an h: an elided word in front of a name starting with a consonant is
 * a transcription error. « l' » is dropped (le or la cannot be told apart); the others get their « e » back
 * (« d'Linagora » → « de Linagora », « qu'Linagora » → « que Linagora »).
 */
const startsWithConsonant = (name: string): boolean => /^[a-z]/.test(fold(name)) && !/^[aeiouyh]/.test(fold(name))
function unElide(el: string): string {
  const base = el.slice(0, -1)
  if (base.toLowerCase() === 'l') return ''
  return `${base}${base === base.toUpperCase() && base.length > 1 ? 'E' : 'e'} `
}

function tokenize(text: string): Token[] {
  const out: Token[] = []
  for (const m of text.matchAll(WORD_RE)) {
    const at = m.index ?? 0
    let start = at
    let word = m[0]
    let elision: Token['elision']
    const el = ELISION_RE.exec(word)
    if (el && el[0].length < word.length) {
      elision = { at, text: el[0] }
      start += el[0].length
      word = word.slice(el[0].length)
    }
    // A word right after punctuation starts a new phrase: a name never spans « an. Anne ». Commas do not
    // count: LinTO drops them anywhere, even inside a name (« Ici, les Moulineaux » for Issy-les-Moulineaux).
    const prev = out[out.length - 1]
    const phraseStart = prev !== undefined && /[^\s,]/.test(text.slice(prev.end, at))
    out.push({ word, start, end: at + m[0].length, key: fold(word), phraseStart, ...(elision ? { elision } : {}) })
  }
  return out
}

export interface Replacement { original: string; name: string; distance: number }
export type NameCorrector = (text: string) => { text: string; replacements: Replacement[] }

/** Cleans the user's list: trimmed, no blanks, no duplicates. */
export function cleanNames(names: readonly string[] | undefined): string[] {
  return [...new Set((names ?? []).map((n) => n.trim().replace(/\s+/g, ' ')).filter((n) => n.length > 0))]
}

/**
 * @param names the proper nouns as they must be written
 * @param common everyday French words (folded): never replaced on their own
 */
export function createNameCorrector(names: readonly string[], common: ReadonlySet<string>): NameCorrector {
  const list = cleanNames(names)
  const nameWords = new Set(list.flatMap((n) => n.split(/[\s-]+/).map(fold)))
  // Plurals of everyday words are everyday words too (« macros », « tierces »); the names' own words are not.
  const isCommon = (k: string): boolean =>
    !nameWords.has(k) && (common.has(k) || (/[sx]$/.test(k) && common.has(k.slice(0, -1))))
  const entries = list
    .map((name) => ({ name, code: phoneticCode(name), words: name.split(/[\s-]+/).length }))
    .filter((e) => e.code.length > 0)

  return (text) => {
    if (entries.length === 0) return { text, replacements: [] }
    const toks = tokenize(text)
    const cands: {
      start: number; end: number; len: number; words: number; name: string; replacement: string; distance: number; original: string; spelled: number
    }[] = []
    for (let i = 0; i < toks.length; i++) {
      for (const e of entries) {
        const maxLen = Math.min(e.words + 2, toks.length - i)
        for (let len = 1; len <= maxLen; len++) {
          const win = toks.slice(i, i + len)
          if (win.slice(1).some((t) => t.phraseStart)) break
          if (FUNCTION_WORDS.has(win[0].key) || FUNCTION_WORDS.has(win[len - 1].key)) continue
          // A single everyday word (« macro », « tierce ») is never a name.
          if (len === 1 && isCommon(win[0].key)) continue
          const c = phoneticCode(win.map((t) => t.word).join(''))
          const short = e.code.length < MIN_FUZZY_CODE
          const allowed = short ? 1 : Math.floor(e.code.length * MAX_RATIO)
          if (Math.abs(c.length - e.code.length) > allowed) continue
          const distance = levenshtein(c, e.code)
          if (distance > allowed || (short && distance > 0 && !oneVowelApart(c, e.code))) continue
          // Several everyday words (« ni seuls », « bise œil »): only an identical sound.
          if (len > 1 && distance > 0 && win.every((t) => isCommon(t.key))) continue
          const el = win[0].elision && startsWithConsonant(e.name) ? win[0].elision : undefined
          const start = el ? el.at : win[0].start
          const replacement = (el ? unElide(el.text) : '') + e.name
          const original = text.slice(start, win[len - 1].end)
          // Already right: still a candidate (a no-op), so a worse, longer match cannot eat its neighbour
          // (« Issy-les-Moulineaux chez » must not become « Issy-les-Moulineaux »).
          // LinTO already spelled this very name (only its case or an elision is off).
          const heard = text.slice(win[0].start, win[len - 1].end)
          const spelled = heard === e.name ? 2 : fold(heard) === fold(e.name) ? 1 : 0
          cands.push({ start, end: win[len - 1].end, len, words: e.words, name: e.name, replacement, distance, original, spelled })
        }
      }
    }
    // Best first: smallest distance, then a name LinTO already spelled (« LINAGORA » over « Linagora »), then the
    // span closest to the name's own word count, then the longest.
    cands.sort((a, b) => a.distance - b.distance || b.spelled - a.spelled || Math.abs(a.len - a.words) - Math.abs(b.len - b.words) || b.len - a.len)
    const taken: typeof cands = []
    for (const c of cands) if (!taken.some((t) => c.start < t.end && t.start < c.end)) taken.push(c)
    taken.sort((a, b) => a.start - b.start)
    let out = ''
    let pos = 0
    for (const c of taken) {
      out += text.slice(pos, c.start) + c.replacement
      pos = c.end
    }
    out += text.slice(pos)
    return {
      text: out,
      replacements: taken.filter((c) => c.original !== c.replacement).map(({ original, name, distance }) => ({ original, name, distance }))
    }
  }
}

/** The word list file (« word count » per line, most frequent first) as a set of folded words. */
export function parseCommonWords(raw: string): Set<string> {
  const out = new Set<string>()
  for (const line of raw.split('\n')) {
    const w = fold(line.split(' ')[0] ?? '').trim()
    if (w) out.add(w)
  }
  return out
}
