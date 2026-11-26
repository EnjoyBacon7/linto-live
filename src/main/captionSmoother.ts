/** Caption message of the subtitle band (the overlay page's `partial` / `final`). */
export type BandCaption = { type: 'partial' | 'final'; text: string }

/** Pace of the words when nothing piles up (~4 words/s, a speaking rate). */
const BASE_INTERVAL_MS = 250

interface Segment {
  words: string[]
  /** When each word took its current value (same word at the same rank). */
  since: number[]
  /** When each word was admitted to the queue (undefined = not yet). */
  admittedAt: (number | undefined)[]
  final: boolean
  text: string
}

const split = (text: string): string[] => {
  const t = text.trim()
  return t ? t.split(/\s+/) : []
}

/**
 * Trades latency for a calmer subtitle band. A word of the open segment is admitted once it has stayed the
 * same for the delay (all of them when the segment is final); admitted words come out one at a time, at
 * BASE_INTERVAL_MS or faster so each is shown within the delay of its admission. The band gets the same
 * messages as without smoothing: `partial` = words shown so far, `final` = whole segment once all are shown.
 * At a delay of 0 captions pass straight through.
 */
export class CaptionSmoother {
  private segs: Segment[] = []
  /** Words of segs[0] already shown. */
  private shown = 0
  private nextAt = 0
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly sink: (m: BandCaption) => void, private readonly delayMs: () => number) {}

  caption(m: BandCaption): void {
    const now = Date.now()
    if (this.delayMs() <= 0) {
      this.flush()
      this.sink(m)
      return
    }
    const words = split(m.text)
    let seg = this.segs[this.segs.length - 1]
    if (!seg || seg.final) {
      seg = { words: [], since: [], admittedAt: [], final: false, text: '' }
      this.segs.push(seg)
    }
    let k = 0
    while (k < words.length && k < seg.words.length && words[k] === seg.words[k]) k++
    seg.since = [...seg.since.slice(0, k), ...words.slice(k).map(() => now)]
    seg.admittedAt = seg.admittedAt.slice(0, k)
    seg.words = words
    seg.text = m.text
    if (m.type === 'final') seg.final = true
    if (seg === this.segs[0]) this.shown = Math.min(this.shown, words.length)
    this.pump()
  }

  /** Drops everything queued (the band is reset). */
  clear(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.segs = []
    this.shown = 0
    this.nextAt = 0
  }

  /** Shows at once everything received (the delay went to 0). */
  private flush(): void {
    const segs = this.segs
    this.clear()
    for (const s of segs) this.sink({ type: s.final ? 'final' : 'partial', text: s.text })
  }

  private admit(now: number, delay: number): void {
    for (const s of this.segs) {
      for (let i = 0; i < s.words.length; i++) {
        if (s.admittedAt[i] !== undefined) continue
        if (s.final) s.admittedAt[i] = now
        else if (now - s.since[i]! >= delay) s.admittedAt[i] = s.since[i]! + delay
        else break
      }
    }
  }

  /** Admitted words not shown yet, and the latest of their admission times. */
  private queued(): { waiting: number; lastAdmitted: number } {
    let waiting = 0
    let lastAdmitted = 0
    this.segs.forEach((s, j) => {
      for (let i = j === 0 ? this.shown : 0; i < s.words.length; i++) {
        const a = s.admittedAt[i]
        if (a === undefined) break
        waiting++
        lastAdmitted = Math.max(lastAdmitted, a)
      }
    })
    return { waiting, lastAdmitted }
  }

  private pump(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    const delay = this.delayMs()
    if (delay <= 0) return this.flush()
    const now = Date.now()
    this.admit(now, delay)
    for (;;) {
      const head = this.segs[0]
      if (!head) return
      if (head.final && this.shown >= head.words.length) {
        this.sink({ type: 'final', text: head.text })
        this.segs.shift()
        this.shown = 0
        continue
      }
      if (head.admittedAt[this.shown] === undefined) break
      if (now < this.nextAt) break
      this.shown++
      const { waiting, lastAdmitted } = this.queued()
      const interval = waiting > 0 ? Math.min(BASE_INTERVAL_MS, Math.max(0, lastAdmitted + delay - now) / waiting) : BASE_INTERVAL_MS
      this.nextAt = now + interval
      if (!(head.final && this.shown >= head.words.length)) {
        this.sink({ type: 'partial', text: head.words.slice(0, this.shown).join(' ') })
      }
    }
    this.schedule(delay)
  }

  private schedule(delay: number): void {
    const head = this.segs[0]
    if (!head) return
    let at: number
    if (head.admittedAt[this.shown] !== undefined) at = this.nextAt
    else at = head.since[this.shown]! + delay // head is open: its next word becomes stable then
    this.timer = setTimeout(() => this.pump(), Math.max(0, at - Date.now()))
  }
}
