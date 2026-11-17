// SPIKE (throwaway): phonetic correction of proper nouns in LinTO captions.
// Idea: every run of 1..N transcribed words is encoded with a French phonetic code (sonnex) and compared,
// with an edit distance, to the code of each expected name; close enough => replaced by the name.
import sonnex from 'talisman/phonetics/french/sonnex.js'

const WORD_RE = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu
// Elided articles stay in front of the name: « d'Linagora » is « d' » + « Linagora ».
const ELISION_RE = /^(?:[ldjmnstc]|qu|jusqu|lorsqu|puisqu)['’]/i
// A candidate never starts or ends on one of these (« le Macron » must not eat « le »).
const FUNCTION_WORDS = new Set(
  'le la les l de du des d un une et à a au aux en dans sur par pour avec ce cette ces se sa son ses il elle on nous vous ils elles que qui ne pas est'.split(' ')
)

export const fold = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/œ/gi, 'oe').replace(/æ/gi, 'ae').toLowerCase()
const letters = (s) => fold(s).replace(/[^a-z0-9]/g, '')
export const code = (s) => {
  const l = letters(s)
  return l ? sonnex(l) : ''
}

function levenshtein(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return prev[b.length]
}

function tokenize(text) {
  const out = []
  for (const m of text.matchAll(WORD_RE)) {
    let start = m.index
    let word = m[0]
    const el = word.match(ELISION_RE)
    if (el && el[0].length < word.length) {
      start += el[0].length
      word = word.slice(el[0].length)
    }
    // A word right after punctuation starts a new phrase: a name never spans « an. Anne ».
    const gap = out.length ? text.slice(out[out.length - 1].end, m.index) : ''
    out.push({ word, start, end: m.index + m[0].length, key: fold(word), phraseStart: /[^\s]/.test(gap) })
  }
  return out
}

/**
 * @param {string[]} names expected proper nouns, as they must be written
 * @param {{ common?: Set<string>, maxRatio?: number, minCodeLength?: number }} o
 *   common: frequent French words (folded) that are never replaced on their own;
 *   maxRatio: max edit distance / name code length; minCodeLength: shorter names are only matched exactly.
 */
export function createCorrector(names, o = {}) {
  const maxRatio = o.maxRatio ?? 0.25
  // Short names (« Bizeul » = bizel) only match an identical sound: one edit is too many (« Basel », « Izel »).
  const minCodeLength = o.minCodeLength ?? 6
  const nameWords = new Set(names.flatMap((n) => n.split(/[\s-]+/).map(fold)))
  const common = new Set([...(o.common ?? [])].filter((w) => !nameWords.has(w)))
  // Plurals of everyday words are everyday words too (« macros », « tierces »).
  const isCommon = (k) => common.has(k) || (/[sx]$/.test(k) && common.has(k.slice(0, -1)))
  const entries = names.map((name) => ({ name, code: code(name), words: name.split(/[\s-]+/).length }))

  return function correct(text) {
    const toks = tokenize(text)
    const cands = []
    for (let i = 0; i < toks.length; i++) {
      for (const e of entries) {
        // A name can be split into up to (its words + 2) transcribed words, or glued into fewer.
        const maxLen = Math.min(e.words + 2, toks.length - i)
        for (let len = 1; len <= maxLen; len++) {
          const win = toks.slice(i, i + len)
          if (win.slice(1).some((t) => t.phraseStart)) break
          if (FUNCTION_WORDS.has(win[0].key) || FUNCTION_WORDS.has(win[len - 1].key)) continue
          // A single everyday word (« macro », « tierce ») is never a name, unless it IS the name.
          if (len === 1 && isCommon(win[0].key)) continue
          const c = code(win.map((t) => t.word).join(''))
          // Cheap pre-filter: phonetic codes of very different lengths cannot be close.
          if (Math.abs(c.length - e.code.length) > Math.ceil(e.code.length * maxRatio)) continue
          const d = levenshtein(c, e.code)
          const allowed = e.code.length < minCodeLength ? 0 : Math.floor(e.code.length * maxRatio)
          if (d > allowed) continue
          // Several words that are all everyday words (« ni seuls »): demand the exact sound.
          if (len > 1 && win.every((t) => isCommon(t.key)) && d > 0) continue
          const original = text.slice(win[0].start, win[len - 1].end)
          if (original === e.name) continue
          cands.push({ start: win[0].start, end: win[len - 1].end, i, len, name: e.name, d, original })
        }
      }
    }
    // Best first: smallest distance, then the span closest to the name's own word count.
    cands.sort((a, b) => a.d - b.d || Math.abs(a.len - entriesWords(a)) - Math.abs(b.len - entriesWords(b)) || b.len - a.len)
    const taken = []
    for (const c of cands) if (!taken.some((t) => c.start < t.end && t.start < c.end)) taken.push(c)
    taken.sort((a, b) => b.start - a.start)
    let out = text
    for (const c of taken) out = out.slice(0, c.start) + c.name + out.slice(c.end)
    return { text: out, replacements: taken.reverse().map(({ original, name, d }) => ({ original, name, d })) }

    function entriesWords(c) {
      return entries.find((e) => e.name === c.name).words
    }
  }
}
