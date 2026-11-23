import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import type { SubtitlesWindowHost } from './subtitlesWindow'
import type { Bounds } from '../shared/types'

/**
 * GNOME on Wayland gives a native Wayland window no way to stay on top: Electron's alwaysOnTop is ignored.
 * It does honour it for X11 windows (XWayland), and Electron picks X11 or Wayland once, at launch, for the
 * whole process. So in a Wayland session the subtitle window lives in a second instance of the app started
 * with --ozone-platform=x11 (« the helper »), which only opens that window; the main window stays native.
 *
 * Protocol, one JSON object per line. Parent → helper on stdin: { url, bounds } (the URL carries the overlay
 * key: never on the command line, which any local user can read in /proc). Closing stdin closes the window.
 * Helper → parent on stdout, prefixed with LINE_PREFIX: { type: 'ready' }, then { type: 'bounds', bounds }
 * as the window closes, then the helper quits.
 */
export const HELPER_SWITCH = '--linto-subtitles-window'
const LINE_PREFIX = 'linto-subtitles:'
/** A helper that ignores the closed stdin is killed after this. */
const KILL_AFTER_MS = 3000

type HelperMessage = { type: 'ready' } | { type: 'bounds'; bounds: Bounds }

/** Whether this process is the subtitle-window helper. */
export const isSubtitlesHelper = (argv: readonly string[]): boolean => argv.includes(HELPER_SWITCH)

/** In a Wayland session on Linux, the subtitle window needs the X11 helper to stay on top. */
export const needsSubtitlesHelper = (platform: string, wayland: boolean): boolean => platform === 'linux' && wayland

/**
 * The helper's command line: the same executable (through zypak-wrapper in the Flatpak, like the app's own
 * launcher), plus the app folder in development (`electron <app>`; a packaged app knows its own).
 */
export function subtitlesHelperCommand(o: { execPath: string; appPath: string | null; flatpak: boolean }): {
  command: string
  args: string[]
} {
  const args = [...(o.appPath === null ? [] : [o.appPath]), HELPER_SWITCH, '--ozone-platform=x11']
  return o.flatpak ? { command: 'zypak-wrapper', args: [o.execPath, ...args] } : { command: o.execPath, args }
}

const isBounds = (b: unknown): b is Bounds =>
  typeof b === 'object' && b !== null &&
  (['x', 'y', 'width', 'height'] as const).every((k) => Number.isFinite((b as Record<string, unknown>)[k]))

/** The slice of a ChildProcess the parent uses (tests inject a fake). */
export interface HelperChild {
  stdin: Writable | null
  stdout: Readable | null
  on(event: 'close', listener: () => void): unknown
  on(event: 'error', listener: (err: Error) => void): unknown
  kill(): unknown
}

/**
 * Parent side: a SubtitlesWindowHost whose window is the helper's. A helper that dies before showing its
 * window (no XWayland, failed spawn) falls back to the in-process window: on top or not, the band shows.
 */
export function helperSubtitlesHost(o: { spawn(): HelperChild; fallback: SubtitlesWindowHost }): SubtitlesWindowHost {
  return {
    open(url, bounds) {
      const child = o.spawn()
      const closedCbs: Array<() => void> = []
      let last = bounds
      let ready = false
      let closing = false
      let done = false
      let inner: ReturnType<SubtitlesWindowHost['open']> | null = null
      const finish = (): void => {
        if (done) return
        done = true
        for (const cb of closedCbs) cb()
      }
      const ended = (): void => {
        if (done || inner) return
        if (ready || closing) return finish()
        console.error('The subtitle window helper quit before opening its window: opening it in-process')
        inner = o.fallback.open(url, bounds)
        inner.onClosed(finish)
      }
      child.on('error', (err) => {
        console.error('Subtitle window helper', err)
        ended()
      })
      child.on('close', ended)
      if (child.stdout) {
        createInterface({ input: child.stdout }).on('line', (line) => {
          if (!line.startsWith(LINE_PREFIX)) return
          let msg: HelperMessage
          try {
            msg = JSON.parse(line.slice(LINE_PREFIX.length)) as HelperMessage
          } catch {
            return
          }
          if (msg.type === 'ready') ready = true
          else if (msg.type === 'bounds' && isBounds(msg.bounds)) last = msg.bounds
        })
      }
      child.stdin?.on('error', () => {}) // EPIPE once the helper is gone: 'close' reports it
      child.stdin?.write(JSON.stringify({ url, bounds }) + '\n')
      return {
        close: () => {
          if (inner) return inner.close()
          if (done || closing) return
          closing = true
          child.stdin?.end()
          setTimeout(() => { if (!done) child.kill() }, KILL_AFTER_MS).unref()
        },
        onClosed: (cb) => { closedCbs.push(cb) },
        bounds: () => (inner ? inner.bounds() : last)
      }
    }
  }
}

/**
 * Helper side: reads { url, bounds } from the parent, opens the window, reports its bounds when it closes and
 * quits. The parent closing stdin (toggle, quit, crash) closes the window.
 */
export function runSubtitlesHelper(o: {
  input: Readable
  write(line: string): void
  host: SubtitlesWindowHost
  quit(): void
}): void {
  const send = (msg: HelperMessage): void => o.write(LINE_PREFIX + JSON.stringify(msg) + '\n')
  let win: ReturnType<SubtitlesWindowHost['open']> | null = null
  const lines = createInterface({ input: o.input })
  lines.once('line', (line) => {
    let req: { url?: unknown; bounds?: unknown }
    try {
      req = JSON.parse(line) as typeof req
    } catch {
      return o.quit()
    }
    if (typeof req.url !== 'string' || !isBounds(req.bounds)) return o.quit()
    const w = o.host.open(req.url, req.bounds)
    win = w
    w.onClosed(() => {
      send({ type: 'bounds', bounds: w.bounds() })
      o.quit()
    })
    send({ type: 'ready' })
  })
  lines.on('close', () => {
    if (win) win.close()
    else o.quit()
  })
}
