import { execFile } from 'node:child_process'
import { access, readFile, readdir } from 'node:fs/promises'
import { release } from 'node:os'
import type { SystemCheck } from '../shared/types'
import { v4l2loopbackLoaded } from './obs/virtualCam'

/**
 * First-launch checks (Linux). macOS asks for camera and micro access on the first-launch page; Linux
 * has no such prompts, but the system may lack what the show or some features rely on, and the user
 * would otherwise only find out mid-show: an X server for the bundled OBS (Qt xcb only), a PulseAudio
 * server (OBS's micro source), a GPU (the captions browser), a keyring (remembered login),
 * v4l2loopback (virtual camera), a tray.
 */

export const FIX_KEYRING =
  'Aucun trousseau de clés utilisable (GNOME Keyring, KWallet) : LinTO Live ne peut retenir ni ta connexion ' +
  'ni la clé de diffusion, il faudra les saisir à chaque lancement. Installe ou déverrouille un trousseau, puis relance LinTO Live.'
export const FIX_VCAM =
  'Le module v4l2loopback n’est pas installé : la caméra virtuelle (LinTO Live comme webcam dans ' +
  'Teams, Zoom…) ne sera pas disponible. Installe le paquet v4l2loopback-dkms, puis relance LinTO Live.'
export const FIX_TRAY =
  'Ton bureau n’affiche pas d’icône dans la zone de notification (GNOME sans l’extension AppIndicator, ' +
  'notamment) : pendant un direct, fermer la fenêtre la réduit dans la barre des tâches. Pour avoir l’icône, ' +
  'installe l’extension « AppIndicator and KStatusNotifierItem Support ».'

export const FIX_NO_X11 =
  'Aucun serveur X (XWayland) : la vidéo de LinTO Live passe par OBS, qui en a besoin pour démarrer. ' +
  'Installe et active XWayland (paquet xwayland), ou ouvre une session X11, puis relance LinTO Live.'
export const FIX_WAYLAND =
  'Session Wayland : la fenêtre de sortie passe par XWayland, et son placement sur le bon écran n’est pas garanti. ' +
  'Pour un vidéoprojecteur, préfère une session X11 (« Ubuntu sur Xorg » à l’écran de connexion).'
export const FIX_AUDIO =
  'Aucun serveur de son PulseAudio : LinTO Live ne verra aucun micro, et rien ne sera transcrit. Avec PipeWire, ' +
  'installe pipewire-pulse (paquet du même nom), puis reconnecte-toi.'
export const FIX_GPU =
  'Aucune accélération graphique détectée : les sous-titres, dessinés par un navigateur intégré à OBS, risquent ' +
  'de ne pas s’afficher. Installe le pilote de ta carte graphique (ou active la 3D de la machine virtuelle).'

export interface SystemCheckOps {
  readFile(path: string): Promise<string>
  run(cmd: string, args: string[]): Promise<string>
  /** Entries of a directory; rejects like fs (code ENOENT when it does not exist). */
  readdir(path: string): Promise<string[]>
  exists(path: string): Promise<boolean>
  kernelRelease: string
  env: NodeJS.ProcessEnv
}

