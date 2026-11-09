import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseWatermark, WatermarkCycle } from '../../src/main/overlay/page/watermark.js'
import { SubtitleModel } from '../../src/main/overlay/page/layout.js'

const TOKENS = { linto: { src: '/img/linto.svg', alt: 'LinTO' }, linagora: { src: '/img/linagora.png', alt: 'Linagora' } }

describe('parseWatermark', () => {
  it('turns $linto / $linagora into logos, keeps the rest as text', () => {
    expect(parseWatermark('Transcription by LinTO.ai $linto Open Source AI by $linagora', TOKENS)).toEqual([
      { type: 'text', value: 'Transcription by LinTO.ai ' },
      { type: 'token', src: '/img/linto.svg', alt: 'LinTO' },
      { type: 'text', value: ' Open Source AI by ' },
      { type: 'token', src: '/img/linagora.png', alt: 'Linagora' }
    ])
  })
  it('leaves unknown tokens (and prototype names) as text', () => {
    expect(parseWatermark('$foo $constructor', TOKENS)).toEqual([
      { type: 'text', value: '$foo' }, { type: 'text', value: ' ' }, { type: 'text', value: '$constructor' }
    ])
    expect(parseWatermark('', TOKENS)).toEqual([])
  })
})

describe('WatermarkCycle', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })
  const mk = () => {
    const seen: boolean[] = []
    const c = new WatermarkCycle((v) => seen.push(v), { setTimeout, clearTimeout })
    return { c, seen }
  }

  it('hidden for `frequency` s, shown for `duration` s, repeated', () => {
    const { c, seen } = mk()
    c.update({ display: true, pinned: false, frequency: 10, duration: 3 })
    expect(c.visible).toBe(false)
    vi.advanceTimersByTime(9_999)
    expect(c.visible).toBe(false)
    vi.advanceTimersByTime(1)
    expect(c.visible).toBe(true)
    vi.advanceTimersByTime(3_000)
    expect(c.visible).toBe(false)
    vi.advanceTimersByTime(10_000)
    expect(c.visible).toBe(true)
    expect(seen).toEqual([true, false, true])
  })
  it('pinned: always shown; display off: never', () => {
    const { c } = mk()
    c.update({ display: true, pinned: true, frequency: 10, duration: 3 })
    expect(c.visible).toBe(true)
    vi.advanceTimersByTime(60_000)
    expect(c.visible).toBe(true)
    c.update({ display: false, pinned: true, frequency: 10, duration: 3 })
    expect(c.visible).toBe(false)
    vi.advanceTimersByTime(60_000)
    expect(c.visible).toBe(false)
  })
  it('the same settings again (style replay on reconnect) do not restart the cycle', () => {
    const { c } = mk()
    const w = { display: true, pinned: false, frequency: 10, duration: 3 }
    c.update(w)
    vi.advanceTimersByTime(6_000)
    c.update({ ...w })
    vi.advanceTimersByTime(4_000)
    expect(c.visible).toBe(true)
    c.update({ ...w, frequency: 20 }) // a change restarts it hidden
    expect(c.visible).toBe(false)
  })
})

describe('SubtitleModel.setFits', () => {
  it('lays the shown text out again with the new width', () => {
    const m = new SubtitleModel((l) => l.length <= 20)
    m.final('un deux trois quatre cinq')
    m.partial('six sept huit neuf dix onze')
    expect(m.lines()).toEqual(['six sept huit neuf', 'dix onze'])
    m.setFits((l) => l.length <= 10)
    expect(m.lines()).toEqual(['huit neuf', 'dix onze'])
  })
})
