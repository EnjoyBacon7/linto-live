import { describe, expect, it } from 'vitest'
import {
  FIX_AUDIO, FIX_GPU, FIX_KEYRING, FIX_NO_X11, FIX_TRAY, FIX_VCAM, FIX_WAYLAND, linuxSystemChecks,
  statusNotifierWatcher, v4l2loopbackInstalled, type SystemCheckOps
} from '../src/main/systemChecks'

const LOADED = 'v4l2loopback 49152 0 - Live 0x0000000000000000\nsnd 1 0 - Live 0x0\n'
const NOT_LOADED = 'snd 1 0 - Live 0x0\n'
const DEP_WITH = 'kernel/sound/snd.ko.zst:\nupdates/dkms/v4l2loopback.ko.zst: kernel/drivers/media/v4l2-core/videodev.ko.zst\n'
const DEP_WITHOUT = 'kernel/sound/snd.ko.zst:\n'

const RUNTIME = '/run/user/1000'
/** An X11 session with a PulseAudio socket and a Mesa render node: the display, sound and GPU checks pass. */
const X11_ENV: NodeJS.ProcessEnv = { DISPLAY: ':0', XDG_SESSION_TYPE: 'x11', XDG_RUNTIME_DIR: RUNTIME }
const enoent = (): Error => Object.assign(new Error('ENOENT'), { code: 'ENOENT' })

function ops(
  files: Record<string, string>, gdbus: string | Error = '(true,)\n',
  sys: { env?: NodeJS.ProcessEnv; paths?: string[]; dri?: string[] | Error } = {}
): SystemCheckOps & { runs: string[][] } {
  const runs: string[][] = []
  const paths = sys.paths ?? [`${RUNTIME}/pulse/native`]
  const dri = sys.dri ?? ['card0', 'renderD128']
  return {
    runs,
    kernelRelease: '6.8.0-45-generic',
    env: sys.env ?? X11_ENV,
    exists: async (p) => paths.includes(p),
    readdir: async (p) => {
      if (p !== '/dev/dri') throw enoent()
      if (dri instanceof Error) throw dri
      return dri
    },
    readFile: async (p) => {
      if (p in files) return files[p]
      throw enoent()
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
    expect(cs).toEqual([
      { id: 'display', ok: true }, { id: 'audio', ok: true }, { id: 'gpu', ok: true },
      { id: 'keyring', ok: true }, { id: 'virtual-camera', ok: true }, { id: 'tray', ok: true }
    ])
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

  it('Flatpak: loaded on the host, or installed there (the host’s modinfo, through flatpak-spawn)', async () => {
    const exitCode = (n: number): Error => Object.assign(new Error(`exit ${n}`), { code: n })
    // gdbus succeeds (tray), modinfo answers what `modinfo` gives.
    const flatpakOps = (modinfo: string | Error) => {
      const o = ops({ '/proc/modules': NOT_LOADED })
      const run = o.run
      o.run = async (cmd, args) => {
        if (cmd !== 'flatpak-spawn') return run(cmd, args)
        o.runs.push([cmd, ...args])
        if (modinfo instanceof Error) throw modinfo
        return modinfo
      }
      return o
    }
    const installed = flatpakOps('/lib/modules/6.8.0-45-generic/updates/dkms/v4l2loopback.ko.zst\n')
    expect(byId(await linuxSystemChecks({ flatpak: true, canRememberLogin: true }, installed))['virtual-camera'].ok).toBe(true)
    expect(installed.runs).toContainEqual(['flatpak-spawn', '--host', 'modinfo', '-F', 'filename', 'v4l2loopback'])
    const missing = byId(await linuxSystemChecks({ flatpak: true, canRememberLogin: true }, flatpakOps(exitCode(1))))
    expect(missing['virtual-camera']).toEqual({ id: 'virtual-camera', ok: false, fix: FIX_VCAM })
    const unknown = byId(await linuxSystemChecks({ flatpak: true, canRememberLogin: true }, flatpakOps(new Error('ENOENT'))))
    expect(unknown['virtual-camera'].ok).toBe(true)
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

describe('display, sound and GPU checks', () => {
  const check = async (sys: Parameters<typeof ops>[2]) =>
    byId(await linuxSystemChecks({ flatpak: false, canRememberLogin: true }, ops({ '/proc/modules': LOADED }, '(true,)\n', sys)))

  it('no X server: OBS cannot start, a show is impossible', async () => {
    expect((await check({ env: { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0', XDG_RUNTIME_DIR: RUNTIME } })).display)
      .toEqual({ id: 'display', ok: false, fix: FIX_NO_X11, blocking: true })
  })

  it('Wayland with XWayland: works, the output window placement is not guaranteed', async () => {
    const wayland = { DISPLAY: ':0', XDG_SESSION_TYPE: 'wayland', XDG_RUNTIME_DIR: RUNTIME }
    expect((await check({ env: wayland })).display).toEqual({ id: 'display', ok: false, fix: FIX_WAYLAND })
    // Flatpak may not pass XDG_SESSION_TYPE: its Wayland socket tells.
    expect((await check({ env: { DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0', XDG_RUNTIME_DIR: RUNTIME } })).display.ok).toBe(false)
  })

  it('no PulseAudio socket: no micro, a show is impossible; PULSE_SERVER or an unknown runtime dir is fine', async () => {
    expect((await check({ paths: [] })).audio).toEqual({ id: 'audio', ok: false, fix: FIX_AUDIO, blocking: true })
    expect((await check({ paths: [], env: { ...X11_ENV, PULSE_SERVER: 'tcp:host' } })).audio.ok).toBe(true)
    expect((await check({ paths: [], env: { DISPLAY: ':0' } })).audio.ok).toBe(true)
  })

  it('GPU: a render node or an NVIDIA device; none (or no /dev/dri) warns, an unreadable /dev/dri does not', async () => {
    expect((await check({ dri: ['card0'] })).gpu).toEqual({ id: 'gpu', ok: false, fix: FIX_GPU })
    expect((await check({ dri: enoent() })).gpu.ok).toBe(false)
    expect((await check({ dri: Object.assign(new Error('EACCES'), { code: 'EACCES' }) })).gpu.ok).toBe(true)
    expect((await check({ dri: ['card0'], paths: [`${RUNTIME}/pulse/native`, '/dev/nvidia0'] })).gpu.ok).toBe(true)
  })
})

describe('statusNotifierWatcher', () => {
  it('true / false from gdbus, null when it cannot tell', async () => {
    expect(await statusNotifierWatcher(ops({}, '(true,)\n'))).toBe(true)
    expect(await statusNotifierWatcher(ops({}, '(false,)\n'))).toBe(false)
    expect(await statusNotifierWatcher(ops({}, new Error('no gdbus')))).toBeNull()
    expect(await statusNotifierWatcher(ops({}, 'garbage'))).toBeNull()
  })
})