const systemOps: SystemCheckOps = {
  readFile: (path) => readFile(path, 'utf8'),
  readdir: (path) => readdir(path),
  exists: (path) => access(path).then(() => true, () => false),
  env: process.env,
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
 * Virtual camera: loaded, or installed, as the virtual-camera preflight loads it on demand. The Flatpak
 * does not see the host's /lib/modules: it asks the host's modinfo, as OBS does (flatpak-spawn). A check
 * that cannot run is no reason to warn.
 */
async function virtualCamera(flatpak: boolean, ops: SystemCheckOps): Promise<SystemCheck> {
  const loaded = await ops.readFile('/proc/modules').then(v4l2loopbackLoaded, () => null)
  if (loaded) return { id: 'virtual-camera', ok: true }
  if (flatpak) {
    const missing = await ops.run('flatpak-spawn', ['--host', 'modinfo', '-F', 'filename', 'v4l2loopback']).then(
      () => false,
      // A non-zero exit: modinfo ran and found no module; anything else (no flatpak-spawn): unknown.
      (e: { code?: unknown }) => typeof e?.code === 'number'
    )
    return missing ? { id: 'virtual-camera', ok: false, fix: FIX_VCAM } : { id: 'virtual-camera', ok: true }
  }
  const installed = await ops.readFile(`/lib/modules/${ops.kernelRelease}/modules.dep`).then(v4l2loopbackInstalled, () => null)
  return installed === false ? { id: 'virtual-camera', ok: false, fix: FIX_VCAM } : { id: 'virtual-camera', ok: true }
}

/**
 * Whether the desktop shows tray icons: Electron's Linux tray is a StatusNotifierItem, shown only where a
 * StatusNotifierWatcher runs. null when that cannot be told (no gdbus, no session bus).
 */
export async function statusNotifierWatcher(ops: Pick<SystemCheckOps, 'run'> = systemOps): Promise<boolean | null> {
  let out: string
  try {
    out = await ops.run('gdbus', [
      'call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus',
      '--method', 'org.freedesktop.DBus.NameHasOwner', 'org.kde.StatusNotifierWatcher'
    ])
  } catch {
    return null
  }
  if (/\btrue\b/.test(out)) return true
  return /\bfalse\b/.test(out) ? false : null
}

/** Tray: a check that cannot run is no reason to warn. */
async function tray(ops: SystemCheckOps): Promise<SystemCheck> {
  return (await statusNotifierWatcher(ops)) === false ? { id: 'tray', ok: false, fix: FIX_TRAY } : { id: 'tray', ok: true }
}

/**
 * Display: the bundled OBS only has Qt's xcb plugin (paths.ts: QT_QPA_PLATFORM=xcb), so it needs an X
 * server, XWayland in a Wayland session; there, the output window's placement is up to XWayland.
 */
export const isWaylandSession = (env: NodeJS.ProcessEnv): boolean => env.XDG_SESSION_TYPE === 'wayland' || !!env.WAYLAND_DISPLAY

function display(env: NodeJS.ProcessEnv): SystemCheck {
  if (!env.DISPLAY) return { id: 'display', ok: false, fix: FIX_NO_X11, blocking: true }
  return isWaylandSession(env) ? { id: 'display', ok: false, fix: FIX_WAYLAND } : { id: 'display', ok: true }
}

/**
 * Sound: OBS's micro source is PulseAudio's (PipeWire answers it through pipewire-pulse). Its socket is
 * also where Flatpak's --socket=pulseaudio puts it. Unknown (no XDG_RUNTIME_DIR): no warning.
 */
async function audio(ops: SystemCheckOps): Promise<SystemCheck> {
  const { PULSE_SERVER, XDG_RUNTIME_DIR } = ops.env
  if (PULSE_SERVER || !XDG_RUNTIME_DIR) return { id: 'audio', ok: true }
  return (await ops.exists(`${XDG_RUNTIME_DIR}/pulse/native`))
    ? { id: 'audio', ok: true }
    : { id: 'audio', ok: false, fix: FIX_AUDIO, blocking: true }
}

/**
 * GPU: a DRM render node (Mesa drivers, and virtual GPUs only with 3D enabled) or NVIDIA's proprietary
 * device. Only a missing /dev/dri counts as « none »: an unreadable one is no reason to warn.
 */
async function gpu(ops: SystemCheckOps): Promise<SystemCheck> {
  if (await ops.exists('/dev/nvidia0')) return { id: 'gpu', ok: true }
  let entries: string[]
  try {
    entries = await ops.readdir('/dev/dri')
  } catch (e) {
    return (e as NodeJS.ErrnoException)?.code === 'ENOENT' ? { id: 'gpu', ok: false, fix: FIX_GPU } : { id: 'gpu', ok: true }
  }
  return entries.some((n) => /^renderD\d+$/.test(n)) ? { id: 'gpu', ok: true } : { id: 'gpu', ok: false, fix: FIX_GPU }
}

/** In order of importance: what a show needs first, then the optional features. */
export async function linuxSystemChecks(
  o: { flatpak: boolean; canRememberLogin: boolean }, ops: SystemCheckOps = systemOps
): Promise<SystemCheck[]> {
  const keyring: SystemCheck = o.canRememberLogin ? { id: 'keyring', ok: true } : { id: 'keyring', ok: false, fix: FIX_KEYRING }
  const [snd, g, vcam, t] = await Promise.all([audio(ops), gpu(ops), virtualCamera(o.flatpak, ops), tray(ops)])
  return [display(ops.env), snd, g, keyring, vcam, t]
}
