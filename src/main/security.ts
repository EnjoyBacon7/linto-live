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
