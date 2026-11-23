import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import {
  HELPER_SWITCH, helperSubtitlesHost, isSubtitlesHelper, needsSubtitlesHelper, runSubtitlesHelper, subtitlesHelperCommand,
  type HelperChild
} from '../src/main/subtitlesHelper'
import type { SubtitlesWindowHost } from '../src/main/subtitlesWindow'
import type { Bounds } from '../src/shared/types'

const URL_ = 'http://127.0.0.1:5000/?k=abc&mode=window'
const B: Bounds = { x: 10, y: 20, width: 960, height: 120 }
const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

describe('helper selection and command line', () => {
  it('only Linux in a Wayland session needs the helper', () => {
    expect(needsSubtitlesHelper('linux', true)).toBe(true)
    expect(needsSubtitlesHelper('linux', false)).toBe(false)
    expect(needsSubtitlesHelper('darwin', true)).toBe(false)
  })
  it('recognises the helper switch', () => {
    expect(isSubtitlesHelper(['/opt/LinTO Live/linto-live', HELPER_SWITCH, '--ozone-platform=x11'])).toBe(true)
    expect(isSubtitlesHelper(['/opt/LinTO Live/linto-live'])).toBe(false)
  })
  it('packaged: the same executable under X11, nothing secret on the command line', () => {
    expect(subtitlesHelperCommand({ execPath: '/opt/x/linto-live', appPath: null, flatpak: false })).toEqual({
      command: '/opt/x/linto-live', args: [HELPER_SWITCH, '--ozone-platform=x11']
    })
  })
  it('development: electron plus the app folder', () => {
    expect(subtitlesHelperCommand({ execPath: '/e/electron', appPath: '/src/app', flatpak: false }).args)
      .toEqual(['/src/app', HELPER_SWITCH, '--ozone-platform=x11'])
  })
  it('Flatpak: through zypak-wrapper, like the app launcher', () => {
    expect(subtitlesHelperCommand({ execPath: '/app/main/linto-live', appPath: null, flatpak: true })).toEqual({
      command: 'zypak-wrapper', args: ['/app/main/linto-live', HELPER_SWITCH, '--ozone-platform=x11']
    })
  })
})

function fakeChild() {
  const ev = new EventEmitter()
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const written: string[] = []
  stdin.on('data', (d: Buffer) => written.push(d.toString()))
  const child: HelperChild & { kill: ReturnType<typeof vi.fn> } = {
    stdin, stdout, on: (e: string, l: (...a: unknown[]) => void) => ev.on(e, l), kill: vi.fn()
  } as never
  return {
    child, written, stdin, stdout,
    say: (msg: unknown) => stdout.write('linto-subtitles:' + JSON.stringify(msg) + '\n'),
    exit: () => ev.emit('close'),
    fail: () => ev.emit('error', new Error('spawn zypak-wrapper ENOENT'))
  }
}

function fakeFallback() {
  let closedCb: (() => void) | null = null
  const win = { close: vi.fn(() => closedCb?.()), onClosed: vi.fn((cb: () => void) => { closedCb = cb }), bounds: () => B }
  const host: SubtitlesWindowHost & { open: ReturnType<typeof vi.fn> } = { open: vi.fn(() => win) }
  return { host, win }
}

