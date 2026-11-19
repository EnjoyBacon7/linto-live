import type { MediaAccess, MediaPermission, PermissionsStatus, SystemCheck } from '../shared/types'

/**
 * First-launch permissions (macOS). OBS captures the camera and the microphone, but it runs as a child of
 * LinTO Live, so macOS asks for (and remembers) these accesses in LinTO Live's name: asking them from the
 * app itself, on a page that says why, is what lets OBS use the devices. Linux has no such prompts: the
 * same page lists what the system lacks instead (systemChecks.ts).
 */

export const MEDIA_PERMISSIONS: readonly MediaPermission[] = ['camera', 'microphone']

const ACCESS: readonly MediaAccess[] = ['not-determined', 'granted', 'denied', 'restricted', 'unknown']

export function asMediaAccess(v: unknown): MediaAccess {
  return (ACCESS as readonly unknown[]).includes(v) ? (v as MediaAccess) : 'unknown'
}

export function isMediaPermission(v: unknown): v is MediaPermission {
  return (MEDIA_PERMISSIONS as readonly unknown[]).includes(v)
}

/** Structural slice of Electron's systemPreferences (macOS only; tests inject a fake). */
export interface MediaAccessApi {
  getMediaAccessStatus(kind: MediaPermission): string
  askForMediaAccess(kind: MediaPermission): Promise<boolean>
}

export function permissionsStatus(platform: NodeJS.Platform, onboarded: boolean, sys: MediaAccessApi | null): PermissionsStatus {
  if (platform !== 'darwin' || !sys) return { needed: false, camera: 'granted', microphone: 'granted' }
  const camera = asMediaAccess(sys.getMediaAccessStatus('camera'))
  const microphone = asMediaAccess(sys.getMediaAccessStatus('microphone'))
  // Already granted (an older version, or reset settings): nothing to ask.
  return { needed: !onboarded && (camera !== 'granted' || microphone !== 'granted'), camera, microphone }
}

/** Linux: the page shows once, and only when the system lacks something (as macOS skips it when all is granted). */
export function linuxPermissionsStatus(onboarded: boolean, system: SystemCheck[]): PermissionsStatus {
  return { needed: !onboarded && system.some((c) => !c.ok), camera: 'granted', microphone: 'granted', system }
}

/**
 * OBS must not start before the user answered: its camera and micro sources would bring up the system
 * prompts on their own, with no explanation, behind the permissions page.
 */
export function deferObsBoot(s: PermissionsStatus): boolean {
  return s.needed && (s.camera === 'not-determined' || s.microphone === 'not-determined')
}

/** Asks only when macOS never did (afterwards the prompt does not come back); the access now. */
export async function requestMediaAccess(sys: MediaAccessApi, kind: MediaPermission): Promise<MediaAccess> {
  if (asMediaAccess(sys.getMediaAccessStatus(kind)) === 'not-determined') await sys.askForMediaAccess(kind)
  return asMediaAccess(sys.getMediaAccessStatus(kind))
}

const PANES: Record<MediaPermission | 'notifications' | 'screen', string> = {
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  notifications: 'x-apple.systempreferences:com.apple.preference.notifications'
}

/** System Settings pane of a permission (fixed URLs: the renderer never chooses what is opened). */
export function privacySettingsUrl(kind: unknown): string | null {
  return kind === 'notifications' || kind === 'screen' || isMediaPermission(kind) ? PANES[kind] : null
}

export const TEST_NOTIFICATION = {
  title: 'Notifications activées',
  body: 'LinTO Live te préviendra ici quand le direct démarre, s’arrête ou rencontre un problème.'
}
