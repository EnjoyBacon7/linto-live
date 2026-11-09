import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { QUIT_DIALOG, acquireSingleInstance, createQuitGuard, focusWindow, restoreBounds, windowChrome, WINDOW_SIZE } from '../src/main/appLifecycle'
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
    const d = { phase: vi.fn(() => p), ask: vi.fn(async () => answer), quit: vi.fn(), shutdown: vi.fn(), hide: vi.fn() }
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
  it('live or starting: closing the window hides it and the show continues (no dialog)', async () => {
    for (const phase of ['live', 'starting'] as const) {
      const { d, g } = mk(phase, true)
      const c = ev()
      g.onWindowClose(c)
      expect(c.preventDefault).toHaveBeenCalled()
      expect(d.hide).toHaveBeenCalledTimes(1)
      await flush()
      expect(d.ask).not.toHaveBeenCalled()
      expect(d.quit).not.toHaveBeenCalled()
      expect(d.shutdown).not.toHaveBeenCalled()
    }
  })
  it('stopping or error: closing the window closes it (v1 behaviour)', () => {
    for (const phase of ['stopping', 'error'] as const) {
      const { d, g } = mk(phase, true)
      const c = ev()
      g.onWindowClose(c)
      expect(c.preventDefault).not.toHaveBeenCalled()
      expect(d.hide).not.toHaveBeenCalled()
    }
  })
  it('live + Cmd+Q + Annuler: nothing stops, a second Cmd+Q asks again', async () => {
    const { d, g } = mk('live', false)
    const q = ev()
    g.onBeforeQuit(q)
    expect(q.preventDefault).toHaveBeenCalled()
    await flush()
    expect(d.ask).toHaveBeenCalledTimes(1)
    expect(d.quit).not.toHaveBeenCalled()
    g.onBeforeQuit(ev())
    await flush()
    expect(d.ask).toHaveBeenCalledTimes(2)
    expect(d.shutdown).not.toHaveBeenCalled()
  })
  it('live + Cmd+Q while the dialog is open: one dialog only', async () => {
    const { d, g } = mk('live', true)
    g.onBeforeQuit(ev())
    g.onBeforeQuit(ev())
    await flush()
    expect(d.ask).toHaveBeenCalledTimes(1)
    expect(d.quit).toHaveBeenCalledTimes(1)
  })
  it('after Quitter, closing windows during the shutdown is not prevented', async () => {
    const { d, g } = mk('live', true)
    g.onBeforeQuit(ev())
    await flush()
    g.onBeforeQuit(ev())
    expect(d.shutdown).toHaveBeenCalledTimes(1)
    const c = ev()
    g.onWindowClose(c)
    expect(c.preventDefault).not.toHaveBeenCalled()
    expect(d.hide).not.toHaveBeenCalled()
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

describe('restoreBounds', () => {
  const def = { width: 1100, height: 720 }
  const main = { x: 0, y: 25, width: 1440, height: 875 }
  const second = { x: 1440, y: 0, width: 1920, height: 1080 }
  it('returns the saved bounds when they are visible on a display', () => {
    const saved = { x: 100, y: 100, width: 1000, height: 700 }
    expect(restoreBounds(saved, [main], def)).toEqual(saved)
  })
  it('accepts a window on a secondary display', () => {
    const saved = { x: 2000, y: 200, width: 1000, height: 700 }
    expect(restoreBounds(saved, [main, second], def)).toEqual(saved)
  })
  it('falls back to the default when the display it was on is gone', () => {
    const saved = { x: 2000, y: 200, width: 1000, height: 700 }
    expect(restoreBounds(saved, [main], def)).toEqual(def)
  })
  it('falls back when less than 100x100 px would be visible', () => {
    const saved = { x: 1400, y: 100, width: 1000, height: 700 } // 40 px wide strip on the main display
    expect(restoreBounds(saved, [main], def)).toEqual(def)
    const edge = { x: 1340, y: 800, width: 1000, height: 700 } // exactly 100x100 visible
    expect(restoreBounds(edge, [main], def)).toEqual(edge)
  })
  it('falls back when nothing was saved or the value is malformed', () => {
    expect(restoreBounds(undefined, [main], def)).toEqual(def)
    expect(restoreBounds({ x: 0, y: 0, width: Number.NaN, height: 700 }, [main], def)).toEqual(def)
  })
})

describe('windowChrome', () => {
  it('macOS: hidden-inset title bar, traffic lights in the sidebar, vibrancy, transparent background', () => {
    expect(windowChrome('darwin', false)).toEqual({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 18, y: 18 },
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
      backgroundColor: '#00000000'
    })
  })
  it('Linux: system frame, solid background following the system theme', () => {
    expect(windowChrome('linux', true)).toEqual({ backgroundColor: '#1e1e1e' })
    expect(windowChrome('linux', false)).toEqual({ backgroundColor: '#ececec' })
  })
  it('window size constants', () => {
    expect(WINDOW_SIZE).toEqual({ width: 1100, height: 720, minWidth: 860, minHeight: 560 })
  })
})
