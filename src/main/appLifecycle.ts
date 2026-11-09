import type { LiveState } from '../shared/ipc'

/** Electron-free helpers for main.ts (single instance, quit confirmation). */

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
