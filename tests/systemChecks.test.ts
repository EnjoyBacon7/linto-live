import { describe, expect, it } from 'vitest'
import {
  FIX_KEYRING, FIX_TRAY, FIX_VCAM, FIX_VCAM_FLATPAK, linuxSystemChecks, v4l2loopbackInstalled, type SystemCheckOps
} from '../src/main/systemChecks'

const LOADED = 'v4l2loopback 49152 0 - Live 0x0000000000000000\nsnd 1 0 - Live 0x0\n'
const NOT_LOADED = 'snd 1 0 - Live 0x0\n'
const DEP_WITH = 'kernel/sound/snd.ko.zst:\nupdates/dkms/v4l2loopback.ko.zst: kernel/drivers/media/v4l2-core/videodev.ko.zst\n'
const DEP_WITHOUT = 'kernel/sound/snd.ko.zst:\n'

function ops(files: Record<string, string>, gdbus: string | Error = '(true,)\n'): SystemCheckOps & { runs: string[][] } {
  const runs: string[][] = []
  return {
    runs,
    kernelRelease: '6.8.0-45-generic',
    readFile: async (p) => {
      if (p in files) return files[p]
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    },
    run: async (cmd, args) => {
      runs.push([cmd, ...args])
      if (gdbus instanceof Error) throw gdbus
      return gdbus
    }
  }
}
const DEP = '/lib/modules/6.8.0-45-generic/modules.dep'
const byId = (cs: Awaited<ReturnType<typeof linuxSystemChecks>>) => Object.fromEntries(cs.map((c) => [c.id, c]))

describe('v4l2loopbackInstalled', () => {
  it('finds the module in modules.dep, compressed or not', () => {
    expect(v4l2loopbackInstalled(DEP_WITH)).toBe(true)
    expect(v4l2loopbackInstalled('extra/v4l2loopback.ko:\n')).toBe(true)
    expect(v4l2loopbackInstalled(DEP_WITHOUT)).toBe(false)
    expect(v4l2loopbackInstalled('extra/v4l2loopback-foo.ko:\n')).toBe(false)
  })
})

describe('linuxSystemChecks', () => {
  it('all ready: keyring, module installed, tray watcher present', async () => {
    const o = ops({ '/proc/modules': NOT_LOADED, [DEP]: DEP_WITH })
    const cs = await linuxSystemChecks({ flatpak: false, canRememberLogin: true }, o)
    expect(cs).toEqual([{ id: 'keyring', ok: true }, { id: 'virtual-camera', ok: true }, { id: 'tray', ok: true }])
    expect(o.runs[0]).toContain('org.kde.StatusNotifierWatcher')
  })

  it('reports each missing piece with its fix', async () => {
    const cs = byId(await linuxSystemChecks(
      { flatpak: false, canRememberLogin: false }, ops({ '/proc/modules': NOT_LOADED, [DEP]: DEP_WITHOUT }, '(false,)\n')
    ))
    expect(cs.keyring).toEqual({ id: 'keyring', ok: false, fix: FIX_KEYRING })
    expect(cs['virtual-camera']).toEqual({ id: 'virtual-camera', ok: false, fix: FIX_VCAM })
    expect(cs.tray).toEqual({ id: 'tray', ok: false, fix: FIX_TRAY })
  })

  it('a loaded module is ready even when modules.dep does not list it', async () => {
    const cs = byId(await linuxSystemChecks({ flatpak: false, canRememberLogin: true }, ops({ '/proc/modules': LOADED })))
    expect(cs['virtual-camera'].ok).toBe(true)
  })

  it('Flatpak: only a module loaded on the host counts', async () => {
    const missing = byId(await linuxSystemChecks(
      { flatpak: true, canRememberLogin: true }, ops({ '/proc/modules': NOT_LOADED, [DEP]: DEP_WITH })
    ))
    expect(missing['virtual-camera']).toEqual({ id: 'virtual-camera', ok: false, fix: FIX_VCAM_FLATPAK })
    const loaded = byId(await linuxSystemChecks({ flatpak: true, canRememberLogin: true }, ops({ '/proc/modules': LOADED })))
    expect(loaded['virtual-camera'].ok).toBe(true)
  })

  it('a check that cannot run is no reason to warn', async () => {
    const cs = await linuxSystemChecks({ flatpak: false, canRememberLogin: true }, ops({}, new Error('gdbus: not found')))
    expect(cs.every((c) => c.ok)).toBe(true)
    const pak = await linuxSystemChecks({ flatpak: true, canRememberLogin: true }, ops({}))
    expect(pak.every((c) => c.ok)).toBe(true)
  })
})
