import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { obsExecutable } from '../../src/main/obs/locate'
import { ObsProcess, probeWebSocket, type ObsProcessOptions } from '../../src/main/obs/process'
import { appPaths } from '../../src/main/paths'

let nextPid = 5000
class FakeChild extends EventEmitter {
  pid = nextPid++
  killed: string[] = []
  kill(sig: string): boolean {
    this.killed.push(sig)
    queueMicrotask(() => this.emit('exit', 0, sig))
    return true
  }
}

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'linto-proc-'))
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

function setup(
  platform: NodeJS.Platform = 'darwin', maxRestarts?: number, probe: () => Promise<void> = async () => {}, readyTimeoutMs?: number,
  extra: Partial<ObsProcessOptions> = {}
) {
  const children: FakeChild[] = []
  const calls: { exe: string; args: string[]; opts: { env: NodeJS.ProcessEnv } }[] = []
  const spawn = ((exe: string, args: string[], opts: { env: NodeJS.ProcessEnv }) => {
    const c = new FakeChild()
    children.push(c)
    calls.push({ exe, args, opts })
    return c
  }) as never
  const p = new ObsProcess({
    exe: '/x/OBS',
    paths: appPaths(tmp, platform),
    platform,
    spawn,
    maxRestarts,
    probe,
    readyTimeoutMs,
    ...extra
  })
  return { p, children, calls }
}
const arg = (args: string[], flag: string): string => args[args.indexOf(flag) + 1]

describe('obsExecutable', () => {
  const base = { resourcesPath: '/R', env: {} }
  it('resolves per platform', () => {
    expect(obsExecutable({ ...base, packaged: false, platform: 'darwin' })).toBe('/Applications/OBS.app/Contents/MacOS/OBS')
    expect(obsExecutable({ ...base, packaged: true, platform: 'darwin' })).toBe('/R/obs/OBS.app/Contents/MacOS/OBS')
    expect(obsExecutable({ ...base, packaged: false, platform: 'linux' })).toBe('obs')
    expect(obsExecutable({ ...base, packaged: true, platform: 'linux' })).toBe('/R/obs/bin/obs')
    expect(obsExecutable({ resourcesPath: '/R', packaged: false, platform: 'linux', env: { LINTO_LIVE_OBS: '/o' } })).toBe('/o')
  })
})

