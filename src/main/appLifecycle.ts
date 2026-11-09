import type { LiveState } from '../shared/ipc'
import type { Bounds } from '../shared/types'

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
  /** Hides the main window (the show keeps running; the tray/Dock brings it back). */
  hide(): void
}

/**
 * Closing the main window while a show is live or starting only hides it (the show continues).
 * Quitting the app = Arrêter; while a show is live the user confirms first (Cmd+Q, menu, tray).
 */
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
      if (quitting || confirmed) return
      const phase = d.phase()
      if (phase !== 'live' && phase !== 'starting') return // nothing on air: v1 behaviour, the app quits
      e.preventDefault()
      d.hide()
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

export type { Bounds }

/** Main window size (Apple HIG-ish: comfortable default, never cramped). */
export const WINDOW_SIZE = { width: 1100, height: 720, minWidth: 860, minHeight: 560 } as const

const MIN_VISIBLE = 100

const finite = (b: Bounds): boolean =>
  [b.x, b.y, b.width, b.height].every((n) => typeof n === 'number' && Number.isFinite(n)) && b.width > 0 && b.height > 0

/**
 * Saved window bounds are reused only if at least 100×100 px of the window lands on one display's
 * work area (a display may have been unplugged since); otherwise the default size, centred by Electron.
 */
export function restoreBounds(
  saved: Bounds | undefined,
  displays: Bounds[],
  def: { width: number; height: number }
): Bounds | { width: number; height: number } {
  if (!saved || !finite(saved)) return def
  const visible = displays.some((d) => {
    const w = Math.min(saved.x + saved.width, d.x + d.width) - Math.max(saved.x, d.x)
    const h = Math.min(saved.y + saved.height, d.y + d.height) - Math.max(saved.y, d.y)
    return w >= MIN_VISIBLE && h >= MIN_VISIBLE
  })
  return visible ? saved : def
}

export type WindowChrome =
  | {
      titleBarStyle: 'hiddenInset'
      trafficLightPosition: { x: number; y: number }
      vibrancy: 'sidebar'
      visualEffectState: 'followWindow'
      backgroundColor: string
    }
  | { backgroundColor: string }

/**
 * macOS: title bar merged into the content, traffic lights inside the translucent sidebar.
 * Linux: the system frame (integration is not reliable across desktops) and a solid background.
 */
export function windowChrome(platform: string, dark: boolean): WindowChrome {
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 18, y: 18 },
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
      backgroundColor: '#00000000'
    }
  }
  return { backgroundColor: dark ? '#1e1e1e' : '#ececec' }
}
