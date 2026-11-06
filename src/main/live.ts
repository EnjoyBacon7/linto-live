import { EventEmitter } from 'node:events'
import type { LiveState, StartResult } from '../shared/ipc'
import { UnauthorizedError, type Channel, type DeviceItem, type MonitorInfo, type SavedDisplay, type Session, type Settings } from '../shared/types'
import type { ObsConnection, ObsProcess } from './obs/process'
import type { ObsController, StreamState } from './obs/controller'
import { toObsStreamService, type ObsStreamService } from './obs/streamTarget'
import { matchDisplay } from './obs/monitors'
import type { LintoApi } from './linto/api'
import { CaptionBuffer, type CaptionEvent, type CaptionStatus, type CaptionStream } from './linto/captions'
import { resolveSession } from './linto/sessionResolver'
import type { OverlayServer } from './overlay/server'
import type { SettingsStore } from './settings'

export const MSG_NO_STREAM = "Impossible d'envoyer l'audio : tu n'es pas propriétaire de cette session."
export const MSG_STREAM_RETRY = 'Envoi audio interrompu — nouvelle tentative…'
export const MSG_OBS_DOWN = "OBS s'est arrêté et n'a pas pu redémarrer."
export const MSG_OBS_NOT_READY = "OBS n'est pas encore prêt, réessaie dans quelques secondes."
export const MSG_AUTH = 'Session LinTO expirée — se reconnecter.'
export const MSG_BOOT_FAILED = 'Impossible de démarrer le moteur vidéo (OBS).'
export const MSG_OVERLAY_FAILED = 'Sous-titres non affichés dans OBS : '
export const MSG_OBS_SETUP_FAILED = 'Impossible de configurer OBS : '
export const msgTerminated = (name: string): string =>
  `La session « ${name} » est terminée et ne peut pas être reprise. Choisis un autre nom.`

const PREVIEW_MS = 200
const STOP_WAIT_MS = 10_000
const SHUTDOWN_STOP_WAIT_MS = 3_000
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 30_000]
/** Delays between obs.start() attempts after an intentional restart: 5 attempts in total. */
const OBS_START_DELAYS_MS = [2_000, 5_000, 10_000, 30_000]
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Structural slices of the real modules, so tests can inject fakes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (...args: any[]) => void
export interface LiveObsProcess {
  start: ObsProcess['start']
  stop: ObsProcess['stop']
  on(event: 'ready' | 'restarting' | 'exit', listener: Listener): unknown
}
export type LiveObsController = Pick<
  ObsController,
  | 'ensureScene' | 'listVideoDevices' | 'listAudioDevices' | 'setVideoDevice' | 'setAudioDevice' | 'setOverlayUrl'
  | 'audioLevel$' | 'screenshot' | 'startStream' | 'stopStream' | 'streamState$' | 'monitors'
  | 'openProgramProjector' | 'showLive' | 'showPause' | 'resetProjectorState' | 'disconnect'
>
export type LiveApi = Pick<LintoApi, 'searchSessions' | 'createSession' | 'getSession' | 'terminateSession'>
export interface LiveCaptions {
  open: CaptionStream['open']
  close: CaptionStream['close']
  on(event: 'status' | 'partial' | 'final' | 'authError', listener: Listener): unknown
}
export type LiveOverlay = Pick<OverlayServer, 'start' | 'push' | 'stop'>
export type LiveSettings = Pick<SettingsStore, 'get' | 'update' | 'setToken'>

export interface LiveDeps {
  obs: LiveObsProcess
  controllerFactory: (c: ObsConnection) => Promise<LiveObsController>
  api: LiveApi
  captions: LiveCaptions
  overlay: LiveOverlay
  settings: LiveSettings
  platform: NodeJS.Platform
}

