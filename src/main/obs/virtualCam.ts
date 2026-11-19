import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { inApplicationsFolder } from './runtime'

/**
 * OBS's virtual camera, per platform. When OBS fails to start it, OBS opens a modal error box (in its own,
 * hidden, window) that blocks its UI thread: the checks below run first so that never happens.
 */

/** Bundle id of OBS's CoreMediaIO camera extension (activated by OBS itself when it starts). */
export const MAC_CAMERA_EXTENSION = 'com.obsproject.obs-studio.mac-camera-extension'
/** Same module options as OBS uses when it loads the module itself. */
const V4L2LOOPBACK_ARGS = ['modprobe', 'v4l2loopback', 'exclusive_caps=1', 'card_label=OBS Virtual Camera']

export const MSG_VCAM_MAC_NOT_ALLOWED =
  'Caméra virtuelle pas encore autorisée : dans Réglages Système → Général → Ouverture et extensions → ' +
  'Extensions de caméra, activez OBS, puis réessayez. Si OBS n’y figure pas, relancez LinTO Live.'
export const MSG_VCAM_MAC_LOCATION =
  'Caméra virtuelle indisponible : macOS ne l’autorise que pour une application placée dans le dossier ' +
  'Applications, et LinTO Live n’a pas pu y copier OBS (droits d’administrateur nécessaires). Relancez ' +
  'LinTO Live depuis un compte administrateur.'
export const MSG_VCAM_MODPROBE_FAILED = 'Impossible de charger le module v4l2loopback (autorisation refusée ?).'

/**
 * Why OBS has no virtual camera at all (GetVirtualCamStatus « not available »): only Linux lacks it, when
 * v4l2loopback is neither loaded nor installed (OBS asks the host through flatpak-spawn in the Flatpak).
 */
export function virtualCamUnavailableReason(platform: NodeJS.Platform): string {
  if (platform !== 'linux') return 'Caméra virtuelle non disponible sur ce système.'
  return 'Caméra virtuelle indisponible : installez le module v4l2loopback (paquet v4l2loopback-dkms) puis relancez LinTO Live.'
}

/** True when `systemextensionsctl list` shows OBS's camera extension activated and enabled. */
export function macExtensionActive(list: string): boolean {
  return list.split('\n').some((l) => l.includes(MAC_CAMERA_EXTENSION) && l.includes('[activated enabled]'))
}

/** True when /proc/modules lists v4l2loopback. */
export function v4l2loopbackLoaded(modules: string): boolean {
  return modules.split('\n').some((l) => l.startsWith('v4l2loopback '))
}

export interface PreflightOps {
  run(cmd: string, args: string[]): Promise<string>
  readFile(path: string): Promise<string>
  /** Wait after loading the module (ms). */
  settleMs?: number
}

const systemOps: PreflightOps = {
  run: (cmd, args) =>
    new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: 120_000 }, (err, out) => (err ? reject(err) : resolve(out)))
    }),
  readFile: (path) => readFile(path, 'utf8')
}

/**
 * Before StartVirtualCam: null when OBS can start it, else why not (shown to the user).
 * macOS: OBS must run from /Applications (else macOS refuses to activate its camera extension and OBS fails
 * with « OBS cannot activate the virtual camera unless it is placed in the Applications folder »), and the
 * camera extension must be approved (a check that cannot run is no reason to refuse).
 * Linux: loads v4l2loopback as OBS would (pkexec; on the host through flatpak-spawn in the Flatpak, which
 * may talk to org.freedesktop.Flatpak for that), so a refusal is reported here instead of in OBS.
 */
export async function virtualCamPreflight(
  platform: NodeJS.Platform, flatpak: boolean, ops: PreflightOps = systemOps, obsExe?: string
): Promise<string | null> {
  if (platform === 'darwin') {
    if (obsExe !== undefined && !inApplicationsFolder(obsExe)) return MSG_VCAM_MAC_LOCATION
    let list: string
    try {
      list = await ops.run('systemextensionsctl', ['list'])
    } catch {
      return null
    }
    return macExtensionActive(list) ? null : MSG_VCAM_MAC_NOT_ALLOWED
  }
  if (platform !== 'linux') return null
  const loaded = await ops.readFile('/proc/modules').then(v4l2loopbackLoaded, () => true)
  if (loaded) return null
  try {
    if (flatpak) await ops.run('flatpak-spawn', ['--host', 'pkexec', ...V4L2LOOPBACK_ARGS])
    else await ops.run('pkexec', V4L2LOOPBACK_ARGS)
    // As OBS does after its own modprobe: the device node shows up shortly after.
    await new Promise((r) => setTimeout(r, ops.settleMs ?? 500))
    return null
  } catch {
    return MSG_VCAM_MODPROBE_FAILED
  }
}
