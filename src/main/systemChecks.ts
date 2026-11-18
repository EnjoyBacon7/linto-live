import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { release } from 'node:os'
import type { SystemCheck } from '../shared/types'
import { v4l2loopbackLoaded } from './obs/virtualCam'

/**
 * First-launch checks (Linux). macOS asks for camera and micro access on the first-launch page; Linux
 * has no such prompts, but the system may lack what some features rely on, and the user would otherwise
 * only find out mid-show: a keyring (remembered login), v4l2loopback (virtual camera), a tray.
 */

const HOST_MODPROBE = 'sudo modprobe v4l2loopback exclusive_caps=1 card_label="OBS Virtual Camera"'

export const FIX_KEYRING =
  'Aucun trousseau de clés utilisable (GNOME Keyring, KWallet) : LinTO Live ne peut pas retenir ta connexion, ' +
  'il faudra te reconnecter à chaque lancement. Installe ou déverrouille un trousseau, puis relance LinTO Live.'
export const FIX_VCAM =
  'Le module v4l2loopback n’est pas installé : la caméra virtuelle (LinTO Live comme webcam dans ' +
  'Teams, Zoom…) ne sera pas disponible. Installe le paquet v4l2loopback-dkms, puis relance LinTO Live.'
export const FIX_VCAM_FLATPAK =
  'Le module v4l2loopback n’est pas chargé : en Flatpak, la caméra virtuelle (LinTO Live comme webcam dans ' +
  `Teams, Zoom…) en a besoin avant le lancement. Installe v4l2loopback-dkms, lance « ${HOST_MODPROBE} », ` +
  'puis relance LinTO Live.'
export const FIX_TRAY =
  'Ton bureau n’affiche pas d’icône dans la zone de notification (GNOME sans l’extension AppIndicator, ' +
  'notamment) : pendant un direct, fermer la fenêtre la réduit dans la barre des tâches. Pour avoir l’icône, ' +
  'installe l’extension « AppIndicator and KStatusNotifierItem Support ».'

export interface SystemCheckOps {
  readFile(path: string): Promise<string>
  run(cmd: string, args: string[]): Promise<string>
  kernelRelease: string
}

const systemOps: SystemCheckOps = {
  readFile: (path) => readFile(path, 'utf8'),
  run: (cmd, args) =>
    new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: 3_000 }, (err, out) => (err ? reject(err) : resolve(out)))
    }),
  kernelRelease: release()
}

/** True when the running kernel can load v4l2loopback (modules.dep lists dkms modules too). */
export function v4l2loopbackInstalled(modulesDep: string): boolean {
  return /(^|\/)v4l2loopback\.ko(\.[a-z]+)?:/m.test(modulesDep)
}

/**
 * Virtual camera: loaded, or (outside Flatpak, which only sees the host's loaded modules) installed, as
 * the virtual-camera preflight loads it on demand. A check that cannot run is no reason to warn.
 */
async function virtualCamera(flatpak: boolean, ops: SystemCheckOps): Promise<SystemCheck> {
  const loaded = await ops.readFile('/proc/modules').then(v4l2loopbackLoaded, () => null)
  if (loaded) return { id: 'virtual-camera', ok: true }
  if (flatpak) return loaded === null ? { id: 'virtual-camera', ok: true } : { id: 'virtual-camera', ok: false, fix: FIX_VCAM_FLATPAK }
  const installed = await ops.readFile(`/lib/modules/${ops.kernelRelease}/modules.dep`).then(v4l2loopbackInstalled, () => null)
  return installed === false ? { id: 'virtual-camera', ok: false, fix: FIX_VCAM } : { id: 'virtual-camera', ok: true }
}

/** Tray: Electron's Linux tray is a StatusNotifierItem, shown only where a StatusNotifierWatcher runs. */
async function tray(ops: SystemCheckOps): Promise<SystemCheck> {
  let out: string
  try {
    out = await ops.run('gdbus', [
      'call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus',
      '--method', 'org.freedesktop.DBus.NameHasOwner', 'org.kde.StatusNotifierWatcher'
    ])
  } catch {
    return { id: 'tray', ok: true }
  }
  return /\bfalse\b/.test(out) ? { id: 'tray', ok: false, fix: FIX_TRAY } : { id: 'tray', ok: true }
}

export async function linuxSystemChecks(
  o: { flatpak: boolean; canRememberLogin: boolean }, ops: SystemCheckOps = systemOps
): Promise<SystemCheck[]> {
  const keyring: SystemCheck = o.canRememberLogin ? { id: 'keyring', ok: true } : { id: 'keyring', ok: false, fix: FIX_KEYRING }
  const [vcam, t] = await Promise.all([virtualCamera(o.flatpak, ops), tray(ops)])
  return [keyring, vcam, t]
}
