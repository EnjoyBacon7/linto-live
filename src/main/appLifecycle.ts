import type { LiveState } from '../shared/ipc'

/** Electron-free helpers for main.ts (single instance, quit confirmation, display hot-plug). */

interface LockApp {
  requestSingleInstanceLock(): boolean
  quit(): void
  on(event: 'second-instance', listener: () => void): unknown
}

/**
 * Two instances would each start an OBS on the same isolated profile: the second one quits right away
 * (before booting OBS) and the first one comes to the front instead.
 */
export function acquireSingleInstance(app: LockApp, focus: () => void): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return false
  }
  app.on('second-instance', focus)
  return true
}

interface FocusableWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}

export function focusWindow(w: FocusableWindow | null): void {
  if (!w || w.isDestroyed()) return
  if (w.isMinimized()) w.restore()
  w.show()
  w.focus()
}

export const QUIT_DIALOG = {
  type: 'warning' as const,
  message: 'Arrêter la diffusion et quitter ?',
  buttons: ['Annuler', 'Quitter'],
  defaultId: 0,
  cancelId: 0
}

interface Preventable {
  preventDefault(): void
}

export interface QuitGuardDeps {
  phase(): LiveState['phase']
  /** Shows QUIT_DIALOG; true when the user chose Quitter. */
  ask(): Promise<boolean>
  /** app.quit() — re-enters onBeforeQuit. */
  quit(): void
  /** The capped shutdown followed by app.exit(). */
  shutdown(): void
}

/** Closing the app = Arrêter; while a show is live the user confirms first (window close or Cmd+Q). */
export function createQuitGuard(d: QuitGuardDeps): {
  onWindowClose(e: Preventable): void
  onBeforeQuit(e: Preventable): void
  markQuitting(): void
} {
  let confirmed = false
  let asking = false
  let quitting = false
  const mustAsk = (): boolean => !confirmed && d.phase() === 'live'
  const confirmThenQuit = (): void => {
    if (asking) return
    asking = true
    d.ask().then(
      (ok) => {
        asking = false
        if (!ok) return
        confirmed = true
        d.quit()
      },
      () => (asking = false)
    )
  }
  return {
    onWindowClose(e) {
      if (quitting || !mustAsk()) return
      e.preventDefault()
      confirmThenQuit()
    },
    onBeforeQuit(e) {
      e.preventDefault() // always, while our shutdown is in progress; app.exit() does not re-emit
      if (quitting) return
      if (mustAsk()) return confirmThenQuit()
      quitting = true
      d.shutdown()
    },
    /** The caller runs its own shutdown (uninstall): no dialog, no second shutdown. */
    markQuitting() {
      quitting = true
    }
  }
}

interface ScreenEvents {
  on(event: 'display-added' | 'display-removed' | 'display-metrics-changed', listener: () => void): unknown
  removeListener(event: 'display-added' | 'display-removed' | 'display-metrics-changed', listener: () => void): unknown
}

const DISPLAY_EVENTS = ['display-added', 'display-removed', 'display-metrics-changed'] as const

/**
 * Calls `onChange` after display hot-plug, debounced (bursts of events), and once more a few seconds
 * later: OBS's monitor list can lag behind Electron's.
 */
export function watchDisplays(screen: ScreenEvents, onChange: () => void, delaysMs: number[] = [1_000, 5_000]): () => void {
  let timers: ReturnType<typeof setTimeout>[] = []
  const clear = (): void => {
    timers.forEach(clearTimeout)
    timers = []
  }
  const handler = (): void => {
    clear()
    timers = delaysMs.map((ms) => setTimeout(onChange, ms))
  }
  for (const e of DISPLAY_EVENTS) screen.on(e, handler)
  return () => {
    clear()
    for (const e of DISPLAY_EVENTS) screen.removeListener(e, handler)
  }
}