interface Current {
  orgId: string
  session: Session
  channel: Channel
  service: ObsStreamService | null
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * Orchestrates OBS, LinTO captions and the overlay for one live show.
 * Events: 'state'(LiveState) 'preview'(dataUrl) 'audio-level'(dB) 'auth-required'().
 * start/stop/terminate/changeDisplay and OBS (re)attachment run one at a time through a promise queue.
 */
export class LiveController extends EventEmitter {
  private state: LiveState = { phase: 'idle', stream: 'off', captions: 'offline', obs: 'down', output: 'off' }
  private ctl: LiveObsController | null = null
  private unsubs: (() => void)[] = []
  private overlayUrl: string | null = null
  private current: Current | null = null
  private buffer = new CaptionBuffer()
  private projectorIndex: number | null = null
  private streamRunning = false
  private stopRequested = false
  private stopWaiters: (() => void)[] = []
  private retryTimer: NodeJS.Timeout | null = null
  private retryAttempt = 0
  private previewTimer: NodeJS.Timeout | null = null
  private previewBusy = false
  private intentionalObsStop = false
  private shuttingDown = false
  private restartGen = 0
  private tail: Promise<unknown> = Promise.resolve()

  constructor(private readonly d: LiveDeps) {
    super()
    d.obs.on('ready', (c: ObsConnection) => {
      if (this.shuttingDown) return
      this.enqueue(() => this.attach(c)).catch((e) => this.setState({ warning: `OBS : ${errMsg(e)}` }))
    })
    d.obs.on('restarting', () => {
      this.dropController()
      this.setState({ obs: 'restarting' })
    })
    d.obs.on('exit', () => {
      if (this.intentionalObsStop || this.shuttingDown) return
      this.dropController()
      this.stopPreview()
      this.setState({ obs: 'down', phase: 'error', warning: MSG_OBS_DOWN })
    })
    d.captions.on('status', (s: CaptionStatus) => this.setState({ captions: s }))
    d.captions.on('partial', (e: CaptionEvent) => this.showCaption(this.buffer.partial(e).lines, true))
    d.captions.on('final', (e: CaptionEvent) => this.showCaption(this.buffer.final(e).lines, false))
    d.captions.on('authError', () => this.reportUnauthorized())
  }

  getState(): LiveState {
    return { ...this.state }
  }

  /** Resolves once every queued operation has finished. */
  async settled(): Promise<void> {
    let t: Promise<unknown>
    do {
      t = this.tail
      await t
    } while (t !== this.tail)
  }

  async boot(): Promise<void> {
    try {
      this.overlayUrl = (await this.d.overlay.start()).url
      await this.d.obs.start() // emits 'ready' → attach is queued
      await this.settled()
      if (!this.ctl) throw new Error(this.state.warning ?? 'OBS non connecté')
    } catch (e) {
      this.setState({ obs: 'down', warning: MSG_BOOT_FAILED })
      throw e
    }
  }

  start(sessionName: string): Promise<StartResult> {
    return this.enqueue(() => this.doStart(sessionName))
  }

  stop(): Promise<void> {
    return this.enqueue(() => this.doStop())
  }

  terminate(): Promise<void> {
    return this.enqueue(async () => {
      const cur = this.current
      if (cur) {
        try {
          await this.d.api.terminateSession(cur.orgId, cur.session.id)
        } catch (e) {
          if (e instanceof UnauthorizedError) {
            this.reportUnauthorized()
            throw new Error(MSG_AUTH)
          }
          throw e
        }
      }
      await this.doStop()
    })
  }

  changeDisplay(display: SavedDisplay): Promise<void> {
    return this.enqueue(async () => {
      this.d.settings.update({ output: display })
      if (this.state.phase !== 'live' || !this.ctl) return
      await this.applyOutput()
    })
  }

  async shutdown(): Promise<void> {
    await this.enqueue(() => this.doStop(SHUTDOWN_STOP_WAIT_MS)).catch(() => {})
    this.shuttingDown = true
    this.restartGen++
    this.clearRetry()
    this.stopPreview()
    await this.settled()
    const c = this.ctl
    this.dropController()
    await c?.disconnect().catch(() => {})
    await this.d.obs.stop().catch(() => {})
    await this.d.overlay.stop().catch(() => {})
    this.setState({ obs: 'down' })
  }

  /** After a successful re-login: re-open captions on the session being shown. */
  resumeCaptions(): void {
    const cur = this.current
    if (!cur || this.state.phase !== 'live') return
    this.d.captions.open(cur.session.id, cur.channel.id)
  }

