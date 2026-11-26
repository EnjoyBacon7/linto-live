import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CaptionSmoother, type BandCaption } from '../src/main/captionSmoother'

describe('CaptionSmoother', () => {
  let out: BandCaption[]
  let delay: number
  let wps: number
  let s: CaptionSmoother
  beforeEach(() => {
    vi.useFakeTimers()
    out = []
    delay = 1000
    wps = 0
    s = new CaptionSmoother((m) => out.push(m), () => delay, () => wps)
  })
  afterEach(() => vi.useRealTimers())
  const last = (): BandCaption | undefined => out[out.length - 1]

  it('passes everything through at once at 0', () => {
    delay = 0
    s.caption({ type: 'partial', text: 'bonjour' })
    s.caption({ type: 'final', text: 'bonjour à tous' })
    expect(out).toEqual([{ type: 'partial', text: 'bonjour' }, { type: 'final', text: 'bonjour à tous' }])
  })

  it('shows a word only once it has stayed the same for the delay', () => {
    s.caption({ type: 'partial', text: 'bonjour' })
    vi.advanceTimersByTime(999)
    expect(out).toEqual([])
    vi.advanceTimersByTime(1)
    expect(out).toEqual([{ type: 'partial', text: 'bonjour' }])
  })

  it('a rewritten word restarts its wait; the words before it are not held back', () => {
    s.caption({ type: 'partial', text: 'il ces' })
    vi.advanceTimersByTime(600)
    s.caption({ type: 'partial', text: "il c'est" })
    vi.advanceTimersByTime(400)
    expect(last()).toEqual({ type: 'partial', text: 'il' })
    vi.advanceTimersByTime(500)
    expect(out.some((m) => m.text.includes('ces'))).toBe(false)
    vi.advanceTimersByTime(100)
    expect(last()).toEqual({ type: 'partial', text: "il c'est" })
  })

  it('a final admits all its words, released one by one, then the final', () => {
    s.caption({ type: 'final', text: 'un deux trois' })
    expect(out).toEqual([{ type: 'partial', text: 'un' }])
    vi.advanceTimersByTime(1000)
    expect(out).toEqual([
      { type: 'partial', text: 'un' },
      { type: 'partial', text: 'un deux' },
      { type: 'final', text: 'un deux trois' }
    ])
  })

  it('releases at an even pace, faster when words pile up, within the delay', () => {
    const words = Array.from({ length: 20 }, (_, i) => `m${i}`).join(' ')
    s.caption({ type: 'final', text: words })
    const times: number[] = []
    const t0 = Date.now()
    const n = (): number => out.length
    let seen = 0
    for (let t = 0; t <= 1000; t += 10) {
      if (n() > seen) { times.push(Date.now() - t0); seen = n() }
      vi.advanceTimersByTime(10)
    }
    expect(last()).toEqual({ type: 'final', text: words })
    // spread out, not one burst
    expect(times.length).toBeGreaterThan(10)
  })

  it('paces at 250 ms a word when nothing piles up', () => {
    delay = 3000
    s.caption({ type: 'final', text: 'a b' })
    expect(out).toEqual([{ type: 'partial', text: 'a' }])
    vi.advanceTimersByTime(249)
    expect(out.length).toBe(1)
    vi.advanceTimersByTime(1)
    expect(last()).toEqual({ type: 'final', text: 'a b' })
  })

  it('setting the delay to 0 flushes what is queued', () => {
    s.caption({ type: 'final', text: 'un deux trois' })
    s.caption({ type: 'partial', text: 'quatre cinq' })
    delay = 0
    s.caption({ type: 'partial', text: 'quatre cinq six' })
    expect(out.slice(-3)).toEqual([
      { type: 'final', text: 'un deux trois' },
      { type: 'partial', text: 'quatre cinq' },
      { type: 'partial', text: 'quatre cinq six' }
    ])
    vi.advanceTimersByTime(5000)
    expect(out.slice(-1)).toEqual([{ type: 'partial', text: 'quatre cinq six' }])
  })

  it('setting the delay to 0 flushes on the next tick even without a new caption', () => {
    s.caption({ type: 'final', text: 'un deux trois' })
    delay = 0
    vi.advanceTimersByTime(300)
    expect(last()).toEqual({ type: 'final', text: 'un deux trois' })
  })

  it('clear drops everything queued', () => {
    s.caption({ type: 'final', text: 'un deux trois' })
    s.clear()
    const n = out.length
    vi.advanceTimersByTime(5000)
    expect(out.length).toBe(n)
  })

  it('a partial shorter than what is shown shows the new text', () => {
    s.caption({ type: 'partial', text: 'un deux trois' })
    vi.advanceTimersByTime(2000)
    expect(last()).toEqual({ type: 'partial', text: 'un deux trois' })
    s.caption({ type: 'partial', text: 'un' })
    s.caption({ type: 'final', text: 'un' })
    vi.advanceTimersByTime(2000)
    expect(last()).toEqual({ type: 'final', text: 'un' })
  })

  it('the next segment waits behind a draining final', () => {
    s.caption({ type: 'final', text: 'a b c d' })
    s.caption({ type: 'final', text: 'e f' })
    vi.advanceTimersByTime(3000)
    const finals = out.filter((m) => m.type === 'final').map((m) => m.text)
    expect(finals).toEqual(['a b c d', 'e f'])
    const iFirst = out.findIndex((m) => m.text === 'a b c d')
    expect(out.slice(0, iFirst).every((m) => !m.text.startsWith('e'))).toBe(true)
  })

  it('keeps no timer once every word of the open segment is shown', () => {
    s.caption({ type: 'partial', text: 'un deux' })
    vi.advanceTimersByTime(2000)
    expect(last()).toEqual({ type: 'partial', text: 'un deux' })
    expect(vi.getTimerCount()).toBe(0)
    // a word arriving after the idle spell still waits the whole delay to settle
    s.caption({ type: 'partial', text: 'un deux troi' })
    vi.advanceTimersByTime(600)
    s.caption({ type: 'partial', text: 'un deux trois' })
    vi.advanceTimersByTime(999)
    expect(last()).toEqual({ type: 'partial', text: 'un deux' })
    vi.advanceTimersByTime(1)
    expect(last()).toEqual({ type: 'partial', text: 'un deux trois' })
    expect(out.some((m) => m.text.includes('troi '))).toBe(false)
    expect(out.some((m) => m.text.endsWith('troi'))).toBe(false)
  })

  it('an empty final still closes the segment', () => {
    s.caption({ type: 'partial', text: 'euh' })
    s.caption({ type: 'final', text: '' })
    expect(out).toEqual([{ type: 'final', text: '' }])
  })

  describe('max words per second', () => {
    /** Times (ms from now) at which each message comes out, over `ms`. */
    const run = (ms: number): number[] => {
      const t0 = Date.now()
      const times: number[] = []
      let seen = out.length
      for (let t = 0; t <= ms; t += 10) {
        while (out.length > seen) { times.push(Date.now() - t0); seen++ }
        vi.advanceTimersByTime(10)
      }
      return times
    }

    it('caps the catch-up pace of a burst (a whole translated sentence at once)', () => {
      wps = 2
      const words = Array.from({ length: 10 }, (_, i) => `m${i}`).join(' ')
      s.caption({ type: 'final', text: words })
      const times = [0, ...run(6000)]
      expect(last()).toEqual({ type: 'final', text: words })
      expect(times.length).toBe(10) // 9 partials + the final (the first partial came out at once)
      for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(500)
    })

    it('paces words even without smoothing delay', () => {
      delay = 0
      wps = 4
      s.caption({ type: 'final', text: 'un deux trois' })
      expect(out).toEqual([{ type: 'partial', text: 'un' }])
      vi.advanceTimersByTime(249)
      expect(out.length).toBe(1)
      vi.advanceTimersByTime(1)
      expect(last()).toEqual({ type: 'partial', text: 'un deux' })
      vi.advanceTimersByTime(250)
      expect(last()).toEqual({ type: 'final', text: 'un deux trois' })
    })

    it('without delay, a partial is shown at once when the pace allows it', () => {
      delay = 0
      wps = 4
      s.caption({ type: 'partial', text: 'bonjour' })
      expect(out).toEqual([{ type: 'partial', text: 'bonjour' }])
      vi.advanceTimersByTime(1000)
      s.caption({ type: 'partial', text: 'bonjour à' })
      expect(last()).toEqual({ type: 'partial', text: 'bonjour à' })
    })

    it('no limit and no delay passes through; removing the limit flushes the queue', () => {
      delay = 0
      wps = 1
      s.caption({ type: 'final', text: 'un deux trois' })
      wps = 0
      vi.advanceTimersByTime(1000)
      expect(last()).toEqual({ type: 'final', text: 'un deux trois' })
      s.caption({ type: 'partial', text: 'quatre cinq' })
      expect(last()).toEqual({ type: 'partial', text: 'quatre cinq' })
    })
  })
})