describe('helperSubtitlesHost (parent side)', () => {
  it('sends the URL and bounds on stdin, keeps the reported bounds, reports the close', async () => {
    const c = fakeChild()
    const f = fakeFallback()
    const w = helperSubtitlesHost({ spawn: () => c.child, fallback: f.host }).open(URL_, B)
    const closed = vi.fn()
    w.onClosed(closed)
    await tick()
    expect(JSON.parse(c.written.join(''))).toEqual({ url: URL_, bounds: B })
    c.say({ type: 'ready' })
    c.say({ type: 'bounds', bounds: { x: 1, y: 2, width: 700, height: 90 } })
    await tick()
    c.exit()
    expect(closed).toHaveBeenCalledTimes(1)
    expect(w.bounds()).toEqual({ x: 1, y: 2, width: 700, height: 90 })
    expect(f.host.open).not.toHaveBeenCalled()
  })
  it('close() ends stdin so the helper closes its window', async () => {
    const c = fakeChild()
    const w = helperSubtitlesHost({ spawn: () => c.child, fallback: fakeFallback().host }).open(URL_, B)
    const ended = vi.fn()
    c.stdin.on('finish', ended)
    c.say({ type: 'ready' })
    await tick()
    w.close()
    await tick()
    expect(ended).toHaveBeenCalled()
  })
  it('ignores stdout lines that are not protocol messages', async () => {
    const c = fakeChild()
    const w = helperSubtitlesHost({ spawn: () => c.child, fallback: fakeFallback().host }).open(URL_, B)
    c.stdout.write('some log line\nlinto-subtitles:{broken\n')
    c.say({ type: 'bounds', bounds: { x: 'nope' } })
    await tick()
    expect(w.bounds()).toEqual(B)
  })
  it('a helper that dies before its window shows falls back to the in-process window', async () => {
    const c = fakeChild()
    const f = fakeFallback()
    const w = helperSubtitlesHost({ spawn: () => c.child, fallback: f.host }).open(URL_, B)
    const closed = vi.fn()
    w.onClosed(closed)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    c.fail()
    c.exit()
    expect(f.host.open).toHaveBeenCalledTimes(1)
    expect(f.host.open).toHaveBeenCalledWith(URL_, B)
    expect(closed).not.toHaveBeenCalled()
    w.close()
    expect(f.win.close).toHaveBeenCalled()
    expect(closed).toHaveBeenCalledTimes(1)
  })
  it('closed by us before it was ready: no fallback', async () => {
    const c = fakeChild()
    const f = fakeFallback()
    const w = helperSubtitlesHost({ spawn: () => c.child, fallback: f.host }).open(URL_, B)
    const closed = vi.fn()
    w.onClosed(closed)
    w.close()
    c.exit()
    expect(f.host.open).not.toHaveBeenCalled()
    expect(closed).toHaveBeenCalledTimes(1)
  })
})

describe('runSubtitlesHelper (helper side)', () => {
  function setup() {
    const input = new PassThrough()
    const out: string[] = []
    let closedCb: (() => void) | null = null
    const win = {
      close: vi.fn(() => closedCb?.()),
      onClosed: vi.fn((cb: () => void) => { closedCb = cb }),
      bounds: () => ({ x: 5, y: 6, width: 800, height: 100 })
    }
    const host = { open: vi.fn(() => win) }
    const quit = vi.fn()
    runSubtitlesHelper({ input, write: (l) => out.push(l), host, quit })
    return { input, out, win, host, quit, closeFromWindow: () => closedCb?.() }
  }
  it('opens the requested window and says it is ready', async () => {
    const h = setup()
    h.input.write(JSON.stringify({ url: URL_, bounds: B }) + '\n')
    await tick()
    expect(h.host.open).toHaveBeenCalledWith(URL_, B)
    expect(h.out).toEqual(['linto-subtitles:{"type":"ready"}\n'])
  })
  it('closed by the user (× / Esc): reports its bounds and quits', async () => {
    const h = setup()
    h.input.write(JSON.stringify({ url: URL_, bounds: B }) + '\n')
    await tick()
    h.closeFromWindow()
    expect(h.out[1]).toBe('linto-subtitles:{"type":"bounds","bounds":{"x":5,"y":6,"width":800,"height":100}}\n')
    expect(h.quit).toHaveBeenCalled()
  })
  it('stdin closed by the parent: closes the window', async () => {
    const h = setup()
    h.input.write(JSON.stringify({ url: URL_, bounds: B }) + '\n')
    await tick()
    h.input.end()
    await tick()
    expect(h.win.close).toHaveBeenCalled()
    expect(h.quit).toHaveBeenCalled()
  })
  it('quits on a malformed request or a closed stdin before any request', async () => {
    const a = setup()
    a.input.write('not json\n')
    await tick()
    expect(a.quit).toHaveBeenCalled()
    expect(a.host.open).not.toHaveBeenCalled()
    const b = setup()
    b.input.end()
    await tick()
    expect(b.quit).toHaveBeenCalled()
  })
})
