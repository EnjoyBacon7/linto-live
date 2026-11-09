import { normalize, sep } from 'node:path'

/**
 * The bundled renderer is served from this privileged custom scheme rather than file:// (the
 * grantFileProtocolExtraPrivileges fuse is off: file:// pages cannot load their module scripts).
 */
export const RENDERER_SCHEME = 'app'
export const RENDERER_HOST = 'linto-live'
export const RENDERER_URL = `${RENDERER_SCHEME}://${RENDERER_HOST}/index.html`

/** Where the main window loads its page: the dev server URL only in development, the bundled page otherwise. */
export function rendererEntry(packaged: boolean, envUrl: string | undefined): string {
  return !packaged && envUrl ? envUrl : RENDERER_URL
}

/** File served for an app://linto-live/… request, or null when it is not one or points outside `root`. */
export function rendererFilePath(url: string, root: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== `${RENDERER_SCHEME}:` || u.host !== RENDERER_HOST) return null
  let rel: string
  try {
    rel = decodeURIComponent(u.pathname)
  } catch {
    return null
  }
  const base = normalize(root + sep)
  const p = normalize(base + rel)
  return p.startsWith(base) && p.length > base.length ? p : null
}

/** Structural slice of Electron's Session (tests inject a fake). */
export interface PermissionSession {
  setPermissionRequestHandler(handler: (wc: unknown, permission: unknown, callback: (granted: boolean) => void) => void): void
  setPermissionCheckHandler(handler: (wc: unknown, permission: unknown) => boolean): void
}

/**
 * Neither the app UI nor the SSO pages need any web permission: the camera and microphone are used by
 * OBS, notifications come from the main process.
 */
export function denyAllPermissions(ses: PermissionSession): void {
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
}

/** Same scheme, host and port as the page the window was given. */
export function isOwnPage(url: string, entry: string): boolean {
  try {
    const u = new URL(url)
    const e = new URL(entry)
    return u.protocol === e.protocol && u.host === e.host
  } catch {
    return false
  }
}

interface NavigableContents {
  on(event: 'will-navigate', listener: (e: { preventDefault(): void }, url: string) => void): unknown
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void
}

/** The main window never leaves its own page and never opens another window. */
export function lockNavigation(wc: NavigableContents, entry: string): void {
  wc.on('will-navigate', (e, url) => {
    if (!isOwnPage(url, entry)) e.preventDefault()
  })
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
}
