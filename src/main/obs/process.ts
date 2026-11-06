import { execFile, spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { OBSWebSocket } from 'obs-websocket-js'
import { obsEnv, type AppPaths } from '../paths'
import { writeSeed } from './seed'

export interface ObsConnection {
  port: number
  password: string
}

export interface ObsProcessOptions {
  exe: string
  paths: AppPaths
  platform: NodeJS.Platform
  spawn?: typeof nodeSpawn
  maxRestarts?: number
  /** Resolves once OBS accepts a websocket connection. Defaults to a real obs-websocket-js connect. */
  probe?: (c: ObsConnection) => Promise<void>
  readyTimeoutMs?: number
  /** Process inspection used to clean up an OBS orphaned by a crash of the app (fakes in tests). */
  orphan?: OrphanOps
}

export interface OrphanOps {
  isAlive(pid: number): boolean
  /** Full command line of `pid`, or null if unreadable. */
  command(pid: number): Promise<string | null>
  kill(pid: number): void
}

const systemOrphanOps: OrphanOps = {
  isAlive(pid) {
    try {
      process.kill(pid, 0)
      return true
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === 'EPERM'
    }
  },
  command: (pid) =>
    new Promise((resolve) => {
      execFile('ps', ['-ww', '-o', 'command=', '-p', String(pid)], (err, out) => resolve(err ? null : out.trim() || null))
    }),
  kill(pid) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* already gone */
    }
  }
}

const READY_TIMEOUT_MS = 20_000
const STOP_TIMEOUT_MS = 10_000
const PROBE_TIMEOUT_MS = 2_000
const STABLE_MS = 30_000
const ORPHAN_EXIT_WAIT_MS = 3_000
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port
      s.close(() => resolve(port))
    })
  })
}

export interface ProbeSocket {
  on(ev: 'Hello', cb: (h: { authentication?: unknown }) => void): unknown
  connect(url: string, password: string): Promise<unknown>
  call(req: 'GetVersion'): Promise<unknown>
  disconnect(): Promise<void>
}

/**
 * Connects with the fresh password; rejects if the server never demanded authentication (port squatter)
 * or if OBS is still loading (obs-websocket answers every request NotReady until the frontend finished
 * loading — the server listens earlier, e.g. while the browser source starts CEF).
 */
export async function probeWebSocket(
  c: ObsConnection,
  create: () => ProbeSocket = () => new OBSWebSocket() as unknown as ProbeSocket
): Promise<void> {
  const ws = create()
  let authRequired = false
  ws.on('Hello', (h) => {
    authRequired = h.authentication != null
  })
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error('websocket connect attempt timed out')), PROBE_TIMEOUT_MS)
  })
  try {
    const attempt = async (): Promise<void> => {
      await ws.connect(`ws://127.0.0.1:${c.port}`, c.password)
      if (!authRequired) throw new Error('websocket server does not require authentication')
      await ws.call('GetVersion')
    }
    await Promise.race([attempt(), timeout])
  } catch (e) {
    await ws.disconnect().catch(() => {})
    throw e
  } finally {
    clearTimeout(timer)
  }
  await ws.disconnect()
}

/**
 * Events: 'ready'(ObsConnection) after every (re)start, 'restarting'(attempt),
 * 'exit'(code) only when OBS is gone for good (stop() or restarts exhausted).
 */
export class ObsProcess extends EventEmitter {
  private child: ChildProcess | null = null
  private stopping = false
  private attempts = 0
  private stableTimer: NodeJS.Timeout | null = null
  private readonly spawnFn: typeof nodeSpawn
  private readonly maxRestarts: number
  private readonly probe: (c: ObsConnection) => Promise<void>
  private readonly orphan: OrphanOps
  private readonly pidFile: string
  /** On OBS's command line so a leftover process can be recognised as ours (env vars are not visible in ps). */
  private readonly homeMarker: string

  constructor(private readonly o: ObsProcessOptions) {
    super()
    this.spawnFn = o.spawn ?? nodeSpawn
    this.maxRestarts = o.maxRestarts ?? 5
    this.probe = o.probe ?? ((c) => probeWebSocket(c))
    this.orphan = o.orphan ?? systemOrphanOps
    this.pidFile = join(o.paths.obsHome, 'obs.pid')
    this.homeMarker = `--linto-live-home=${o.paths.obsHome}`
  }

  /**
   * An OBS left running by a crash of the app (pidfile still there) would hold the projector and the
   * isolated profile: SIGKILL it — but only if its command line carries our obs-home marker, so the
   * user's own OBS (or a recycled pid) is never touched.
   */
  private async killOrphan(): Promise<void> {
    let pid: number
    try {
      pid = Number.parseInt(readFileSync(this.pidFile, 'utf8').trim(), 10)
    } catch {
      return
    }
    if (Number.isInteger(pid) && pid > 1 && pid !== process.pid && this.orphan.isAlive(pid)) {
      const cmd = await this.orphan.command(pid)
      if (cmd?.includes(this.homeMarker)) {
        this.orphan.kill(pid)
        const deadline = Date.now() + ORPHAN_EXIT_WAIT_MS
        while (this.orphan.isAlive(pid) && Date.now() < deadline) await sleep(100)
      }
    }
    rmSync(this.pidFile, { force: true })
  }

