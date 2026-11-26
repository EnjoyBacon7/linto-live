/** Caption message of the subtitle band (the overlay page's `partial` / `final`). */
export type BandCaption = { type: 'partial' | 'final'; text: string }

interface Segment {
  words: string[]
  /** When each word took its current value (same word at the same rank): it comes out the delay later. */
  since: number[]
  final: boolean
  text: string
}

const split = (text: string): string[] => {
  const t = text.trim()
  return t ? t.split(/\s+/) : []
}

/**
 * Shows LinTO's captions a fixed delay late, minus what LinTO rewrote meanwhile: a word comes out the delay
 * after it took its current value, so the band follows the speech at its own rhythm, always the delay behind,
 * and a word LinTO corrects within the delay never shows. A word already shown stays shown: a later correction
 * replaces it in place. A final does not skip the delay (its words keep their time).
 * `maxWordsPerSecond` (0 = none) caps the pace on top: a burst (LinTO sends a translation a whole sentence at
 * once) is read out at most that fast, at a delay of 0 too; the lag then grows past the delay while it lasts.
 * The band gets the same messages as without smoothing: `partial` = words shown so far, `final` = whole segment
 * once all are shown. With neither a delay nor a cap, captions pass straight through.
 */
export class CaptionSmoother {
  private segs: Segment[] = []
  /** Words of segs[0] shown. */
  private shown = 0
  /** Text of segs[0] last sent to the band. */
  private sent = ''
  /** Earliest time of the next word under the pace cap. */
  private nextAt = 0
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly sink: (m: BandCaption) => void,
    private readonly delayMs: () => number,
    private readonly maxWordsPerSecond: () => number = () => 0
  ) {}

  /** Shortest time between two words (0 = no limit). */
  private minInterval(): number {
    const wps = this.maxWordsPerSecond()
    return wps > 0 ? 1000 / wps : 0
  }

  /** Captions pass straight through: neither a delay nor a pace limit. */
  private passThrough(): boolean {
    return this.delayMs() <= 0 && this.minInterval() <= 0
  }

  caption(m: BandCaption): void {
    if (this.passThrough()) {
      this.flush()
      this.sink(m)
      return
    }
    const now = Date.now()
    const words = split(m.text)
    let seg = this.segs[this.segs.length - 1]
    if (!seg || seg.final) {
      seg = { words: [], since: [], final: false, text: '' }
      this.segs.push(seg)
    }
    let k = 0
    while (k < words.length && k < seg.words.length && words[k] === seg.words[k]) k++
    seg.since = [...seg.since.slice(0, k), ...words.slice(k).map(() => now)]
    seg.words = words
    seg.text = m.text
    if (m.type === 'final') seg.final = true
    this.pump()
  }

  /** Drops everything queued (the band is reset). */
  clear(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.segs = []
    this.shown = 0
    this.sent = ''
    this.nextAt = 0
  }

  /** Shows at once everything received (the delay and the pace limit went to 0). */
  private flush(): void {
    const segs = this.segs
    this.clear()
    for (const s of segs) this.sink({ type: s.final ? 'final' : 'partial', text: s.text })
  }

  private pump(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    if (this.passThrough()) return this.flush()
    const delay = Math.max(0, this.delayMs())
    const minInterval = this.minInterval()
    const now = Date.now()
    const due = (s: Segment, i: number): boolean => s.since[i]! + delay <= now
    for (;;) {
      const head = this.segs[0]
      if (!head) return
      const n = head.words.length
      this.shown = Math.min(this.shown, n)
      if (head.final && this.shown >= n) {
        this.sink({ type: 'final', text: head.text })
        this.segs.shift()
        this.shown = 0
        this.sent = ''
        continue
      }
      if (this.shown < n && due(head, this.shown)) {
        if (minInterval <= 0) {
          while (this.shown < n && due(head, this.shown)) this.shown++
        } else if (now >= this.nextAt) {
          this.shown++
          this.nextAt = now + minInterval
        }
        if (head.final && this.shown >= n) continue
      }
      // Also carries a correction of words already shown.
      const text = head.words.slice(0, this.shown).join(' ')
      if (this.shown > 0 && text !== this.sent) {
        this.sink({ type: 'partial', text })
        this.sent = text
      }
      break
    }
    this.schedule(delay, minInterval)
  }

  private schedule(delay: number, minInterval: number): void {
    const head = this.segs[0]
    if (!head || this.shown >= head.words.length) return // all shown: the next caption pumps again
    let at = head.since[this.shown]! + delay
    if (minInterval > 0) at = Math.max(at, this.nextAt)
    this.timer = setTimeout(() => this.pump(), Math.max(0, at - Date.now()))
  }
}
