import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
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
}

const READY_TIMEOUT_MS = 20_000
const STOP_TIMEOUT_MS = 10_000
const STABLE_MS = 30_000
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

async function wsProbe(c: ObsConnection): Promise<void> {
  const ws = new OBSWebSocket()
  await ws.connect(`ws://127.0.0.1:${c.port}`, c.password)
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

  constructor(private readonly o: ObsProcessOptions) {
    super()
    this.spawnFn = o.spawn ?? nodeSpawn
    this.maxRestarts = o.maxRestarts ?? 5
    this.probe = o.probe ?? wsProbe
  }

  async start(): Promise<ObsConnection> {
    this.stopping = false
    this.attempts = 0
    return this.launch()
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.stableTimer) clearTimeout(this.stableTimer)
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

  private async launch(): Promise<ObsConnection> {
    await writeSeed(this.o.paths.obsConfigDir, { canvas: { width: 1920, height: 1080, fps: 30 } })
    const conn: ObsConnection = {
      port: await freePort(),
      password: randomBytes(32).toString('hex')
    }
    const args = [
      '--multi', '--minimize-to-tray', '--disable-updater', '--disable-missing-files-check',
      '--collection', 'LinTO Live', '--profile', 'LinTO Live', '--scene', 'LinTO Live',
      '--websocket_port', String(conn.port), '--websocket_password', conn.password
    ]
    const env = obsEnv(this.o.paths, this.o.platform, process.env)
    delete env.ELECTRON_RUN_AS_NODE
    const child = this.spawnFn(this.o.exe, args, { env, stdio: 'ignore' })
    this.child = child

    let exitedEarly: number | null | undefined
    let onEarlyExit: (() => void) | undefined
    child.on('exit', (code: number | null) => {
      if (this.child === child) this.child = null
      if (this.stableTimer) clearTimeout(this.stableTimer)
      if (onEarlyExit) {
        exitedEarly = code
        onEarlyExit()
        return
      }
      this.handleExit(code)
    })
    child.on('error', () => {}) // spawn failure also surfaces as a failed readiness wait

    try {
      await this.waitReady(conn, () => exitedEarly !== undefined, (cb) => (onEarlyExit = cb))
    } catch (e) {
      if (this.child === child) {
        child.kill('SIGKILL')
        this.child = null
      }
      throw e
    } finally {
      onEarlyExit = undefined
    }
    this.stableTimer = setTimeout(() => (this.attempts = 0), STABLE_MS)
    this.stableTimer.unref?.()
    this.emit('ready', conn)
    return conn
  }

  private async waitReady(
    conn: ObsConnection,
    hasExited: () => boolean,
    setExitHook: (cb: () => void) => void
  ): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS
    setExitHook(() => {})
    for (;;) {
      if (hasExited()) throw new Error('OBS exited before its websocket was ready')
      try {
        await this.probe(conn)
        return
      } catch (e) {
        if (Date.now() > deadline) throw new Error(`OBS websocket not ready after 20 s: ${String(e)}`)
        await sleep(250)
      }
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
