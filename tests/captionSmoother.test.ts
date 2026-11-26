import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CaptionSmoother, type BandCaption } from '../src/main/captionSmoother'

describe('CaptionSmoother', () => {
  let out: BandCaption[]
  let delay: number
  let s: CaptionSmoother
  beforeEach(() => {
    vi.useFakeTimers()
    out = []
    delay = 1000
    s = new CaptionSmoother((m) => out.push(m), () => delay)
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
})
