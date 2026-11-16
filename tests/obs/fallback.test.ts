import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FallbackMonitor, isBlack, lumaOfBgra, type Luma } from '../../src/main/obs/fallback'

const BLACK: Luma = { mean: 16 / 255, max: 16 / 255 }
const PICTURE: Luma = { mean: 0.4, max: 0.9 }

describe('isBlack', () => {
  it('detects limited-range black and rejects a picture', () => {
    expect(isBlack({ mean: 16 / 255, max: 16 / 255 })).toBe(true)
    expect(isBlack({ mean: 0.12, max: 0.6 })).toBe(false)
  })
})

describe('lumaOfBgra', () => {
  it('uniform limited-range black is ~0.063', () => {
    const l = lumaOfBgra(new Uint8Array(4 * 6).fill(16))!
    expect(l.mean).toBeCloseTo(16 / 255, 5)
    expect(l.max).toBeCloseTo(16 / 255, 5)
    expect(isBlack(l)).toBe(true)
  })
  it('weights B, G, R and keeps the brightest pixel', () => {
    // BGRA: a pure red pixel (0.299) and a black one.
    const l = lumaOfBgra(Buffer.from([0, 0, 255, 255, 0, 0, 0, 255]))!
    expect(l.max).toBeCloseTo(0.299, 5)
    expect(l.mean).toBeCloseTo(0.1495, 5)
  })
  it('an empty picture has no luma', () => {
    expect(lumaOfBgra(new Uint8Array(0))).toBeNull()
  })
})

describe('FallbackMonitor', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function make(
    frames: (n: number) => Luma | 'throw' | null,
    o: { blackIsAbsent?: boolean; primaryIsFile?: boolean; setBackup?: (on: boolean) => Promise<void> } = {}
  ) {
    let n = 0
    const setBackup = vi.fn(o.setBackup ?? (async () => {}))
    const onChange = vi.fn()
    const m = new FallbackMonitor({
      probe: async () => {
        const f = frames(n++)
        if (f === 'throw') throw new Error('probe')
        return JSON.stringify(f)
      },
      decode: (s) => JSON.parse(s),
      setBackup,
      blackIsAbsent: () => o.blackIsAbsent ?? true,
      primaryIsFile: () => o.primaryIsFile ?? false,
      onChange
    })
    return { m, setBackup, onChange }
  }

  it('switches to backup after 2 s of black', async () => {
    const { m, setBackup, onChange } = make(() => BLACK)
    m.start()
    await vi.advanceTimersByTimeAsync(1500)
    expect(setBackup).not.toHaveBeenCalledWith(true)
    await vi.advanceTimersByTimeAsync(500)
    expect(setBackup.mock.calls.filter((c) => c[0] === true)).toHaveLength(1)
    expect(onChange).toHaveBeenCalledWith(true)
    expect(m.onBackup).toBe(true)
    m.stop()
  })

  it('returns to primary after 2 s of picture', async () => {
    const { m, setBackup, onChange } = make((n) => (n <= 4 ? BLACK : PICTURE))
    m.start()
    await vi.advanceTimersByTimeAsync(2000)
    expect(m.onBackup).toBe(true)
    await vi.advanceTimersByTimeAsync(1500)
    expect(m.onBackup).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(m.onBackup).toBe(false)
    expect(setBackup).toHaveBeenLastCalledWith(false)
    expect(onChange).toHaveBeenLastCalledWith(false)
    m.stop()
  })

  it('no toggle on alternating probes', async () => {
    const { m, setBackup } = make((n) => (n % 2 ? PICTURE : BLACK))
    m.start()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(setBackup).not.toHaveBeenCalledWith(true)
    m.stop()
  })

  it('black is ignored when blackIsAbsent is false', async () => {
    const black = make(() => BLACK, { blackIsAbsent: false })
    black.m.start()
    await vi.advanceTimersByTimeAsync(5000)
    expect(black.m.onBackup).toBe(false)
    black.m.stop()
    const failing = make(() => 'throw', { blackIsAbsent: false })
    failing.m.start()
    await vi.advanceTimersByTimeAsync(2000)
    expect(failing.m.onBackup).toBe(true)
    failing.m.stop()
  })

  it('file primary is never black-absent', async () => {
    const { m } = make(() => BLACK, { primaryIsFile: true })
    m.start()
    await vi.advanceTimersByTimeAsync(5000)
    expect(m.onBackup).toBe(false)
    m.stop()
    const dec = make(() => null, { primaryIsFile: true })
    dec.m.start()
    await vi.advanceTimersByTimeAsync(2000)
    expect(dec.m.onBackup).toBe(true)
    dec.m.stop()
  })

  it('retries after a failed switch without calling onChange', async () => {
    let fail = true
    const { m, setBackup, onChange } = make(() => BLACK, {
      setBackup: async (on) => {
        if (on && fail) throw new Error('obs')
      }
    })
    m.start()
    await vi.advanceTimersByTimeAsync(2500)
    expect(m.onBackup).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
    fail = false
    await vi.advanceTimersByTimeAsync(500)
    expect(m.onBackup).toBe(true)
    expect(onChange).toHaveBeenCalledWith(true)
    expect(setBackup.mock.calls.filter((c) => c[0] === true).length).toBeGreaterThan(1)
    m.stop()
  })

  it('stop ignores a probe already in flight', async () => {
    let release!: (s: string) => void
    const setBackup = vi.fn(async () => {})
    const m = new FallbackMonitor({
      probe: () => new Promise<string>((r) => (release = r)),
      decode: () => null,
      setBackup,
      blackIsAbsent: () => true,
      primaryIsFile: () => false,
      switchMs: 0
    })
    m.start()
    await vi.advanceTimersByTimeAsync(0)
    m.stop()
    release('x')
    await vi.advanceTimersByTimeAsync(1000)
    expect(setBackup).not.toHaveBeenCalledWith(true)
    expect(m.onBackup).toBe(false)
  })
})
