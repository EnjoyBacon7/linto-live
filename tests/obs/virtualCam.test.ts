import { describe, expect, it, vi } from 'vitest'
import {
  MAC_CAMERA_EXTENSION, MSG_VCAM_MAC_LOCATION, MSG_VCAM_MAC_NOT_ALLOWED, MSG_VCAM_MODPROBE_FAILED, macExtensionActive, v4l2loopbackLoaded,
  virtualCamPreflight, virtualCamUnavailableReason, type PreflightOps
} from '../../src/main/obs/virtualCam'

const LIST_ACTIVE = `1 extension(s)
--- com.apple.system_extension.cmio
enabled\tactive\tteamID\tbundleID (version)\tname\t[state]
*\t*\t2MMRE5MTB8\t${MAC_CAMERA_EXTENSION} (32.1.0/32.1.0)\tOBS Virtual Camera\t[activated enabled]
`
const LIST_WAITING = LIST_ACTIVE.replace('*\t*', '\t').replace('[activated enabled]', '[activated waiting for user]')

function ops(over: Partial<PreflightOps> = {}) {
  return { run: vi.fn(async (_c: string, _a: string[]) => ''), readFile: vi.fn(async (_p: string) => ''), settleMs: 0, ...over }
}

describe('virtual camera checks', () => {
  it('parses systemextensionsctl and /proc/modules', () => {
    expect(macExtensionActive(LIST_ACTIVE)).toBe(true)
    expect(macExtensionActive(LIST_WAITING)).toBe(false)
    expect(macExtensionActive('0 extension(s)')).toBe(false)
    expect(v4l2loopbackLoaded('snd 1 0 - Live 0x0\nv4l2loopback 49152 0 - Live 0x0\n')).toBe(true)
    expect(v4l2loopbackLoaded('v4l2loopback_x 1 0 - Live 0x0\n')).toBe(false)
  })

  it('macOS: go once the camera extension is approved; a check that cannot run does not block', async () => {
    expect(await virtualCamPreflight('darwin', false, ops({ run: vi.fn(async () => LIST_ACTIVE) }))).toBeNull()
    expect(await virtualCamPreflight('darwin', false, ops({ run: vi.fn(async () => LIST_WAITING) }))).toBe(MSG_VCAM_MAC_NOT_ALLOWED)
    expect(await virtualCamPreflight('darwin', false, ops({ run: vi.fn(async () => { throw new Error('x') }) }))).toBeNull()
  })

  it('macOS: refuses when OBS does not run from /Applications (macOS would refuse its camera extension)', async () => {
    const active = ops({ run: vi.fn(async () => LIST_ACTIVE) })
    const outside = '/Users/u/Library/Application Support/LinTO Live/obs-runtime/OBS.app/Contents/MacOS/OBS'
    expect(await virtualCamPreflight('darwin', false, active, outside)).toBe(MSG_VCAM_MAC_LOCATION)
    expect(active.run).not.toHaveBeenCalled()
    expect(await virtualCamPreflight('darwin', false, active, '/Applications/.LinTO Live/OBS.app/Contents/MacOS/OBS')).toBeNull()
  })

  it('Linux: nothing to do when v4l2loopback is loaded', async () => {
    const o = ops({ readFile: vi.fn(async () => 'v4l2loopback 1 0 - Live 0x0\n') })
    expect(await virtualCamPreflight('linux', false, o)).toBeNull()
    expect(o.run).not.toHaveBeenCalled()
  })

  it('Linux: loads v4l2loopback through pkexec as OBS would, and reports a refusal', async () => {
    const o = ops()
    expect(await virtualCamPreflight('linux', false, o)).toBeNull()
    expect(o.run).toHaveBeenCalledWith('pkexec', ['modprobe', 'v4l2loopback', 'exclusive_caps=1', 'card_label=OBS Virtual Camera'])
    const refused = ops({ run: vi.fn(async () => { throw new Error('126') }) })
    expect(await virtualCamPreflight('linux', false, refused)).toBe(MSG_VCAM_MODPROBE_FAILED)
  })

  it('Flatpak: cannot load the module from the sandbox, tells how to on the host', async () => {
    const o = ops()
    const why = await virtualCamPreflight('linux', true, o)
    expect(why).toBe(virtualCamUnavailableReason('linux', true))
    expect(why).toContain('sudo modprobe v4l2loopback')
    expect(o.run).not.toHaveBeenCalled()
  })
})