describe('ObsProcess', () => {
  it('spawns with every required flag, port and a random 64-hex password', async () => {
    const { p, calls } = setup()
    const conn = await p.start()
    const a = calls[0].args
    for (const f of ['--multi', '--minimize-to-tray', '--disable-updater', '--disable-missing-files-check']) {
      expect(a).toContain(f)
    }
    expect(arg(a, '--collection')).toBe('LinTO Live')
    expect(arg(a, '--profile')).toBe('LinTO Live')
    expect(arg(a, '--scene')).toBe('LinTO Live')
    expect(a.some((x) => x.startsWith('--websocket'))).toBe(false)
    expect(a).not.toContain(conn.password)
    expect(a).not.toContain(String(conn.port))
    const cfg = join(tmp, 'obs-home/Library/Application Support/obs-studio/plugin_config/obs-websocket/config.json')
    const j = JSON.parse(readFileSync(cfg, 'utf8'))
    expect(j).toMatchObject({ server_enabled: true, auth_required: true, server_port: conn.port, server_password: conn.password })
    expect(statSync(cfg).mode & 0o777).toBe(0o600)
    expect(conn.password).toMatch(/^[0-9a-f]{64}$/)
    expect(conn.port).toBeGreaterThan(0)
    await p.stop()
  })

  it('sets CFFIXED_USER_HOME on darwin and strips ELECTRON_RUN_AS_NODE', async () => {
    process.env.ELECTRON_RUN_AS_NODE = '1'
    try {
      const { p, calls } = setup('darwin')
      await p.start()
      expect(calls[0].opts.env.CFFIXED_USER_HOME).toBe(join(tmp, 'obs-home'))
      expect('ELECTRON_RUN_AS_NODE' in calls[0].opts.env).toBe(false)
      await p.stop()
    } finally {
      delete process.env.ELECTRON_RUN_AS_NODE
    }
  })

  it('restarts after unexpected exit with a new password', async () => {
    const { p, children, calls } = setup()
    const first = await p.start()
    const restarting = vi.fn()
    p.on('restarting', restarting)
    const ready = new Promise<{ password: string }>((r) => p.once('ready', r))
    children[0].emit('exit', 1, null)
    const second = await ready
    expect(restarting).toHaveBeenCalledWith(1)
    expect(calls).toHaveLength(2)
    expect(second.password).not.toBe(first.password)
    expect(
      JSON.parse(readFileSync(join(tmp, 'obs-home/Library/Application Support/obs-studio/plugin_config/obs-websocket/config.json'), 'utf8')).server_password
    ).toBe(second.password)
    await p.stop()
  })

  it('stops restarting after maxRestarts and emits exit', async () => {
    const { p, children, calls } = setup('darwin', 2)
    await p.start()
    const exit = new Promise<number | null>((r) => p.once('exit', r))
    for (let i = 0; i < 3; i++) {
      const ready = i < 2 ? new Promise((r) => p.once('ready', r)) : Promise.resolve()
      children[i].emit('exit', 1, null)
      await ready
    }
    expect(await exit).toBe(1)
    expect(calls).toHaveLength(3)
  })

  it('killNow() sends SIGKILL synchronously and does not restart', async () => {
    const { p, children } = setup()
    await p.start()
    const restarting = vi.fn()
    const exit = vi.fn()
    p.on('restarting', restarting)
    p.on('exit', exit)
    p.killNow()
    expect(children[0].killed).toEqual(['SIGKILL'])
    await new Promise((r) => setTimeout(r, 0))
    expect(restarting).not.toHaveBeenCalled()
    expect(children).toHaveLength(1)
  })

  it('stop() sends SIGTERM and does not restart', async () => {
    const { p, children, calls } = setup()
    await p.start()
    const done = p.stop()
    expect(children[0].killed).toEqual(['SIGTERM'])
    await done
    await new Promise((r) => setTimeout(r, 50))
    expect(calls).toHaveLength(1)
  })

  it('uses a different password per start', async () => {
    const { p, children } = setup()
    const a = await p.start()
    let done = p.stop()
    await done
    const b = await p.start()
    expect(b.password).not.toBe(a.password)
    expect(b.password).toMatch(/^[0-9a-f]{64}$/)
    done = p.stop()
    await done
  })

  it('start() twice without stop() throws', async () => {
    const { p } = setup()
    await p.start()
    await expect(p.start()).rejects.toThrow(/already running/)
    await p.stop()
  })

  it('readiness timeout rejects start and does not restart', async () => {
    const { p, calls, children } = setup('darwin', 5, async () => {
      throw new Error('nope')
    }, 300)
    const restarting = vi.fn()
    p.on('restarting', restarting)
    await expect(p.start()).rejects.toThrow(/not ready/)
    expect(children[0].killed).toEqual(['SIGKILL'])
    await new Promise((r) => setTimeout(r, 100))
    expect(calls).toHaveLength(1)
    expect(restarting).not.toHaveBeenCalled()
  })

  it('probe rejects a server that does not require auth', async () => {
    const mk = (auth: unknown, call: () => Promise<unknown> = async () => ({})) => {
      let hello: (h: { authentication?: unknown }) => void = () => {}
      let disconnected = 0
      return {
        ws: {
          on: (_e: 'Hello', cb: typeof hello) => { hello = cb },
          connect: async () => { hello({ authentication: auth }) },
          call,
          disconnect: async () => { disconnected++ }
        },
        disconnected: () => disconnected
      }
    }
    const open = mk(undefined)
    await expect(probeWebSocket({ port: 1, password: 'x' }, () => open.ws)).rejects.toThrow(/authentication/)
    expect(open.disconnected()).toBe(1)
    const secured = mk({ challenge: 'c', salt: 's' })
    await expect(probeWebSocket({ port: 1, password: 'x' }, () => secured.ws)).resolves.toBeUndefined()
  })

  it('probe rejects while OBS is still loading (requests answer NotReady)', async () => {
    let disconnected = 0
    let hello: (h: { authentication?: unknown }) => void = () => {}
    const loading = {
      on: (_e: 'Hello', cb: typeof hello) => { hello = cb },
      connect: async () => { hello({ authentication: { challenge: 'c', salt: 's' } }) },
      call: async () => { throw new Error('OBS is not ready to perform the request.') },
      disconnect: async () => { disconnected++ }
    }
    await expect(probeWebSocket({ port: 1, password: 'x' }, () => loading)).rejects.toThrow(/not ready/)
    expect(disconnected).toBe(1)
  })

  it('a failed relaunch counts one attempt and keeps a single restart chain', async () => {
    let n = 0
    const { p, children, calls } = setup('darwin', 2, async () => {
      if (++n > 1) throw new Error('fail') // first start ok; relaunches die before ready
    })
    await p.start()
    const restarting: number[] = []
    p.on('restarting', (a: number) => restarting.push(a))
    const exit = new Promise<void>((r) => p.once('exit', () => r()))
    children[0].emit('exit', 1, null) // crash
    // relaunch child exits before ready
    for (let i = 1; i <= 2; i++) {
      while (children.length <= i) await new Promise((r) => setTimeout(r, 5))
      children[i].emit('exit', 1, null)
    }
    await exit
    await new Promise((r) => setTimeout(r, 100))
    expect(restarting).toEqual([1, 2])
    expect(calls).toHaveLength(3)
  })

  it('stop() during the restart gap spawns nothing and emits no ready', async () => {
    const { p, children, calls } = setup()
    await p.start()
    const ready = vi.fn()
    p.on('ready', ready)
    children[0].emit('exit', 1, null) // crash; relaunch is awaiting seed/port
    await p.stop()
    await new Promise((r) => setTimeout(r, 100))
    expect(calls).toHaveLength(1)
    expect(ready).not.toHaveBeenCalled()
  })
})

