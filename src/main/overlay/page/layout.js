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

  /**
   * The `n` lines shown, top to bottom ('' when absent). The text being spoken takes the lower lines
   * (at least one, possibly empty right after a final, except with a single line); the end of the
   * previous text fills the lines above it.
   */
  lines(n = 2) {
    const all = (l) => Array.from({ length: l.cuts.length + 1 }, (_, i) => lineText(l, i))
    const current = this.current.words.length ? all(this.current) : n === 1 ? [] : ['']
    const previous = this.previous.words.length ? all(this.previous) : []
    const shown = [...previous.slice(Math.max(0, previous.length - (n - current.length))), ...current].slice(-n)
    while (shown.length < n) shown.unshift('')
    return shown
  }

  get visible() {
    return this._visible
  }
}

/**
 * Subtitle window (mode=window): the band fills the window. Two lines at 1.2 × the font fill its height,
 * with a side margin of half the font size; lineWidth is the room left for the text.
 */
export function windowMetrics(width, height) {
  const fontSize = height / 2.4
  return { fontSize, lineWidth: Math.max(1, width - fontSize) }
}

/**
 * Where the band sits on the canvas, from the app's setting (0 = bottom edge … 100 = top edge):
 * `ratio` is the share of its travel (canvas height minus band height) left under it. `qrLow`: the band
 * is in the upper half, so the QR code (top-right by default) goes to the bottom-right corner; with
 * the largest font the two never overlap either way.
 */
export function bandPlacement(position) {
  const p = typeof position === 'number' && Number.isFinite(position) ? Math.min(100, Math.max(0, position)) : 0
  return { ratio: p / 100, qrLow: p > 50 }
}

/** Caption lines in the band from the app's setting: 1..3, anything else is 2. */
export function bandLines(lines) {
  return Number.isInteger(lines) && lines >= 1 && lines <= 3 ? lines : 2
}
