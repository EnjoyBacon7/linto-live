import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { obsExecutable } from '../../src/main/obs/locate'
import { ObsProcess } from '../../src/main/obs/process'
import { appPaths } from '../../src/main/paths'

class FakeChild extends EventEmitter {
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

function setup(platform: NodeJS.Platform = 'darwin', maxRestarts?: number) {
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
    probe: async () => {}
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
    expect(arg(a, '--websocket_port')).toBe(String(conn.port))
    expect(arg(a, '--websocket_password')).toBe(conn.password)
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
    expect(arg(calls[1].args, '--websocket_password')).toBe(second.password)
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
})
