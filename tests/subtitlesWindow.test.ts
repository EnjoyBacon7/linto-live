import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import {
  SUBTITLES_WINDOW_SIZE, electronSubtitlesHost, type SubtitlesBrowserWindow, SubtitlesWindow, subtitlesWindowBounds, subtitlesWindowUrl, type SubtitlesWindowHost
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
    onClosed: vi.fn((cb: () => void) => { closedCb = cb }),
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

/** Like Electron: a page's own window.close() only emits 'closed', after which the window is destroyed. */
class FakeBrowserWindow extends EventEmitter implements SubtitlesBrowserWindow {
  destroyed = false
  b: Bounds
  constructor(public opts: Record<string, unknown>) {
    super()
    this.b = { x: opts.x as number, y: opts.y as number, width: opts.width as number, height: opts.height as number }
  }
  getBounds(): Bounds {
    if (this.destroyed) throw new Error('Object has been destroyed')
    return this.b
  }
  isDestroyed(): boolean { return this.destroyed }
  close(): void { this.closeFromPage() }
  closeFromPage(): void { this.destroyed = true; this.emit('closed') }
  setAlwaysOnTop = vi.fn()
  setVisibleOnAllWorkspaces = vi.fn()
  loadURL = vi.fn(async () => {})
  webContents = { on: vi.fn(), setWindowOpenHandler: vi.fn() }
}

describe('electronSubtitlesHost', () => {
  function make() {
    const wins: FakeBrowserWindow[] = []
    const host = electronSubtitlesHost((o) => { const w = new FakeBrowserWindow(o); wins.push(w); return w }, 'darwin')
    const saveBounds = vi.fn()
    const onChange = vi.fn()
    const sw = new SubtitlesWindow({ host, url: () => 'http://127.0.0.1:5000/?k=abc', bounds: () => DEFAULT, saveBounds, onChange })
    return { wins, sw, saveBounds, onChange }
  }
  it('a borderless, always-on-top window, above full-screen apps on macOS', () => {
    const t = make()
    t.sw.toggle()
    const w = t.wins[0]!
    expect(w.opts).toMatchObject({ ...DEFAULT, frame: false, alwaysOnTop: true, skipTaskbar: true, minWidth: 320, minHeight: 60 })
    expect(w.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating')
    expect(w.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, { visibleOnFullScreen: true })
    expect(w.loadURL).toHaveBeenCalledWith('http://127.0.0.1:5000/?k=abc&mode=window')
  })
  it('closed by its own × or Esc (only "closed"): state, last bounds and the change all follow, and it reopens', () => {
    const t = make()
    t.sw.toggle()
    const w = t.wins[0]!
    w.b = { x: 300, y: 400, width: 640, height: 80 }
    w.emit('move')
    w.closeFromPage()
    expect(t.sw.isOpen()).toBe(false)
    expect(t.saveBounds).toHaveBeenCalledWith({ x: 300, y: 400, width: 640, height: 80 })
    expect(t.onChange).toHaveBeenLastCalledWith(false)
    expect(t.sw.toggle()).toBe(true)
    expect(t.wins).toHaveLength(2)
  })
})
