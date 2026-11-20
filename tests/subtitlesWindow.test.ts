import { describe, expect, it, vi } from 'vitest'
import {
  SUBTITLES_WINDOW_SIZE, SubtitlesWindow, subtitlesWindowBounds, subtitlesWindowUrl, type SubtitlesWindowHost
} from '../src/main/subtitlesWindow'
import type { Bounds } from '../src/shared/types'

const display: Bounds = { x: 0, y: 25, width: 1920, height: 1055 }
const DEFAULT: Bounds = { x: 480, y: 912, width: 960, height: 120 }

describe('subtitlesWindowUrl', () => {
  it('adds mode=window and keeps the key', () => {
    expect(subtitlesWindowUrl('http://127.0.0.1:5000/?k=abc')).toBe('http://127.0.0.1:5000/?k=abc&mode=window')
  })
})

describe('subtitlesWindowBounds', () => {
  it('defaults to 960 × 120, centred at the bottom of the primary work area (48 px margin)', () => {
    expect(SUBTITLES_WINDOW_SIZE).toEqual({ width: 960, height: 120, minWidth: 320, minHeight: 60 })
    expect(subtitlesWindowBounds(undefined, [display], display)).toEqual(DEFAULT)
  })
  it('reuses saved bounds still on a display', () => {
    const saved = { x: 100, y: 200, width: 700, height: 90 }
    expect(subtitlesWindowBounds(saved, [display], display)).toEqual(saved)
  })
  it('a band only partly on screen is kept while 100 × 30 px stay visible', () => {
    const low = { x: 100, y: 1045, width: 700, height: 90 } // 35 px above the bottom of the work area
    expect(subtitlesWindowBounds(low, [display], display)).toEqual(low)
    expect(subtitlesWindowBounds({ ...low, y: 1060 }, [display], display)).toEqual(DEFAULT)
  })
  it('falls back to the default when the saved display is gone', () => {
    expect(subtitlesWindowBounds({ x: 5000, y: 200, width: 700, height: 100 }, [display], display)).toEqual(DEFAULT)
  })
})

function fakeHost() {
  let closedCb: (() => void) | null = null
  const win = {
    close: vi.fn(() => closedCb?.()),
    onClose: vi.fn((cb: () => void) => { closedCb = cb }),
    bounds: vi.fn(() => ({ x: 1, y: 2, width: 800, height: 100 }))
  }
  const host: SubtitlesWindowHost & { open: ReturnType<typeof vi.fn> } = { open: vi.fn(() => win) }
  return { host, win, closeFromWindow: () => closedCb?.() }
}

function make(url: string | null = 'http://127.0.0.1:5000/?k=abc') {
  const h = fakeHost()
  const saveBounds = vi.fn()
  const onChange = vi.fn()
  const sw = new SubtitlesWindow({ host: h.host, url: () => url, bounds: () => DEFAULT, saveBounds, onChange })
  return { ...h, sw, saveBounds, onChange }
}

describe('SubtitlesWindow', () => {
  it('toggle opens then closes, saving the bounds', () => {
    const t = make()
    expect(t.sw.toggle()).toBe(true)
    expect(t.host.open).toHaveBeenCalledWith('http://127.0.0.1:5000/?k=abc&mode=window', DEFAULT)
    expect(t.sw.isOpen()).toBe(true)
    expect(t.onChange).toHaveBeenLastCalledWith(true)
    expect(t.sw.toggle()).toBe(false)
    expect(t.saveBounds).toHaveBeenCalledWith({ x: 1, y: 2, width: 800, height: 100 })
    expect(t.sw.isOpen()).toBe(false)
    expect(t.onChange).toHaveBeenLastCalledWith(false)
  })
  it('closed by the window itself (× or Esc): not open any more, bounds saved, change reported', () => {
    const t = make()
    t.sw.toggle()
    t.closeFromWindow()
    expect(t.sw.isOpen()).toBe(false)
    expect(t.saveBounds).toHaveBeenCalledTimes(1)
    expect(t.onChange).toHaveBeenLastCalledWith(false)
  })
  it('refuses to open before the subtitle server is up', () => {
    const t = make(null)
    expect(() => t.sw.toggle()).toThrow('Les sous-titres ne sont pas encore prêts.')
    expect(t.host.open).not.toHaveBeenCalled()
    expect(t.onChange).not.toHaveBeenCalled()
  })
  it('close() closes an open window and is a no-op otherwise', () => {
    const t = make()
    t.sw.close()
    expect(t.win.close).not.toHaveBeenCalled()
    t.sw.toggle()
    t.sw.close()
    expect(t.win.close).toHaveBeenCalledTimes(1)
    expect(t.sw.isOpen()).toBe(false)
  })
})
