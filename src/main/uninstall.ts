import { posix } from 'node:path'

export interface UninstallInput {
  platform: NodeJS.Platform
  home: string
  userData: string
  appId: 'ai.linto.live'
  appName: 'LinTO Live'
  exePath: string
  appImage?: string
  personalObsInstalled: boolean
  /** Resolved by the caller: ~/.local/share/applications/*linto-live*.desktop (linux). */
  desktopFiles: string[]
}

export interface UninstallPlan {
  remove: string[]
  trash: string | null
}

export class UninstallError extends Error {
  constructor(readonly failed: string[]) {
    super(`Could not remove: ${failed.join(', ')}`)
  }
}

const APP_BUNDLE = 'LinTO Live.app'

function assertSafe(p: string, home: string, label: string): void {
  const bad = (why: string): never => {
    throw new Error(`Unsafe uninstall path (${why}): ${label} ${JSON.stringify(p)}`)
  }
  if (!posix.isAbsolute(p)) bad('not absolute')
  if (posix.normalize(p) !== p || (p.length > 1 && p.endsWith('/'))) bad('not normalized')
  if (!p.startsWith(home + '/')) bad('outside home')
  const protectedDirs = [
    'Library',
    'Library/Application Support',
    '.config',
    '.cache',
    '.local/share/applications'
  ].map((d) => posix.join(home, d))
  if (protectedDirs.includes(p)) bad('protected directory')
}

export function uninstallTargets(o: UninstallInput): UninstallPlan {
  const home = o.home
  if (!posix.isAbsolute(home) || posix.normalize(home) !== home || home === '/' || home.endsWith('/')) {
    throw new Error(`Unsafe home directory: ${JSON.stringify(home)}`)
  }
  const j = (...s: string[]): string => posix.join(home, ...s)
  let remove: string[]
  let trash: string | null = null

  if (o.platform === 'darwin') {
    remove = [
      o.userData,
      j('Library/Caches', o.appName),
      j('Library/Caches', o.appId),
      j('Library/Logs', o.appName),
      j('Library/Preferences', `${o.appId}.plist`),
      j('Library/Saved Application State', `${o.appId}.savedState`)
    ]
    // The isolated OBS plist is ours only when the user has no OBS of their own.
    if (!o.personalObsInstalled) remove.push(j('Library/Preferences/com.obsproject.obs-studio.plist'))
    // <root>.app/Contents/MacOS/<exe>
    const macos = posix.dirname(o.exePath)
    const contents = posix.dirname(macos)
    const root = posix.dirname(contents)
    if (
      posix.isAbsolute(o.exePath) &&
      posix.basename(macos) === 'MacOS' &&
      posix.basename(contents) === 'Contents' &&
      posix.basename(root) === APP_BUNDLE
    ) {
      trash = root
    }
  } else {
    remove = [o.userData, j('.cache', o.appName), ...o.desktopFiles]
    if (
      o.appImage &&
      posix.isAbsolute(o.appImage) &&
      posix.normalize(o.appImage) === o.appImage &&
      !o.appImage.endsWith('/') &&
      posix.basename(o.appImage).endsWith('.AppImage')
    ) {
      trash = o.appImage
    }
  }

  if (posix.basename(o.userData) !== o.appName) {
    throw new Error(`Unsafe userData (basename must be "${o.appName}"): ${JSON.stringify(o.userData)}`)
  }
  if (o.platform !== 'darwin') {
    const appsDir = posix.join(home, '.local/share/applications')
    for (const f of o.desktopFiles) {
      if (posix.dirname(f) !== appsDir || !f.endsWith('.desktop') || posix.basename(f) === '.desktop') {
        throw new Error(`Unsafe desktop file path: ${JSON.stringify(f)}`)
      }
    }
  }
  remove.forEach((p) => assertSafe(p, home, 'remove'))
  return { remove, trash }
}

/**
 * Detail of the confirmation dialog. On Linux without an AppImage, the app was installed by the .deb
 * package (/opt, root-owned): only its data can be removed from inside, the package goes through apt.
 */
export function uninstallConfirmDetail(t: UninstallPlan, platform: NodeJS.Platform): string {
  const base = 'Cette action est définitive.'
  if (platform !== 'linux' || t.trash) return base
  return `${base} Ses données seront effacées ; l'application elle-même, installée par un paquet système, se retire ensuite avec « sudo apt remove linto-live ».`
}

/** Removes everything it can; failures never stop the rest. Throws UninstallError listing what is left. */
export async function runUninstall(
  t: UninstallPlan,
  fs: { rm(p: string): Promise<void>; trash(p: string): Promise<void> }
): Promise<void> {
  const failed: string[] = []
  for (const p of t.remove) {
    try {
      await fs.rm(p)
    } catch {
      failed.push(p)
    }
  }
  if (t.trash) {
    try {
      await fs.trash(t.trash)
    } catch {
      failed.push(t.trash)
    }
  }
  if (failed.length) throw new UninstallError(failed)
}
