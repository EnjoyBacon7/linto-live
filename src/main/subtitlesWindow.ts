import { restoreBounds } from './appLifecycle'
import { lockNavigation } from './security'
import type { Bounds } from '../shared/types'

/** Subtitle window: a borderless, always-on-top band of the live captions (the overlay page, mode=window). */
export const SUBTITLES_WINDOW_SIZE = { width: 960, height: 120, minWidth: 320, minHeight: 60 } as const

/** A short band: 100 px wide and 30 px high on a display are enough to grab it back. */
const MIN_VISIBLE = { width: 100, height: 30 }

/** Space left under the default window, above the bottom of the work area (Dock, taskbar). */
const BOTTOM_MARGIN = 48

/** The overlay page URL (with its key) in window mode. */
export function subtitlesWindowUrl(overlayUrl: string): string {
  const u = new URL(overlayUrl)
  u.searchParams.set('mode', 'window')
  return u.toString()
}

/** Saved bounds if still on a display; otherwise the default size, centred at the bottom of the primary work area. */
export function subtitlesWindowBounds(saved: Bounds | undefined, displays: Bounds[], primary: Bounds): Bounds {
  const { width, height } = SUBTITLES_WINDOW_SIZE
  const b = restoreBounds(saved, displays, { width, height }, MIN_VISIBLE)
  if ('x' in b) return b
  return {
    x: Math.round(primary.x + (primary.width - width) / 2),
    y: Math.round(primary.y + primary.height - height - BOTTOM_MARGIN),
    width,
    height
  }
}

/** The real window (electronSubtitlesHost in the app; a fake in tests). */
export interface SubtitlesWindowHost {
  /** onClosed: the window is gone, whoever closed it; bounds() then gives its last known bounds. */
  open(url: string, bounds: Bounds): { close(): void; onClosed(cb: () => void): void; bounds(): Bounds }
}

/** The slice of Electron's BrowserWindow the subtitle window uses (tests inject a fake). */
export interface SubtitlesBrowserWindow {
  on(event: 'closed' | 'move' | 'resize', listener: () => void): unknown
  getBounds(): Bounds
  isDestroyed(): boolean
  close(): void
  setAlwaysOnTop(flag: boolean, level: 'floating'): void
  setVisibleOnAllWorkspaces(visible: boolean, options: { visibleOnFullScreen: boolean }): void
  loadURL(url: string): Promise<void>
  webContents: Parameters<typeof lockNavigation>[0]
}

/**
 * Borderless, always-on-top window of the subtitle band. A page's own window.close() (× or Esc) only emits
 * 'closed', once the window is destroyed: the bounds are tracked on every move/resize instead of read then.
 */
export function electronSubtitlesHost(
  create: (options: Record<string, unknown>) => SubtitlesBrowserWindow,
  platform: string,
  extra: Record<string, unknown> = {}
): SubtitlesWindowHost {
  return {
    open(url, bounds) {
      const w = create({
        ...bounds,
        minWidth: SUBTITLES_WINDOW_SIZE.minWidth,
        minHeight: SUBTITLES_WINDOW_SIZE.minHeight,
        title: 'LinTO Live — sous-titres',
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: true,
        fullscreenable: false,
        maximizable: false,
        minimizable: false,
        backgroundColor: '#000000',
        ...extra,
        webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false }
      })
      // Above other apps' windows, including (macOS) full-screen ones and on every Space. GNOME ignores it for
      // a native Wayland window: in a Wayland session this window is opened by the X11 helper (subtitlesHelper.ts).
      w.setAlwaysOnTop(true, 'floating')
      if (platform === 'darwin') w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      let last = w.getBounds()
      const track = (): void => { if (!w.isDestroyed()) last = w.getBounds() }
      w.on('move', track)
      w.on('resize', track)
      lockNavigation(w.webContents, url)
      void w.loadURL(url)
      return {
        close: () => { if (!w.isDestroyed()) w.close() },
        onClosed: (cb) => { w.on('closed', cb) },
        bounds: () => (w.isDestroyed() ? last : w.getBounds())
      }
    }
  }
}

export const MSG_SUBTITLES_NOT_READY = 'Les sous-titres ne sont pas encore prêts.'

export class SubtitlesWindow {
  private win: ReturnType<SubtitlesWindowHost['open']> | null = null

  constructor(private o: {
    host: SubtitlesWindowHost
    /** Overlay page URL, null while the subtitle server is not up. */
    url(): string | null
    bounds(): Bounds
    saveBounds(b: Bounds): void
    onChange(open: boolean): void
  }) {}

  isOpen(): boolean {
    return this.win !== null
  }

  /** Opens the window, or closes it when open; whether it is open now. Throws before the subtitle server is up. */
  toggle(): boolean {
    if (this.win) {
      this.close()
      return false
    }
    const url = this.o.url()
    if (url === null) throw new Error(MSG_SUBTITLES_NOT_READY)
    const win = this.o.host.open(subtitlesWindowUrl(url), this.o.bounds())
    this.win = win
    // Fires for every close: the toggle, quitting, or the page's own × / Esc.
    win.onClosed(() => {
      if (this.win !== win) return
      this.win = null
      try {
        this.o.saveBounds(win.bounds())
      } catch (e) {
        console.error('Saving the subtitle window bounds failed', e)
      }
      this.o.onChange(false)
    })
    this.o.onChange(true)
    return true
  }

  close(): void {
    this.win?.close()
  }
}
