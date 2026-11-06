import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QUIT_DIALOG, acquireSingleInstance, createQuitGuard, focusWindow, watchDisplays } from '../src/main/appLifecycle'
import type { LiveState } from '../src/shared/ipc'

const ev = () => ({ preventDefault: vi.fn() })
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('acquireSingleInstance', () => {
  it('quits immediately when another instance holds the lock', () => {
    const app = Object.assign(new EventEmitter(), { requestSingleInstanceLock: vi.fn(() => false), quit: vi.fn() })
    const focus = vi.fn()
    expect(acquireSingleInstance(app, focus)).toBe(false)
    expect(app.quit).toHaveBeenCalled()
    app.emit('second-instance')
    expect(focus).not.toHaveBeenCalled()
  })
  it('keeps the lock and focuses the existing window on second-instance', () => {
    const app = Object.assign(new EventEmitter(), { requestSingleInstanceLock: vi.fn(() => true), quit: vi.fn() })
    const focus = vi.fn()
    expect(acquireSingleInstance(app, focus)).toBe(true)
    expect(app.quit).not.toHaveBeenCalled()
    app.emit('second-instance')
    expect(focus).toHaveBeenCalledTimes(1)
  })
})

describe('focusWindow', () => {
  const win = (minimized: boolean, destroyed = false) => ({
    isDestroyed: vi.fn(() => destroyed), isMinimized: vi.fn(() => minimized),
    restore: vi.fn(), show: vi.fn(), focus: vi.fn()
  })
  it('restores a minimized window and focuses it', () => {
    const w = win(true)
    focusWindow(w)
    expect(w.restore).toHaveBeenCalled()
    expect(w.show).toHaveBeenCalled()
    expect(w.focus).toHaveBeenCalled()
  })
  it('ignores a missing or destroyed window', () => {
    expect(() => focusWindow(null)).not.toThrow()
    const w = win(false, true)
    focusWindow(w)
    expect(w.focus).not.toHaveBeenCalled()
  })
})

describe('createQuitGuard', () => {
  function mk(phase: LiveState['phase'], answer: boolean) {
    let p = phase
    const d = { phase: vi.fn(() => p), ask: vi.fn(async () => answer), quit: vi.fn(), shutdown: vi.fn() }
    return { d, g: createQuitGuard(d), setPhase: (x: LiveState['phase']) => (p = x) }
  }
  it('dialog copy: Annuler is default and cancel', () => {
    expect(QUIT_DIALOG).toMatchObject({ message: 'Arrêter la diffusion et quitter ?', buttons: ['Annuler', 'Quitter'], defaultId: 0, cancelId: 0 })
  })
  it('not live: close and quit proceed without asking, shutdown once', () => {
    const { d, g } = mk('idle', false)
    const c = ev()
    g.onWindowClose(c)
    expect(c.preventDefault).not.toHaveBeenCalled()
    const q1 = ev()
    g.onBeforeQuit(q1)
    g.onBeforeQuit(ev())
    expect(q1.preventDefault).toHaveBeenCalled() // the capped shutdown runs first, then app.exit
    expect(d.ask).not.toHaveBeenCalled()
    expect(d.shutdown).toHaveBeenCalledTimes(1)
  })
  it('live + Annuler: window stays, nothing stops', async () => {
    const { d, g } = mk('live', false)
    const c = ev()
    g.onWindowClose(c)
    expect(c.preventDefault).toHaveBeenCalled()
    await flush()
    expect(d.ask).toHaveBeenCalledTimes(1)
    expect(d.quit).not.toHaveBeenCalled()
    const q = ev()
    g.onBeforeQuit(q)
    expect(q.preventDefault).toHaveBeenCalled()
    await flush()
    expect(d.ask).toHaveBeenCalledTimes(2)
    expect(d.shutdown).not.toHaveBeenCalled()
  })
  it('live + Quitter on close: quits, then before-quit shuts down without asking again', async () => {
    const { d, g } = mk('live', true)
    g.onWindowClose(ev())
    g.onWindowClose(ev()) // second click while the dialog is open: one dialog only
    await flush()
    expect(d.ask).toHaveBeenCalledTimes(1)
    expect(d.quit).toHaveBeenCalledTimes(1)
    g.onBeforeQuit(ev())
    expect(d.ask).toHaveBeenCalledTimes(1)
    expect(d.shutdown).toHaveBeenCalledTimes(1)
  })
  it('live + Cmd+Q: asks, then shuts down on Quitter', async () => {
    const { d, g } = mk('live', true)
    g.onBeforeQuit(ev())
    expect(d.shutdown).not.toHaveBeenCalled()
    await flush()
    expect(d.quit).toHaveBeenCalledTimes(1)
    g.onBeforeQuit(ev())
    expect(d.shutdown).toHaveBeenCalledTimes(1)
  })
  it('markQuitting (uninstall) skips both the dialog and the before-quit shutdown', () => {
    const { d, g } = mk('live', true)
    g.markQuitting()
    const c = ev()
    g.onWindowClose(c)
    expect(c.preventDefault).not.toHaveBeenCalled()
    g.onBeforeQuit(ev())
    expect(d.ask).not.toHaveBeenCalled()
    expect(d.shutdown).not.toHaveBeenCalled()
  })
})

describe('watchDisplays', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })
  it('reports add/remove/metrics changes, debounced, with a late re-check', () => {
    const screen = new EventEmitter()
    const onChange = vi.fn()
    watchDisplays(screen, onChange)
    screen.emit('display-removed')
    screen.emit('display-metrics-changed')
    vi.advanceTimersByTime(999)
    expect(onChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onChange).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(4_000) // OBS may see the new monitor list later than Electron
    expect(onChange).toHaveBeenCalledTimes(2)
    screen.emit('display-added')
    vi.advanceTimersByTime(10_000)
    expect(onChange).toHaveBeenCalledTimes(4)
  })
  it('unsubscribes', () => {
    const screen = new EventEmitter()
    const onChange = vi.fn()
    const stop = watchDisplays(screen, onChange)
    stop()
    screen.emit('display-added')
    vi.advanceTimersByTime(10_000)
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.listenerCount('display-added')).toBe(0)
  })
})