  private launching: Promise<ObsConnection> | null = null

  async start(): Promise<ObsConnection> {
    if (this.child || this.launching) throw new Error('OBS is already running')
    this.stopping = false
    this.attempts = 0
    return this.launch()
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.stableTimer) clearTimeout(this.stableTimer)
    await this.killChild()
    if (this.launching) await this.launching.catch(() => {})
    await this.killChild()
  }

  /** Last-resort synchronous kill (app exiting after the shutdown cap): SIGKILL, no restart. */
  killNow(): void {
    this.stopping = true
    if (this.stableTimer) clearTimeout(this.stableTimer)
    this.child?.kill('SIGKILL')
  }

  private async killChild(): Promise<void> {
    const child = this.child
    if (!child) return
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.kill('SIGTERM')
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<'timeout'>((r) => (timer = setTimeout(() => r('timeout'), STOP_TIMEOUT_MS)))
    const res = await Promise.race([exited, timeout])
    clearTimeout(timer)
    if (res === 'timeout') {
      child.kill('SIGKILL')
      await exited
    }
  }

  private launch(): Promise<ObsConnection> {
    const p = this.doLaunch()
    this.launching = p
    const clear = (): void => {
      if (this.launching === p) this.launching = null
    }
    p.then(clear, clear)
    return p
  }

  private async doLaunch(): Promise<ObsConnection> {
    await this.killOrphan()
    await writeSeed(this.o.paths.obsConfigDir, { canvas: { width: 1920, height: 1080, fps: 30 } })
    const conn: ObsConnection = {
      port: await freePort(),
      password: randomBytes(32).toString('hex')
    }
    if (this.stopping) throw new Error('OBS start cancelled by stop()')
    const args = [
      '--multi', '--minimize-to-tray', '--disable-updater', '--disable-missing-files-check',
      '--collection', 'LinTO Live', '--profile', 'LinTO Live', '--scene', 'LinTO Live', this.homeMarker
    ]
    // Port/password go through obs-websocket's config file, not argv (argv is visible in `ps`).
    const wsCfg = join(this.o.paths.obsConfigDir, 'plugin_config', 'obs-websocket', 'config.json')
    await mkdir(dirname(wsCfg), { recursive: true })
    await writeFile(
      wsCfg,
      JSON.stringify(
        {
          first_load: false,
          server_enabled: true,
          server_port: conn.port,
          auth_required: true,
          server_password: conn.password,
          alerts_enabled: false
        },
        null,
        2
      ),
      { mode: 0o600 }
    )
    await chmod(wsCfg, 0o600)
    if (this.stopping) throw new Error('OBS start cancelled by stop()')
    const env = obsEnv(this.o.paths, this.o.platform, process.env)
    delete env.ELECTRON_RUN_AS_NODE
    const child = this.spawnFn(this.o.exe, args, { env, stdio: 'ignore' })
    this.child = child
    const pid = child.pid
    if (pid) {
      try {
        mkdirSync(dirname(this.pidFile), { recursive: true })
        writeFileSync(this.pidFile, String(pid))
      } catch {
        /* best effort: only used for orphan cleanup */
      }
    }

    // Per-launch state: `abandoned` means this launch failed and its exit must not trigger a restart;
    // `ready` false + exited means the failure is reported through the launch promise instead.
    let abandoned = false
    let ready = false
    let exited = false
    child.on('exit', (code: number | null) => {
      exited = true
      if (pid) this.removePidFile(pid)
      if (this.child === child) this.child = null
      if (this.stableTimer) clearTimeout(this.stableTimer)
      if (abandoned || !ready) return
      this.handleExit(code)
    })
    child.on('error', () => {}) // spawn failure surfaces as exit / failed readiness wait

    try {
      const deadline = Date.now() + (this.o.readyTimeoutMs ?? READY_TIMEOUT_MS)
      for (;;) {
        if (exited) throw new Error('OBS exited before its websocket was ready')
        try {
          await this.probe(conn)
          break
        } catch (e) {
          if (Date.now() > deadline) throw new Error(`OBS websocket not ready after timeout: ${String(e)}`)
          await sleep(250)
        }
      }
      if (exited) throw new Error('OBS exited before its websocket was ready')
      if (this.stopping) throw new Error('OBS start cancelled by stop()')
    } catch (e) {
      abandoned = true
      if (!exited) child.kill('SIGKILL')
      if (this.child === child) this.child = null
      throw e
    }
    ready = true
    this.stableTimer = setTimeout(() => (this.attempts = 0), STABLE_MS)
    this.stableTimer.unref?.()
    this.emit('ready', conn)
    return conn
  }

  private removePidFile(pid: number): void {
    try {
      if (readFileSync(this.pidFile, 'utf8').trim() === String(pid)) rmSync(this.pidFile, { force: true })
    } catch {
      /* already gone */
    }
  }

  private handleExit(code: number | null): void {
    if (this.stopping || this.attempts >= this.maxRestarts) {
      this.emit('exit', code)
      return
    }
    this.attempts += 1
    this.emit('restarting', this.attempts)
    this.launch().catch(() => this.handleExit(null))
  }
}