  /**
   * A LinTO call was rejected with 401. During a live show nothing is torn down and the token is kept
   * (OBS output and stream continue); otherwise the token is cleared. Either way the UI is asked to log in.
   */
  reportUnauthorized(): void {
    const live = this.state.phase === 'live' || this.state.phase === 'starting'
    if (!live) this.d.settings.setToken(null)
    this.setState({ captions: 'offline' })
    this.emit('auth-required')
  }

  /** Device + monitor lists for the setup screen (empty while OBS is not connected). */
  async listDevices(): Promise<{ videoDevices: DeviceItem[]; audioDevices: DeviceItem[]; displays: MonitorInfo[] }> {
    const c = this.ctl
    if (!c) return { videoDevices: [], audioDevices: [], displays: [] }
    const [videoDevices, audioDevices, displays] = await Promise.all([
      c.listVideoDevices().catch(() => []),
      c.listAudioDevices().catch(() => []),
      c.monitors().catch(() => [])
    ])
    return { videoDevices, audioDevices, displays }
  }

  /** Persists setup choices and applies device changes to OBS right away. */
  saveSettings(patch: Partial<Settings>): Promise<void> {
    return this.enqueue(async () => {
      const before = this.d.settings.get()
      this.d.settings.update(patch)
      const c = this.ctl
      if (!c) return
      if (patch.videoDeviceId && patch.videoDeviceId !== before.videoDeviceId) await c.setVideoDevice(patch.videoDeviceId)
      if (patch.audioDeviceId && patch.audioDeviceId !== before.audioDeviceId) await c.setAudioDevice(patch.audioDeviceId)
    })
  }