describe('ObsProcess orphan cleanup (pidfile)', () => {
  const obsHome = (): string => join(tmp, 'obs-home')
  const pidFile = (): string => join(obsHome(), 'obs.pid')
  const writePid = (pid: number): void => {
    mkdirSync(obsHome(), { recursive: true })
    writeFileSync(pidFile(), String(pid))
  }
  function orphanFakes(cmd: string | null, alive = true) {
    const order: string[] = []
    const living = new Set<number>(alive ? [4242] : [])
    const orphan = {
      isAlive: vi.fn((pid: number) => living.has(pid)),
      command: vi.fn(async () => cmd),
      kill: vi.fn((pid: number) => {
        order.push(`kill:${pid}`)
        living.delete(pid)
      })
    }
    return { orphan, order }
  }

  it('passes the isolated obs-home path on the command line (identifies our OBS in ps)', async () => {
    const { p, calls } = setup()
    await p.start()
    expect(calls[0].args).toContain(`--linto-live-home=${obsHome()}`)
    await p.stop()
  })

  it('writes the pidfile after spawn and removes it when OBS exits', async () => {
    const { p, children } = setup()
    await p.start()
    expect(readFileSync(pidFile(), 'utf8')).toBe(String(children[0].pid))
    await p.stop()
    expect(existsSync(pidFile())).toBe(false)
  })

  it("SIGKILLs this app's orphan OBS left by a crash before launching", async () => {
    writePid(4242)
    const { orphan, order } = orphanFakes(`/x/OBS --multi --linto-live-home=${obsHome()}`)
    const spawnOrder: string[] = order
    const { p, children, calls } = setup('darwin', undefined, undefined, undefined, { orphan })
    const orig = calls.push.bind(calls)
    calls.push = (...a) => {
      spawnOrder.push('spawn')
      return orig(...a)
    }
    await p.start()
    expect(orphan.command).toHaveBeenCalledWith(4242)
    expect(order).toEqual(['kill:4242', 'spawn'])
    expect(readFileSync(pidFile(), 'utf8')).toBe(String(children[0].pid))
    await p.stop()
  })

  it("never kills a process whose command line lacks this app's obs-home (the user's own OBS)", async () => {
    writePid(4242)
    const { orphan } = orphanFakes('/Applications/OBS.app/Contents/MacOS/OBS --multi')
    const { p, children } = setup('darwin', undefined, undefined, undefined, { orphan })
    await p.start()
    expect(orphan.kill).not.toHaveBeenCalled()
    expect(readFileSync(pidFile(), 'utf8')).toBe(String(children[0].pid))
    await p.stop()
  })

  it('ignores a stale pidfile whose process is gone', async () => {
    writePid(4242)
    const { orphan } = orphanFakes(`/x/OBS --linto-live-home=${obsHome()}`, false)
    const { p } = setup('darwin', undefined, undefined, undefined, { orphan })
    await p.start()
    expect(orphan.command).not.toHaveBeenCalled()
    expect(orphan.kill).not.toHaveBeenCalled()
    await p.stop()
  })

  it('ignores a garbage pidfile and an unreadable command line', async () => {
    mkdirSync(obsHome(), { recursive: true })
    writeFileSync(pidFile(), 'not-a-pid')
    const a = orphanFakes(null)
    const { p } = setup('darwin', undefined, undefined, undefined, { orphan: a.orphan })
    await p.start()
    expect(a.orphan.kill).not.toHaveBeenCalled()
    await p.stop()
    writePid(4242)
    const { p: p2 } = setup('darwin', undefined, undefined, undefined, { orphan: a.orphan })
    await p2.start()
    expect(a.orphan.kill).not.toHaveBeenCalled()
    await p2.stop()
  })
})
