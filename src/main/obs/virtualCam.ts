import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'

/**
 * OBS's virtual camera, per platform. When OBS fails to start it, OBS opens a modal error box (in its own,
 * hidden, window) that blocks its UI thread: the checks below run first so that never happens.
 */

/** Bundle id of OBS's CoreMediaIO camera extension (activated by OBS itself when it starts). */
export const MAC_CAMERA_EXTENSION = 'com.obsproject.obs-studio.mac-camera-extension'
/** Same module options as OBS uses when it loads the module itself. */
const V4L2LOOPBACK_ARGS = ['modprobe', 'v4l2loopback', 'exclusive_caps=1', 'card_label=OBS Virtual Camera']
const HOST_MODPROBE = 'sudo modprobe v4l2loopback exclusive_caps=1 card_label="OBS Virtual Camera"'

export const MSG_VCAM_MAC_NOT_ALLOWED =
  'Caméra virtuelle pas encore autorisée : dans Réglages Système → Général → Ouverture et extensions → ' +
  'Extensions de caméra, activez OBS, puis réessayez. Si OBS n’y figure pas, relancez LinTO Live.'
export const MSG_VCAM_MODPROBE_FAILED = 'Impossible de charger le module v4l2loopback (autorisation refusée ?).'

/** Why OBS has no virtual camera at all (GetVirtualCamStatus « not available »): only Linux lacks it. */
export function virtualCamUnavailableReason(platform: NodeJS.Platform, flatpak: boolean): string {
  if (platform !== 'linux') return 'Caméra virtuelle non disponible sur ce système.'
  if (flatpak) {
    return 'Caméra virtuelle indisponible en Flatpak tant que le module v4l2loopback n’est pas chargé sur le système : ' +
      `installez-le, lancez « ${HOST_MODPROBE} » puis relancez LinTO Live.`
  }
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
 * macOS: the camera extension must be approved (a check that cannot run is no reason to refuse).
 * Linux: loads v4l2loopback as OBS would (pkexec), so a refusal is reported here instead of in OBS.
 */
export async function virtualCamPreflight(
  platform: NodeJS.Platform, flatpak: boolean, ops: PreflightOps = systemOps
): Promise<string | null> {
  if (platform === 'darwin') {
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
  if (flatpak) return virtualCamUnavailableReason('linux', true)
  try {
    await ops.run('pkexec', V4L2LOOPBACK_ARGS)
    // As OBS does after its own modprobe: the device node shows up shortly after.
    await new Promise((r) => setTimeout(r, ops.settleMs ?? 500))
    return null
  } catch {
    return MSG_VCAM_MODPROBE_FAILED
  }
}
