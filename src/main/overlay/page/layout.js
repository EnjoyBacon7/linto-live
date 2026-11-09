// Caption line layout (2-line scroller). Plain ESM, no dependencies:
// served as-is to the OBS browser source and imported by tests.

const EMPTY = { words: [], cuts: [] }

/**
 * Lay out `text` into lines, keeping line breaks stable: only the line that
 * contains the first changed word (and the following ones) is recomputed.
 * `cuts` holds the word index where lines 2..n start.
 */
export function layoutText(prev, text, fits) {
  const trimmed = text.trim()
  if (!trimmed) return prev
  const words = trimmed.split(/\s+/)

  const n = Math.min(prev.words.length, words.length)
  let k = 0
  while (k < n && prev.words[k] === words[k]) k++

  let s = 0
  for (const c of prev.cuts) if (c <= k && c > s) s = c
  // never keep a cut at/after the end: it would yield an empty last line
  const cuts = prev.cuts.filter((c) => c <= s && c < words.length)

  let line = ''
  for (let i = s; i < words.length; i++) {
    if (i === s) {
      line = words[i]
    } else if (fits(line + ' ' + words[i])) {
      line += ' ' + words[i]
    } else {
      cuts.push(i)
      line = words[i]
    }
  }
  return { words, cuts }
}

function lineText(layout, index) {
  if (index < 0) return ''
  const start = index === 0 ? 0 : layout.cuts[index - 1]
  const end = index < layout.cuts.length ? layout.cuts[index] : layout.words.length
  return layout.words.slice(start, end).join(' ')
}

function lastLine(layout) {
  return lineText(layout, layout.cuts.length)
}

export class SubtitleModel {
  constructor(fits) {
    this.fits = fits
    this.reset()
  }

  partial(text) {
    if (!text.trim()) return
    this.current = layoutText(this.current, text, this.fits)
    this._visible = true
  }

  final(text) {
    if (text.trim()) {
      this.current = layoutText(this.current, text, this.fits)
      this._visible = true
    }
    if (this.current.words.length) this.previous = this.current
    this.current = EMPTY
  }

  /** New measuring function (font size changed): lays the shown text out again from scratch. */
  setFits(fits) {
    this.fits = fits
    const again = (l) => layoutText(EMPTY, l.words.join(' '), fits)
    this.previous = again(this.previous)
    this.current = again(this.current)
  }

  reset() {
    this.current = EMPTY
    this.previous = EMPTY
    this._visible = false
  }

  lines() {
    if (this.current.cuts.length === 0) {
      return [lastLine(this.previous), lastLine(this.current)]
    }
    const n = this.current.cuts.length
    return [lineText(this.current, n - 1), lineText(this.current, n)]
  }

  get visible() {
    return this._visible
  }
}