  // ---------------------------------------------------------------------------------------------

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn)
    this.tail = run.catch(() => {})
    return run
  }

  private setState(patch: Partial<LiveState>): void {
    this.state = { ...this.state, ...patch }
    for (const k of Object.keys(this.state) as (keyof LiveState)[]) if (this.state[k] === undefined) delete this.state[k]
    this.emit('state', this.getState())
  }

  private showCaption(lines: string[], partial: boolean): void {
    this.d.overlay.push({ lines, partial })
    const last = lines[lines.length - 1]
    if (last !== undefined && last !== this.state.lastLine) this.setState({ lastLine: last })
  }

  private dropController(): void {
    this.unsubs.forEach((u) => u())
    this.unsubs = []
    this.ctl = null
    this.projectorIndex = null
    this.streamRunning = false
    this.clearRetry()
    this.flushStopWaiters()
  }

  /** (Re)connects to a freshly started OBS and re-applies devices, overlay and — if live — the show. */
  private async attach(conn: ObsConnection): Promise<void> {
    const old = this.ctl
    this.dropController()
    await old?.disconnect().catch(() => {})
    let c: LiveObsController | null = null
    try {
      c = await this.d.controllerFactory(conn)
      c.resetProjectorState() // R4: a new OBS run has no projector open and new scene item ids
      await c.ensureScene(this.d.platform)
    } catch (e) {
      await c?.disconnect().catch(() => {})
      this.setState({ obs: 'down', warning: MSG_OBS_SETUP_FAILED + errMsg(e) })
      return
    }
    const ready = c
    this.unsubs.push(ready.audioLevel$((db) => this.emit('audio-level', db)))
    this.unsubs.push(ready.streamState$((s) => this.onStreamState(ready, s)))
    this.ctl = ready
    const s = this.d.settings.get()
    let warning: string | undefined
    if (s.videoDeviceId) await ready.setVideoDevice(s.videoDeviceId).catch(() => {})
    if (s.audioDeviceId) await ready.setAudioDevice(s.audioDeviceId).catch(() => {})
    if (this.overlayUrl) await ready.setOverlayUrl(this.overlayUrl).catch((e) => (warning = MSG_OVERLAY_FAILED + errMsg(e)))
    const w0 = this.state.warning
    const staleObsWarning = w0 === MSG_OBS_DOWN || w0 === MSG_BOOT_FAILED || w0?.startsWith(MSG_OBS_SETUP_FAILED)
    this.setState({ obs: 'running', ...(warning ? { warning } : staleObsWarning ? { warning: undefined } : {}) })
    if (this.state.phase === 'live' && this.current) await this.applyShow(ready, this.current)
  }

  /** Program scene, then output (which may decide to restart OBS), then — only if no restart — the stream. */
  private async applyShow(c: LiveObsController, cur: Current): Promise<void> {
    await c.showLive().catch(() => {})
    if ((await this.applyOutput()) === 'restarting') return // the next 'ready' re-applies the whole show
    if (cur.service) await this.startStreamSafe(c, cur.service)
  }

  private async startStreamSafe(c: LiveObsController, service: ObsStreamService): Promise<void> {
    this.setState({ stream: 'starting' })
    try {
      await c.startStream(service)
      if (c === this.ctl) this.streamRunning = true
    } catch (e) {
      if (c !== this.ctl || this.state.phase !== 'live') return
      this.setState({ stream: 'error', warning: MSG_STREAM_RETRY })
      this.scheduleRetry()
    }
  }

  /** Opens the projector on the saved display; if one is already open elsewhere, restarts OBS (R12). */
  private async applyOutput(): Promise<'done' | 'restarting'> {
    const c = this.ctl
    if (!c) return 'done'
    const saved = this.d.settings.get().output
    const list = await c.monitors().catch(() => [] as MonitorInfo[])
    const m = saved ? matchDisplay(saved, list) : null
    if (!m) {
      this.setState({ output: 'display-missing' })
      return 'done'
    }
    if (this.projectorIndex !== null && this.projectorIndex !== m.index) {
      await this.restartObs()
      return 'restarting'
    }
    try {
      await c.openProgramProjector(m.index)
      this.projectorIndex = m.index
      this.setState({ output: 'shown' })
    } catch (e) {
      this.setState({ output: 'off', warning: `Sortie HDMI : ${errMsg(e)}` })
    }
    return 'done'
  }

  /**
   * No websocket request closes a projector: quit OBS, then start it again in the background with
   * backoff (the queued 'ready' → attach re-applies the show). Never throws.
   */
  private async restartObs(): Promise<void> {
    const c = this.ctl
    this.dropController()
    this.setState({ obs: 'restarting' })
    this.intentionalObsStop = true
    try {
      await c?.disconnect().catch(() => {})
      await this.d.obs.stop().catch(() => {})
    } finally {
      this.intentionalObsStop = false
    }
    void this.startObsWithRetry(++this.restartGen)
  }

  private async startObsWithRetry(gen: number): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      if (this.shuttingDown || gen !== this.restartGen) return
      try {
        await this.d.obs.start()
        return
      } catch {
        if (attempt >= OBS_START_DELAYS_MS.length) break
        await sleep(OBS_START_DELAYS_MS[attempt])
      }
    }
    if (this.shuttingDown || gen !== this.restartGen) return
    this.dropController()
    this.stopPreview()
    this.setState({ obs: 'down', phase: 'error', warning: MSG_OBS_DOWN })
  }

  private async doStart(rawName: string): Promise<StartResult> {
    const s = this.d.settings.get()
    if (!s.orgId || s.profileId === undefined) {
      return { ok: false, message: 'Choisis une organisation et un profil de transcription.' }
    }
    if (!this.ctl) return { ok: false, message: MSG_OBS_NOT_READY }

    // Resolve first: a failure here must leave a running show (preview, stream supervision) untouched.
    let res: Awaited<ReturnType<typeof resolveSession>>
    try {
      res = await resolveSession(this.d.api, s.orgId, rawName, s.profileId)
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        if (this.state.phase !== 'live') this.d.settings.setToken(null)
        this.emit('auth-required')
        return { ok: false, message: MSG_AUTH }
      }
      return { ok: false, message: errMsg(e) }
    }
    if (res.kind === 'terminated') return { ok: false, message: msgTerminated(res.name) }

    try {
      this.d.settings.update({ lastSessionName: res.session.name })
      this.setState({ phase: 'starting' })

      // Switching from a previous show: the old stream must be fully stopped before retargeting.
      this.clearRetry()
      this.stopPreview()
      if (this.current) this.d.captions.close()
      if (this.streamRunning) await this.stopStreamAndWait()

      const service = toObsStreamService(res.channel.streamEndpoints ?? {})
      const cur: Current = { orgId: s.orgId, session: res.session, channel: res.channel, service: res.canStream ? service : null }
      this.current = cur
      this.buffer = new CaptionBuffer()
      this.d.overlay.push({ lines: [], partial: false })
      this.setState({
        phase: 'live',
        session: { name: res.session.name, status: res.session.status },
        stream: cur.service ? 'starting' : 'unavailable',
        warning: cur.service ? undefined : MSG_NO_STREAM,
        output: 'off',
        lastLine: undefined
      })
      this.d.captions.open(res.session.id, res.channel.id)

      const c = this.ctl
      if (c) await this.applyShow(c, cur)
    } catch (e) {
      if (this.state.phase !== 'live') {
        this.setState({ phase: 'error', warning: errMsg(e) })
        return { ok: false, message: errMsg(e) }
      }
      this.setState({ warning: errMsg(e) })
    }
    this.startPreview()
    return { ok: true, reused: res.kind === 'reused', canStream: res.canStream }
  }

  private async doStop(streamWaitMs = STOP_WAIT_MS): Promise<void> {
    if (this.state.phase === 'idle' && !this.current) return
    this.setState({ phase: 'stopping' })
    this.clearRetry()
    this.stopPreview()
    this.d.captions.close()
    await this.stopStreamAndWait(streamWaitMs)
    await this.ctl?.showPause().catch(() => {})
    this.current = null
    this.buffer = new CaptionBuffer()
    this.d.overlay.push({ lines: [], partial: false })
    this.setState({
      phase: 'idle',
      session: undefined,
      stream: 'off',
      captions: 'offline',
      output: 'off',
      warning: undefined,
      lastLine: undefined
    })
  }

  /** Stops the OBS stream and waits for OBS to report it stopped (StopStream is asynchronous). */
  private async stopStreamAndWait(waitMs = STOP_WAIT_MS): Promise<void> {
    const c = this.ctl
    if (!c) return
    if (!this.streamRunning) {
      await c.stopStream().catch(() => {})
      return
    }
    this.stopRequested = true
    let timer: NodeJS.Timeout | undefined
    const stopped = new Promise<void>((resolve) => {
      this.stopWaiters.push(resolve)
      timer = setTimeout(resolve, waitMs)
    })
    try {
      await c.stopStream()
      await stopped
    } catch {
      /* OBS gone or already stopped */
    } finally {
      clearTimeout(timer)
      this.stopRequested = false
      this.streamRunning = false
    }
  }

  private flushStopWaiters(): void {
    const w = this.stopWaiters
    this.stopWaiters = []
    w.forEach((r) => r())
  }

  private onStreamState(c: LiveObsController, s: StreamState): void {
    if (c !== this.ctl) return
    const live = this.state.phase === 'live' && !!this.current?.service
    switch (s) {
      case 'starting':
        this.streamRunning = true
        if (live) this.setState({ stream: 'starting' })
        return
      case 'active':
        this.streamRunning = true
        this.retryAttempt = 0
        this.clearRetry()
        if (live) {
          this.setState({ stream: 'active', ...(this.state.warning === MSG_STREAM_RETRY ? { warning: undefined } : {}) })
        }
        return
      case 'error':
        if (live) this.setState({ stream: 'error' })
        return
      case 'stopped':
        this.streamRunning = false
        this.flushStopWaiters()
        if (this.stopRequested || !live) return
        this.setState({ stream: 'error', warning: MSG_STREAM_RETRY })
        this.scheduleRetry()
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return
    const delay = RETRY_DELAYS_MS[Math.min(this.retryAttempt, RETRY_DELAYS_MS.length - 1)]
    this.retryAttempt += 1
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.enqueue(async () => {
        const c = this.ctl
        const cur = this.current
        if (!c || !cur?.service || this.state.phase !== 'live') return
        await this.startStreamSafe(c, cur.service)
      })
    }, delay)
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  private startPreview(): void {
    this.stopPreview()
    this.previewTimer = setInterval(() => {
      if (this.state.phase !== 'live') return this.stopPreview()
      const c = this.ctl
      if (!c || this.previewBusy) return
      this.previewBusy = true
      c.screenshot()
        .then((img) => {
          if (this.state.phase === 'live') this.emit('preview', img)
        })
        .catch(() => {})
        .finally(() => (this.previewBusy = false))
    }, PREVIEW_MS)
  }

  private stopPreview(): void {
    if (this.previewTimer) clearInterval(this.previewTimer)
    this.previewTimer = null
  }
}
