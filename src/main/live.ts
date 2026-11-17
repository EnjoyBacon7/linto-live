import { EventEmitter } from 'node:events'
import type { LiveState, StartResult } from '../shared/ipc'
import {
  DEFAULT_QR, DEFAULT_SUBTITLE_FONT_SIZE, ForbiddenError, NotFoundError, SUBTITLE_FONT_SIZE_MAX, SUBTITLE_FONT_SIZE_MIN, UnauthorizedError,
  type Channel, type DeviceItem, type NewSessionOptions, type Session, type SessionSummary, type Settings, type Transcript, type TranscriptUpdate,
  type TranslationEvent, type VideoSource, type Watermark, type WatermarkConfig
} from '../shared/types'
import { ORIGINAL, routeOriginal, routeTranslation, subtitleLanguageOptions, type Routed } from '../shared/subtitleLanguage'
import type { ObsConnection, ObsProcess } from './obs/process'
import { recordBaseName, type ObsController, type StreamState } from './obs/controller'
import { toObsStreamService, type ObsStreamService } from './obs/streamTarget'
import { FallbackMonitor, type Luma } from './obs/fallback'
import type { LintoApi } from './linto/api'
import { type CaptionEvent, type CaptionStatus, type CaptionStream } from './linto/captions'
import { resolveSession } from './linto/sessionResolver'
import { lintoErrorMessage } from './linto/accessMessages'
import { TranscriptLog } from './linto/transcript'
import type { OverlayServer } from './overlay/server'
import { resolveWatermark, sameWatermark } from './linto/watermark'
import { publicLink } from '../shared/publicLink'
import type { SettingsStore } from './settings'

const NO_SOURCE: VideoSource = { kind: 'none' }
/** Same video source (an absent setting counts as none). */
function sameSource(a: VideoSource = NO_SOURCE, b: VideoSource = NO_SOURCE): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'device') return a.id === (b as typeof a).id
  if (a.kind === 'image' || a.kind === 'video') return a.path === (b as typeof a).path
  return true
}

export const MSG_NO_STREAM =
  "Impossible d'envoyer l'audio : LinTO ne le permet qu'au propriétaire de la session et aux gestionnaires de réunion de l'organisation."
/** The session's channel only offers RTMP, which does not work towards LinTO (spikes/RESULTS.md). */
export const MSG_RTMP_ONLY =
  "Impossible d'envoyer l'audio : cette session ne propose que le protocole RTMP, non pris en charge (SRT requis)."
export const MSG_STREAM_RETRY = 'Envoi audio interrompu — nouvelle tentative…'
export const MSG_OBS_DOWN = "OBS s'est arrêté et n'a pas pu redémarrer."
export const MSG_OBS_NOT_READY = "OBS n'est pas encore prêt, réessaie dans quelques secondes."
export const MSG_AUTH = 'Session LinTO expirée — se reconnecter.'
export const MSG_BOOT_FAILED = 'Impossible de démarrer le moteur vidéo (OBS).'
export const MSG_OVERLAY_FAILED = 'Sous-titres non affichés dans OBS : '
export const MSG_OBS_SETUP_FAILED = 'Impossible de configurer OBS : '
export const MSG_OBS_RESTARTED = 'OBS a redémarré automatiquement.'
export const MSG_OUTPUT_FAILED = 'Fenêtre de sortie : '
export const MSG_RECORD_FAILED = 'Enregistrement impossible : '
export const MSG_PRIMARY_FAILED = 'Source principale indisponible : '
const MSG_RECORD_NOT_STARTED = "OBS n'a pas démarré l'enregistrement."
const MSG_RECORD_STOPPED = "OBS a arrêté l'enregistrement."
export const MSG_NO_ORG = 'Choisis une organisation.'
export const MSG_START_CANCELLED = 'Démarrage annulé.'
/** The caption socket was refused while the token is still valid: access to the session itself was lost. */
export const MSG_CAPTIONS_FORBIDDEN =
  "Sous-titres refusés : tu n'as plus accès à cette session sur LinTO (retiré de l'organisation ?). L'audio continue d'être envoyé."
/** The caption socket was refused although LinTO still lets the user read the session: retried. */
export const MSG_CAPTIONS_REFUSED = 'LinTO a refusé la connexion des sous-titres — nouvelle tentative…'
export const msgTerminated = (name: string): string =>
  `La session « ${name} » est terminée et ne peut pas être reprise. Choisis un autre nom.`
export const msgDeleted = (name: string): string => `La session « ${name} » a été supprimée sur LinTO.`

export const PREVIEW_MS = 50 // 20 fps: a 640 px JPEG screenshot costs ~3 ms in OBS and does not delay its rendering
const STOP_WAIT_MS = 10_000
const SHUTDOWN_STOP_WAIT_MS = 3_000
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 30_000]
/** From this stream retry on, ask LinTO whether the session was terminated elsewhere before retrying. */
const RETRY_PROBE_FROM = 3
/** Delays between obs.start() attempts after an intentional restart: 5 attempts in total. */
const OBS_START_DELAYS_MS = [2_000, 5_000, 10_000, 30_000]
/** Captions not live for this long during a show: hide the stale overlay box and probe the LinTO token. */
const CAPTIONS_STALE_MS = 30_000
/** Caption socket refused with a still valid token: wait this long before joining again. */
const CAPTIONS_REFUSED_RETRY_MS = 30_000
/** StartRecord accepted but no « started » from OBS within this delay: the recording failed. */
const RECORD_START_WAIT_MS = 5_000
/** StartRecord refused because the previous recording output is still stopping: retries, this far apart. */
const RECORD_RUNNING_RETRIES = 5
const RECORD_RUNNING_RETRY_MS = 200
/** obs-websocket RequestStatus::OutputRunning. */
const OUTPUT_RUNNING = 500
/** OBS liveness watchdog: a ping this often, outside the queue (it must work while the queue waits on OBS). */
export const WATCHDOG_MS = 10_000
/** Consecutive unanswered pings before OBS is deemed hung and killed (each one waits up to the call timeout). */
export const WATCHDOG_MISSES = 3
export const MSG_OBS_HUNG = 'OBS ne répondait plus : redémarrage…'
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
/** Runs `fn` with one deadline (`limit` resolves after `ms`) that all its waits share; the timer is cleared after. */
async function withDeadline<T>(ms: number, fn: (limit: Promise<void>) => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const limit = new Promise<void>((r) => {
    timer = setTimeout(r, ms)
  })
  try {
    return await fn(limit)
  } finally {
    clearTimeout(timer)
  }
}

/** Structural slices of the real modules, so tests can inject fakes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (...args: any[]) => void
export interface LiveObsProcess {
  start: ObsProcess['start']
  stop: ObsProcess['stop']
  /** Kills an OBS that no longer answers so it restarts (absent in fakes that never hang). */
  killHung?: ObsProcess['killHung']
  on(event: 'ready' | 'restarting' | 'exit', listener: Listener): unknown
}
export type LiveObsController = Pick<
  ObsController,
  | 'ensureScene' | 'listVideoDevices' | 'listAudioDevices' | 'setSource' | 'setBackupVisible' | 'probePrimary'
  | 'setAudioDevice' | 'setOverlayUrl'
  | 'audioLevel$' | 'screenshot' | 'startStream' | 'stopStream' | 'streamState$'
  | 'startRecord' | 'stopRecord' | 'recordState$'
  | 'openOutputWindow' | 'showLive' | 'resetProjectorState' | 'disconnect' | 'ping'
>
export type LiveApi = Pick<LintoApi, 'searchSessions' | 'createSession' | 'getSession' | 'terminateSession'>
export interface LiveCaptions {
  open: CaptionStream['open']
  close: CaptionStream['close']
  on(event: 'status' | 'partial' | 'final' | 'translation' | 'authError', listener: Listener): unknown
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
  /** SVG markup of a QR code for `url`. */
  qrSvg: (url: string) => Promise<string>
  /** Luma of a probePrimary() picture (null when it has no pixels: the source is absent). */
  decodeLuma: (dataUrl: string) => Luma | null
  /** The instance's watermark defaults (config.js); LinTO Studio's defaults when absent. */
  watermarkConfig?: () => WatermarkConfig
  /** `mkdir -p` (OBS does not create the record folder, and then silently records nothing). */
  mkdirp: (dir: string) => Promise<void>
  /** Record folder when Settings.recordDir is not set. */
  defaultRecordDir: string
}

/** Font size actually used on the canvas: the saved one if valid, else the default. */
export function subtitleFontSize(s: Pick<Settings, 'subtitleFontSize'>): number {
  const v = s.subtitleFontSize
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.min(SUBTITLE_FONT_SIZE_MAX, Math.max(SUBTITLE_FONT_SIZE_MIN, Math.round(v)))
    : DEFAULT_SUBTITLE_FONT_SIZE
}

interface Current {
  orgId: string
  session: Session
  channel: Channel
  service: ObsStreamService | null
  /** Subtitle languages the channel offers (subtitleLanguageOptions values). */
  languageChoices: Set<string>
}

/** Arrêter (or quit) was asked while this action waited on LinTO: it gives up so the stop runs now. */
class CancelledError extends Error {
  constructor() {
    super('Annulé')
    this.name = 'CancelledError'
  }
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * Orchestrates OBS, LinTO captions and the overlay for one live show.
 * Events: 'state'(LiveState) 'transcript'(TranscriptUpdate) 'preview'(dataUrl) 'audio-level'(dB) 'auth-required'()
 * 'recording-saved'(path).
 * start/stop/terminate/showOutputWindow and OBS (re)attachment run one at a time through a promise queue.
 * Arrêter does not wait behind a slow LinTO call: stop() cancels the start, terminate or stream retry queued
 * before it (their LinTO wait is abandoned, see abortable), so the stop runs right after.
 * The transcript of the last show is kept until the next start (getTranscript). The camera preview runs
 * while OBS is attached, the renderer shows it (setPreviewSubscribed) and the window is visible
 * (setWindowVisible); audio levels are only forwarded while the window is visible. No request closes or lists
 * projectors: the output window only opens on demand (showOutputWindow), on or off air, and keeps showing the
 * camera after Arrêter. The show is recorded when Settings.recordEnabled is set at Démarrer (a new file per
 * session and per OBS run); recording never blocks nor fails the show.
 */
export class LiveController extends EventEmitter {
  private state: LiveState = { phase: 'idle', stream: 'off', captions: 'offline', obs: 'down', output: 'off', recording: 'off' }
  private ctl: LiveObsController | null = null
  private unsubs: (() => void)[] = []
  private overlayUrl: string | null = null
  private current: Current | null = null
  /** Watermark of the session on air (null when off air: no watermark then). */
  private watermark: Watermark | null = null
  /** QR code of the on-air session's public link (null when off air); computed once at start. */
  private qrCache: { url: string; svg: string } | null = null
  private streamRunning = false
  private stopRequested = false
  private stopWaiters: (() => void)[] = []
  private retryTimer: NodeJS.Timeout | null = null
  private retryAttempt = 0
  private previewTimer: NodeJS.Timeout | null = null
  private watchdogTimer: NodeJS.Timeout | null = null
  private watchdogBusy = false
  private watchdogMisses = 0
  private previewBusy = false
  private previewSubscribed = false
  private windowVisible = true
  private intentionalObsStop = false
  private shuttingDown = false
  private restartGen = 0
  private attachedConn: ObsConnection | null = null
  private crashRestart = false
  /** boot() is starting/attaching OBS: Démarrer must not revive (kill) it meanwhile. */
  private booting = false
  private captionsTimer: NodeJS.Timeout | null = null
  private captionsRetryTimer: NodeJS.Timeout | null = null
  private captionsAuthLost = false
  /** LinTO rejected the token and the UI was told; cleared by re-login (resumeCaptions), stop or a new start. */
  private authLost = false
  private tail: Promise<unknown> = Promise.resolve()
  /** Bumped by stop()/shutdown(): actions queued before then give up their LinTO waits (abortable). */
  private cancelGen = 0
  private cancelListeners = new Set<() => void>()
  private transcript = new TranscriptLog()
  /** Switches to the backup source when the primary is absent (only while a backup is configured and OBS attached). */
  private monitor: FallbackMonitor | null = null
  /** Settings.recordEnabled read at Démarrer: the show on air is recorded (fixed until it ends). */
  private recordIntent = false
  /** startRecord was sent and OBS has not reported the recording started yet. */
  private recordAwaiting = false
  private recordTimer: NodeJS.Timeout | null = null
  /** stopRecord in progress: its own result announces the file, not OBS's « stopped » event. */
  private recordStopping = false
  /** stopRecord gave up waiting for OBS: OBS's « stopped » event, when it comes, announces the file. */
  private recordAnnouncePending = false
  /** Waiting for OBS's « stopped » recording event (StopRecord may answer before the output has stopped). */
  private recordStopWaiters: (() => void)[] = []

  constructor(private readonly d: LiveDeps) {
    super()
    d.obs.on('ready', (c: ObsConnection) => {
      if (this.shuttingDown) return
      this.enqueue(() => this.attach(c)).catch((e) => this.setState({ warning: `OBS : ${errMsg(e)}` }))
    })
    d.obs.on('restarting', () => {
      this.dropController()
      this.crashRestart = true
      this.setState({ obs: 'restarting' })
    })
    d.obs.on('exit', () => {
      if (this.intentionalObsStop || this.shuttingDown) return
      this.dropController()
      // OBS gave up: the show cannot continue. Tear it down like Arrêter (nothing left to stop in OBS)
      // so the UI is not stuck on a live session; the error phase and warning tell what happened.
      this.clearCaptionsTimer()
      this.recordIntent = false
      if (this.current) {
        this.d.captions.close()
        this.current = null
        this.watermark = null
        this.qrCache = null
        this.pushStyle()
        this.d.overlay.push({ type: 'reset' })
      }
      this.setState({
        obs: 'down',
        phase: 'error',
        warning: MSG_OBS_DOWN,
        session: undefined,
        stream: 'off',
        captions: 'offline',
        startedAt: undefined
      })
      this.sendTranscript(this.transcript.endPartial())
    })
    d.captions.on('status', (s: CaptionStatus) => {
      const recovered = s === 'live' && this.state.warning === MSG_CAPTIONS_REFUSED
      this.setState({ captions: s, ...(recovered ? { warning: undefined } : {}) })
      this.superviseCaptions()
    })
    // The transcript always keeps the originals; the band shows the chosen language only.
    d.captions.on('partial', (e: CaptionEvent) => {
      this.pushCaption(routeOriginal(this.subtitleLanguage(), false, e.text))
      this.sendTranscript(this.transcript.partial(e))
    })
    d.captions.on('final', (e: CaptionEvent) => {
      this.pushCaption(routeOriginal(this.subtitleLanguage(), true, e.text))
      this.sendTranscript(this.transcript.final(e))
    })
    d.captions.on('translation', (e: TranslationEvent) => {
      this.pushCaption(routeTranslation(this.subtitleLanguage(), this.current?.channel.languages, e))
    })
    d.captions.on('authError', () => void this.captionsRefused())
  }

  getState(): LiveState {
    return { ...this.state }
  }

  /** Transcript of the show on air, or of the last one (kept until the next start). */
  getTranscript(): Transcript {
    return this.transcript.snapshot()
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
    this.booting = true
    try {
      this.overlayUrl = (await this.d.overlay.start()).url
      this.pushStyle()
      // Each successful start emits 'ready' → attach is queued.
      if (!(await this.startObsWithRetry(++this.restartGen))) throw new Error('OBS start failed')
      await this.settled()
      if (!this.ctl) throw new Error(this.state.warning ?? 'OBS non connecté')
    } catch (e) {
      this.setState({ obs: 'down', warning: MSG_BOOT_FAILED })
      throw e
    } finally {
      this.booting = false
    }
  }

  /** `create`: options of the session created when none has this name. */
  start(sessionName: string, create?: NewSessionOptions): Promise<StartResult> {
    const gen = this.cancelGen
    return this.enqueue(() => this.doStart(sessionName, gen, create))
  }

  /** Arrêter: cancels the actions queued before it (see abortable), then stops the show. */
  stop(): Promise<void> {
    this.cancelQueued()
    return this.enqueue(() => this.doStop())
  }

  terminate(): Promise<void> {
    const gen = this.cancelGen
    return this.enqueue(async () => {
      if (gen !== this.cancelGen) return // Arrêter came first: it ends the show, the session is left as is
      const cur = this.current
      if (cur) {
        // Stop sending audio first: a session terminated under a running stream looks like a stream
        // failure (error, retry, notification). Captions are torn down by doStop, after the termination.
        const wasLive = this.state.phase === 'live'
        this.setState({ phase: 'stopping' })
        this.clearRetry()
        await withDeadline(STOP_WAIT_MS, (limit) => this.stopStreamAndWait(limit))
        try {
          await this.abortable(gen, this.d.api.terminateSession(cur.orgId, cur.session.id))
        } catch (e) {
          // Arrêter while LinTO was slow to answer: end the show now (the termination may still go through).
          if (e instanceof CancelledError) return this.doStop()
          // Deleted on LinTO meanwhile: there is nothing left to terminate, the show just ends.
          if (e instanceof NotFoundError) return this.doStop()
          if (wasLive && cur === this.current) {
            // The session goes on: so does the show.
            this.setState({ phase: 'live' })
            const c = this.ctl
            if (c && cur.service) await this.startStreamSafe(c, cur.service)
          }
          if (e instanceof UnauthorizedError) {
            this.reportUnauthorized()
            throw new Error(MSG_AUTH)
          }
          throw new Error(lintoErrorMessage(e, 'terminate') ?? errMsg(e), { cause: e })
        }
      }
      await this.doStop()
    })
  }

  /** The user asked for the output window (e.g. closed it by mistake): always open one if OBS is attached. */
  showOutputWindow(): Promise<void> {
    return this.enqueue(async () => {
      this.clearRestartedNotice()
      const c = this.ctl
      if (c) await this.openOutput(c)
    })
  }

  async shutdown(): Promise<void> {
    this.cancelQueued()
    await this.enqueue(() => this.doStop(SHUTDOWN_STOP_WAIT_MS)).catch(() => {})
    this.shuttingDown = true
    this.restartGen++
    this.clearRetry()
    this.clearCaptionsTimer()
    await this.settled()
    const c = this.ctl
    this.dropController()
    await c?.disconnect().catch(() => {})
    await this.d.obs.stop().catch(() => {})
    await this.d.overlay.stop().catch(() => {})
    this.setState({ obs: 'down' })
  }

  /** The renderer shows (or stops showing) the camera preview. */
  setPreviewSubscribed(on: boolean): void {
    this.previewSubscribed = on
    this.updatePreview()
  }

  /** The main window was shown/restored (true) or hidden/minimised (false). */
  setWindowVisible(on: boolean): void {
    this.windowVisible = on
    this.updatePreview()
  }

  /** After a successful re-login: re-open captions on the session being shown. */
  resumeCaptions(): void {
    this.authLost = false
    const cur = this.current
    if (!cur || this.state.phase !== 'live') return
    this.captionsAuthLost = false
    this.d.captions.open(cur.session.id, cur.channel.id)
  }

  /**
   * A LinTO call was rejected with 401. During a live show nothing is torn down and the token is kept
   * (OBS output and stream continue); otherwise the token is cleared. The UI is asked to log in once per
   * loss (until resumeCaptions(), stop or the next start). Only a caption-side failure ('captions': the
   * socket, or the stale-captions probe) marks the captions offline and stops supervising them: a REST
   * 401 (e.g. the sessions list) says nothing about a caption socket that may still be delivering.
   */
  reportUnauthorized(source: 'api' | 'captions' = 'api'): void {
    if (source === 'captions') {
      this.captionsAuthLost = true // no token probing until resumeCaptions() / the next start
      this.clearCaptionsTimer()
      this.setState({ captions: 'offline' })
    }
    if (this.authLost) return
    this.authLost = true
    const live = this.state.phase === 'live' || this.state.phase === 'starting'
    if (!live) this.d.settings.setToken(null)
    this.emit('auth-required')
  }

  /** « Effacer les sous-titres »: empties the band (it comes back with the next words); the transcript stays. */
  clearSubtitles(): void {
    this.d.overlay.push({ type: 'reset' })
  }

  /** Saves the language shown in the band for a session; if it is on air, the band empties and switches now. */
  async setSubtitleLanguage(sessionId: string, choice: string): Promise<void> {
    const saved = this.d.settings.get().subtitleLanguages
    if ((saved?.[sessionId] ?? ORIGINAL) === choice) return
    const subtitleLanguages = { ...saved, [sessionId]: choice }
    this.d.settings.update({ subtitleLanguages })
    if (this.current?.session.id === sessionId) this.d.overlay.push({ type: 'reset' })
  }

  /** A session's watermark was saved or re-read from LinTO: the overlay follows if that session is on air. */
  watermarkChanged(sessionId: string, w: Watermark): void {
    if (this.current?.session.id !== sessionId || (this.watermark && sameWatermark(this.watermark, w))) return
    this.watermark = w
    this.pushStyle()
  }

  /** Fresh session list: picks up a watermark changed elsewhere (e.g. in LinTO Studio) for the session on air. */
  syncWatermarks(list: SessionSummary[]): void {
    const id = this.current?.session.id
    const s = id ? list.find((x) => x.id === id) : undefined
    if (s) this.watermarkChanged(s.id, s.watermark)
  }

  /** Device lists for the setup screen (empty while OBS is not connected). */
  async listDevices(): Promise<{ videoDevices: DeviceItem[]; audioDevices: DeviceItem[] }> {
    const c = this.ctl
    if (!c) return { videoDevices: [], audioDevices: [] }
    const [videoDevices, audioDevices] = await Promise.all([
      c.listVideoDevices().catch(() => []),
      c.listAudioDevices().catch(() => [])
    ])
    return { videoDevices, audioDevices }
  }

  /** Persists setup choices and applies device changes to OBS right away. */
  saveSettings(patch: Partial<Settings>): Promise<void> {
    return this.enqueue(async () => {
      const before = this.d.settings.get()
      this.d.settings.update(patch)
      if (patch.subtitlesVisible !== undefined || patch.subtitleFontSize !== undefined || patch.qr !== undefined) this.pushStyle()
      const c = this.ctl
      if (!c) return
      // 'none' (the plain LinTO client): the video source is emptied.
      if (patch.primarySource !== undefined && !sameSource(patch.primarySource, before.primarySource)) {
        await c.setSource('primary', patch.primarySource)
        if (this.state.warning?.startsWith(MSG_PRIMARY_FAILED)) this.setState({ warning: undefined })
      }
      // The monitor reads primarySource and blackIsAbsent live: only a backup change concerns it.
      if (patch.backupSource !== undefined && !sameSource(patch.backupSource, before.backupSource)) {
        await c.setSource('backup', patch.backupSource)
        if (this.ctl !== c) return // OBS restarted meanwhile: attach re-applies everything
        // Another backup file keeps the running monitor (the recreated input keeps its visibility).
        if ((patch.backupSource.kind === 'none') !== (this.monitor === null)) this.syncMonitor(c)
      }
      if (patch.audioDeviceId && patch.audioDeviceId !== before.audioDeviceId) await c.setAudioDevice(patch.audioDeviceId)
    })
  }

  // ---------------------------------------------------------------------------------------------

  /** Makes every action queued so far give up its abortable waits. */
  private cancelQueued(): void {
    this.cancelGen++
    const l = [...this.cancelListeners]
    this.cancelListeners.clear()
    l.forEach((f) => f())
  }

  /**
   * `p`, or a CancelledError as soon as stop()/shutdown() is called after the action (queued at `gen`) was
   * queued. `p` itself is not cancelled: its outcome is just no longer awaited.
   */
  private abortable<T>(gen: number, p: Promise<T>): Promise<T> {
    if (gen !== this.cancelGen) {
      p.catch(() => {})
      return Promise.reject(new CancelledError())
    }
    return new Promise<T>((resolve, reject) => {
      const cancel = (): void => reject(new CancelledError())
      this.cancelListeners.add(cancel)
      p.then(
        (v) => { this.cancelListeners.delete(cancel); resolve(v) },
        (e: unknown) => { this.cancelListeners.delete(cancel); reject(e) }
      )
    })
  }

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

  /** Language shown in the band for the session on air; the original one when the saved choice is not offered. */
  private subtitleLanguage(): string {
    const cur = this.current
    const choice = cur && this.d.settings.get().subtitleLanguages?.[cur.session.id]
    return choice && cur.languageChoices.has(choice) ? choice : ORIGINAL
  }

  private pushCaption(r: Routed): void {
    if (r) this.d.overlay.push({ type: r.kind, text: r.text })
  }

  /** Sends the band's look (local settings + the on-air session's watermark) to the overlay. */
  private pushStyle(): void {
    const s = this.d.settings.get()
    const cfg = this.d.watermarkConfig?.()
    const qr = { ...DEFAULT_QR, ...s.qr }
    this.d.overlay.push({
      type: 'style',
      visible: s.subtitlesVisible !== false,
      fontSize: subtitleFontSize(s),
      watermark: this.watermark ?? resolveWatermark(undefined, cfg),
      qr: this.qrCache && qr.display ? { svg: this.qrCache.svg, ...qr } : null
    })
  }

  /** The transcript goes through its own event: no LiveState round trip per partial. */
  private sendTranscript(u: TranscriptUpdate | null): void {
    if (u) this.emit('transcript', u)
  }

  private dropController(): void {
    this.stopWatchdog()
    this.monitor?.stop()
    this.monitor = null
    if (this.state.videoOnAir) this.setState({ videoOnAir: undefined })
    this.unsubs.forEach((u) => u())
    this.unsubs = []
    this.ctl = null
    this.attachedConn = null
    this.streamRunning = false
    // The output died with that OBS run: do not keep showing an active stream (attach's applyShow restarts it).
    if (this.state.phase === 'live' && this.current?.service && (this.state.stream === 'active' || this.state.stream === 'error')) {
      this.setState({ stream: 'starting' })
    }
    this.retryAttempt = 0
    this.clearRetry()
    this.stopPreview()
    this.flushStopWaiters()
    this.flushRecordStopWaiters()
    this.clearRecordTimer()
    this.recordAnnouncePending = false // that OBS run will not report it any more
    if (this.state.output !== 'off') this.setState({ output: 'off' })
    // The OBS run that recorded is gone: attach starts a new file if the show is still recorded.
    if (this.state.recording !== 'off') this.setState({ recording: 'off' })
  }

  /** (Re)connects to a freshly started OBS and re-applies devices, overlay and — if live — the show. */
  private async attach(conn: ObsConnection): Promise<void> {
    if (this.ctl && this.attachedConn === conn) return // already attached directly by doStart
    const old = this.ctl
    this.dropController()
    await old?.disconnect().catch(() => {})
    let c: LiveObsController | null = null
    try {
      c = await this.d.controllerFactory(conn)
      c.resetProjectorState() // R4: a new OBS run has new scene item ids
      await c.ensureScene(this.d.platform)
    } catch (e) {
      await c?.disconnect().catch(() => {})
      // No OBS output to restart the stream on: say so instead of leaving a 'starting' stream hanging.
      const lostStream = this.state.phase === 'live' && !!this.current?.service
      this.setState({ obs: 'down', ...(lostStream ? { stream: 'error' as const } : {}), warning: MSG_OBS_SETUP_FAILED + errMsg(e) })
      return
    }
    const ready = c
    this.unsubs.push(
      ready.audioLevel$((db) => {
        if (this.windowVisible) this.emit('audio-level', db)
      })
    )
    this.unsubs.push(ready.streamState$((s) => this.onStreamState(ready, s)))
    this.unsubs.push(ready.recordState$((s) => this.onRecordState(ready, s)))
    this.ctl = ready
    this.attachedConn = conn
    this.startWatchdog(ready)
    const s = this.d.settings.get()
    let warning: string | undefined
    let sourceWarning: string | undefined
    await ready.setSource('primary', s.primarySource ?? NO_SOURCE).catch((e) => (sourceWarning = MSG_PRIMARY_FAILED + errMsg(e)))
    const backupSet = await ready.setSource('backup', s.backupSource ?? NO_SOURCE).then(() => true, () => false)
    this.syncMonitor(ready, backupSet)
    if (s.audioDeviceId) await ready.setAudioDevice(s.audioDeviceId).catch(() => {})
    if (this.overlayUrl) await ready.setOverlayUrl(this.overlayUrl).catch((e) => (warning = MSG_OVERLAY_FAILED + errMsg(e)))
    const w0 = this.state.warning
    const staleObsWarning = w0 === MSG_OBS_DOWN || w0 === MSG_BOOT_FAILED || w0?.startsWith(MSG_OBS_SETUP_FAILED)
      || w0?.startsWith(MSG_PRIMARY_FAILED)
    if (!warning && this.crashRestart) warning = MSG_OBS_RESTARTED
    // A stream/OBS warning matters more (same rule as the recording ones): the source one only takes a free slot.
    if (!warning && sourceWarning && (!w0 || staleObsWarning)) warning = sourceWarning
    this.crashRestart = false
    this.setState({ obs: 'running', ...(warning ? { warning } : staleObsWarning ? { warning: undefined } : {}) })
    this.updatePreview()
    const cur = this.current
    if (this.state.phase === 'live' && cur) {
      await this.applyShow(ready, cur)
      if (this.recordIntent && ready === this.ctl && cur === this.current) await this.startRecordSafe(ready, cur)
    }
  }

  /**
   * Runs the fallback monitor on `c` when a backup source is configured (its start hides the backup);
   * without one (or when it could not be set up: `backupSet` false), hides a backup an earlier OBS run may
   * have left visible.
   */
  private syncMonitor(c: LiveObsController, backupSet = true): void {
    this.monitor?.stop()
    this.monitor = null
    const settings = (): Settings => this.d.settings.get()
    if (!backupSet || (settings().backupSource ?? NO_SOURCE).kind === 'none') {
      c.setBackupVisible(false).catch(() => {})
      if (this.state.videoOnAir) this.setState({ videoOnAir: undefined })
      return
    }
    const m = new FallbackMonitor({
      probe: () => c.probePrimary(),
      decode: (d) => this.d.decodeLuma(d),
      setBackup: (on) => c.setBackupVisible(on),
      blackIsAbsent: () => settings().blackIsAbsent !== false,
      primaryIsFile: () => {
        const k = settings().primarySource?.kind
        return k === 'image' || k === 'video'
      },
      onChange: (onBackup) => {
        if (this.monitor === m) this.setState({ videoOnAir: onBackup ? 'backup' : 'primary' })
      }
    })
    this.monitor = m
    this.setState({ videoOnAir: 'primary' })
    m.start()
  }

  /** Program scene, then the stream. The output window is the user's to open (showOutputWindow). */
  private async applyShow(c: LiveObsController, cur: Current): Promise<void> {
    await c.showLive().catch(() => {})
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

  /** Opens an output window (never throws: a failure becomes a warning). */
  private async openOutput(c: LiveObsController): Promise<void> {
    try {
      await c.openOutputWindow()
      if (c !== this.ctl) return
      const failed = this.state.warning?.startsWith(MSG_OUTPUT_FAILED)
      this.setState({ output: 'shown', ...(failed ? { warning: undefined } : {}) })
    } catch (e) {
      if (c === this.ctl) this.setState({ warning: MSG_OUTPUT_FAILED + errMsg(e) })
    }
  }

  /** obs.start() with backoff (5 attempts). Null when every attempt failed or a newer start/shutdown superseded it. */
  private async startObsWithRetry(gen: number): Promise<ObsConnection | null> {
    for (let attempt = 0; ; attempt++) {
      if (this.shuttingDown || gen !== this.restartGen) return null
      try {
        return await this.d.obs.start()
      } catch {
        if (attempt >= OBS_START_DELAYS_MS.length) return null
        await sleep(OBS_START_DELAYS_MS[attempt])
      }
    }
  }

  /**
   * Runs inside the queue: OBS is down (restarts exhausted, boot or attach failed) — quit whatever is left,
   * start it again with backoff and attach right away (the queued 'ready' then finds it attached).
   */
  private async reviveObs(): Promise<boolean> {
    this.intentionalObsStop = true
    try {
      await this.d.obs.stop().catch(() => {})
    } finally {
      this.intentionalObsStop = false
    }
    this.setState({ obs: 'restarting' })
    const conn = await this.startObsWithRetry(++this.restartGen)
    if (conn) await this.attach(conn)
    if (this.ctl) return true
    this.setState({ obs: 'down', warning: MSG_BOOT_FAILED })
    return false
  }

  private clearRestartedNotice(): void {
    if (this.state.warning === MSG_OBS_RESTARTED) this.setState({ warning: undefined })
  }

  /** Arms/disarms the stale-captions timer from the current caption status. */
  private superviseCaptions(): void {
    if (this.state.phase !== 'live' || this.state.captions === 'live' || this.captionsAuthLost || !this.current) {
      this.clearCaptionsTimer()
      return
    }
    if (this.captionsTimer) return
    this.captionsTimer = setTimeout(() => {
      this.captionsTimer = null
      void this.captionsStale()
    }, CAPTIONS_STALE_MS)
  }

  private async captionsStale(): Promise<void> {
    const cur = this.current
    if (!cur || this.state.phase !== 'live' || this.state.captions === 'live' || this.captionsAuthLost) return
    this.d.overlay.push({ type: 'reset' }) // hide the frozen box; the next caption restores it
    const p = await this.probeSession(cur)
    if (cur !== this.current) return
    switch (p.kind) {
      case 'terminated':
      case 'deleted':
        void this.enqueue(() => this.stopGone(cur, p.kind as 'terminated' | 'deleted')).catch(() => {})
        return
      case 'unauthorized':
        this.d.captions.close() // stop reconnecting with a dead token
        this.reportUnauthorized('captions')
        return
      case 'forbidden':
        this.captionsForbidden()
        return
    }
    this.superviseCaptions() // still not live: probe again later
  }

  /**
   * The caption socket refused us. LinTO says « unauthorized » there for an expired token but also for a
   * session the user can no longer see (removed from the organisation, private session) or a server error:
   * the REST API tells them apart, so a valid login is not thrown away for nothing.
   */
  private async captionsRefused(): Promise<void> {
    const cur = this.current
    if (!cur) return this.reportUnauthorized('captions')
    this.clearCaptionsTimer() // the probe below replaces the stale-captions one
    this.setState({ captions: 'offline' })
    const p = await this.probeSession(cur)
    if (cur !== this.current || this.state.phase !== 'live') return
    switch (p.kind) {
      case 'unauthorized':
      case 'unknown': // LinTO unreachable: the socket's verdict stands
        this.reportUnauthorized('captions')
        return
      case 'terminated':
      case 'deleted':
        void this.enqueue(() => this.stopGone(cur, p.kind as 'terminated' | 'deleted')).catch(() => {})
        return
      case 'forbidden':
        this.captionsForbidden()
        return
      case 'ok':
        // The token is valid and the session readable: a refusal on LinTO's side, join again a bit later.
        this.setState({ warning: MSG_CAPTIONS_REFUSED })
        this.captionsRetryTimer = setTimeout(() => {
          this.captionsRetryTimer = null
          if (cur !== this.current || this.state.phase !== 'live' || this.captionsAuthLost) return
          this.d.captions.open(cur.session.id, cur.channel.id)
        }, CAPTIONS_REFUSED_RETRY_MS)
    }
  }

  /** The user lost access to the session on air: captions cannot come back, the stream goes on. */
  private captionsForbidden(): void {
    this.captionsAuthLost = true // no more probing until the next start
    this.clearCaptionsTimer()
    this.d.captions.close()
    this.setState({ captions: 'offline', warning: MSG_CAPTIONS_FORBIDDEN })
  }

  /** What LinTO says about the session on air (errors other than HTTP refusals → 'unknown'). */
  private async probeSession(cur: Current): Promise<
    | { kind: 'ok'; session: Session } | { kind: 'terminated' | 'deleted' | 'unauthorized' | 'forbidden' | 'unknown' }
  > {
    try {
      const session = await this.d.api.getSession(cur.orgId, cur.session.id)
      return session.status === 'terminated' ? { kind: 'terminated' } : { kind: 'ok', session }
    } catch (e) {
      if (e instanceof UnauthorizedError) return { kind: 'unauthorized' }
      if (e instanceof NotFoundError) return { kind: 'deleted' }
      if (e instanceof ForbiddenError) return { kind: 'forbidden' }
      return { kind: 'unknown' }
    }
  }

  /** Runs inside the queue: the shown session was terminated or deleted elsewhere — end the show and say why. */
  private async stopGone(cur: Current, why: 'terminated' | 'deleted'): Promise<void> {
    if (cur !== this.current) return
    const warning = why === 'terminated' ? msgTerminated(cur.session.name) : msgDeleted(cur.session.name)
    await this.doStop(STOP_WAIT_MS, { phase: 'error', warning })
  }

  private clearCaptionsTimer(): void {
    if (this.captionsTimer) clearTimeout(this.captionsTimer)
    if (this.captionsRetryTimer) clearTimeout(this.captionsRetryTimer)
    this.captionsTimer = null
    this.captionsRetryTimer = null
  }

  private async doStart(rawName: string, gen: number, create?: NewSessionOptions): Promise<StartResult> {
    if (gen !== this.cancelGen) return { ok: false, message: MSG_START_CANCELLED, cancelled: true }
    const s = this.d.settings.get()
    if (!s.orgId) return { ok: false, message: MSG_NO_ORG }
    if (!this.ctl) {
      if (this.state.obs === 'restarting' || this.booting) return { ok: false, message: MSG_OBS_NOT_READY }
      if (!(await this.reviveObs())) return { ok: false, message: MSG_BOOT_FAILED }
    }

    // Resolve first: a failure here must leave a running show (transcript, stream supervision) untouched.
    let res: Awaited<ReturnType<typeof resolveSession>>
    try {
      res = await this.abortable(gen, resolveSession(this.d.api, s.orgId, rawName, s.profileId, create))
    } catch (e) {
      if (e instanceof CancelledError) return { ok: false, message: MSG_START_CANCELLED, cancelled: true }
      if (e instanceof UnauthorizedError) {
        this.reportUnauthorized()
        return { ok: false, message: MSG_AUTH }
      }
      return { ok: false, message: errMsg(e) }
    }
    if (res.kind === 'terminated') return { ok: false, message: msgTerminated(res.name) }

    try {
      this.d.settings.update({ lastSessionName: res.session.name })
      this.setState({ phase: 'starting' })

      // Switching from a previous show: the old stream must be fully stopped before retargeting.
      this.retryAttempt = 0
      this.clearRetry()
      this.clearCaptionsTimer()
      this.captionsAuthLost = false
      this.authLost = false // resolveSession just succeeded: the token is valid
      if (this.current) this.d.captions.close()
      // One file per session: the previous show's recording is closed; this show follows the setting read now.
      await withDeadline(STOP_WAIT_MS, async (limit) => {
        if (this.streamRunning) await this.stopStreamAndWait(limit)
        if (this.recordIntent) await this.stopRecordSafe(limit)
      })
      this.recordIntent = s.recordEnabled === true

      const service = toObsStreamService(res.channel.streamEndpoints ?? {})
      const languages = subtitleLanguageOptions(res.channel)
      const cur: Current = {
        orgId: s.orgId, session: res.session, channel: res.channel, service: res.canStream ? service : null,
        languageChoices: new Set(languages.map((o) => o.value))
      }
      this.current = cur
      this.watermark = resolveWatermark(res.session.meta, this.d.watermarkConfig?.())
      const url = publicLink(s.instance, s.orgId, res.session.id)
      // Failing to draw the QR code must not stop the show: it just stays off.
      this.qrCache = this.qrCache?.url === url ? this.qrCache
        : await this.d.qrSvg(url).then((svg) => ({ url, svg }), () => null)
      this.pushStyle()
      this.d.overlay.push({ type: 'reset' })
      const startedAt = Date.now()
      this.setState({
        phase: 'live',
        session: { name: res.session.name, status: res.session.status, languages },
        stream: cur.service ? 'starting' : 'unavailable',
        warning: cur.service ? undefined : res.blocker === 'rtmp-only' ? MSG_RTMP_ONLY : MSG_NO_STREAM,
        startedAt
      })
      this.sendTranscript(this.transcript.reset(res.session.name, startedAt))
      this.d.captions.open(res.session.id, res.channel.id)

      const c = this.ctl
      if (c) {
        await this.applyShow(c, cur)
        if (this.recordIntent && c === this.ctl && cur === this.current) await this.startRecordSafe(c, cur)
      }
    } catch (e) {
      if (this.state.phase !== 'live') {
        this.setState({ phase: 'error', warning: errMsg(e) })
        return { ok: false, message: errMsg(e) }
      }
      this.setState({ warning: errMsg(e) })
    }
    return { ok: true, reused: res.kind === 'reused', canStream: res.canStream }
  }

  /** `end` overrides the final (idle, no warning) state, e.g. to end in error with a message. */
  private async doStop(streamWaitMs = STOP_WAIT_MS, end: Partial<LiveState> = {}): Promise<void> {
    if (this.state.phase === 'idle' && !this.current) return
    this.setState({ phase: 'stopping' })
    this.retryAttempt = 0
    this.clearRetry()
    this.clearCaptionsTimer()
    this.authLost = false
    this.d.captions.close()
    // One deadline for both: quitting stays within SHUTDOWN_STOP_WAIT_MS.
    await withDeadline(streamWaitMs, async (limit) => {
      await this.stopStreamAndWait(limit)
      if (this.recordIntent) await this.stopRecordSafe(limit)
    })
    this.recordIntent = false
    // The program scene stays on the camera: an open output window keeps showing it (only the captions go).
    this.current = null
    this.watermark = null
    this.qrCache = null
    this.pushStyle()
    this.d.overlay.push({ type: 'reset' })
    this.setState({
      phase: 'idle',
      session: undefined,
      stream: 'off',
      captions: 'offline',
      startedAt: undefined,
      warning: undefined,
      ...end
    })
    this.sendTranscript(this.transcript.endPartial())
  }

  /** Stops the OBS stream and waits (until `limit`) for OBS to report it stopped (StopStream is asynchronous). */
  private async stopStreamAndWait(limit: Promise<void>): Promise<void> {
    const c = this.ctl
    if (!c) return
    if (!this.streamRunning) {
      await Promise.race([c.stopStream().catch(() => {}), limit])
      return
    }
    this.stopRequested = true
    const stopped = Promise.race([new Promise<void>((resolve) => this.stopWaiters.push(resolve)), limit])
    try {
      // false: OBS had no running output (e.g. the SRT connect is still pending) — no 'stopped' will
      // come; if the connect succeeds later, onStreamState stops the unwanted stream.
      const sent = await Promise.race([c.stopStream(), limit.then(() => false)])
      if (sent) await stopped
    } catch {
      /* OBS gone or already stopped */
    } finally {
      this.stopRequested = false
      this.streamRunning = false
    }
  }

  /** Never throws: a failure becomes recording 'error' + a warning, the show goes on. */
  private async startRecordSafe(c: LiveObsController, cur: Current): Promise<void> {
    const dir = this.d.settings.get().recordDir || this.d.defaultRecordDir
    this.clearRecordTimer()
    this.recordAnnouncePending = false // a new file: a stop OBS never reported is not waited for any more
    this.recordAwaiting = true
    try {
      await this.d.mkdirp(dir)
      for (let attempt = 0; ; attempt++) {
        try {
          await c.startRecord(dir, recordBaseName(cur.session.name))
          break
        } catch (e) {
          // The previous file's output is still stopping: it frees up shortly.
          if ((e as { code?: unknown })?.code !== OUTPUT_RUNNING || attempt >= RECORD_RUNNING_RETRIES) throw e
          await sleep(RECORD_RUNNING_RETRY_MS)
          if (c !== this.ctl || cur !== this.current || !this.recordAwaiting) return
        }
      }
    } catch (e) {
      if (c !== this.ctl || cur !== this.current || !this.recordAwaiting) return
      this.recordAwaiting = false
      this.recordFailed(errMsg(e))
      return
    }
    if (!this.recordAwaiting || c !== this.ctl) return // already reported started (or the show moved on)
    this.recordTimer = setTimeout(() => {
      this.recordTimer = null
      if (!this.recordAwaiting || c !== this.ctl || cur !== this.current) return
      this.recordAwaiting = false
      this.recordFailed(MSG_RECORD_NOT_STARTED)
    }, RECORD_START_WAIT_MS)
  }

  /**
   * Stops the recording, announces the file and waits for OBS to report the output stopped (so a new
   * StartRecord is not refused). Never throws, and never waits for OBS past `limit`: Arrêter and session
   * switches must go on whatever happens to the recording.
   */
  private async stopRecordSafe(limit: Promise<void>): Promise<void> {
    this.clearRecordTimer()
    this.recordAwaiting = false
    const c = this.ctl
    if (c) {
      this.recordStopping = true
      const timedOut = Symbol('timed out')
      // Registered before StopRecord: the « stopped » event may come before its answer.
      const stopped = new Promise<void>((resolve) => this.recordStopWaiters.push(resolve))
      try {
        const r = await Promise.race([c.stopRecord(), limit.then(() => timedOut)])
        if (r === timedOut) this.recordAnnouncePending = true
        else if (r) {
          this.emit('recording-saved', r)
          await Promise.race([stopped, limit])
        }
      } catch {
        /* OBS gone or not recording */
      } finally {
        this.recordStopping = false
        this.flushRecordStopWaiters()
      }
    }
    const failed = this.state.warning?.startsWith(MSG_RECORD_FAILED)
    if (this.state.recording !== 'off' || failed) this.setState({ recording: 'off', ...(failed ? { warning: undefined } : {}) })
  }

  /** A stream/OBS warning matters more: it stays, the recording indicator alone tells the failure then. */
  private recordFailed(detail: string): void {
    const w = this.state.warning
    const mayWarn = !w || w.startsWith(MSG_RECORD_FAILED)
    this.setState({ recording: 'error', ...(mayWarn ? { warning: MSG_RECORD_FAILED + detail } : {}) })
  }

  private clearRecordTimer(): void {
    if (this.recordTimer) clearTimeout(this.recordTimer)
    this.recordTimer = null
  }

  private flushRecordStopWaiters(): void {
    const w = this.recordStopWaiters
    this.recordStopWaiters = []
    w.forEach((r) => r())
  }

  private onRecordState(c: LiveObsController, s: { active: boolean; path?: string }): void {
    if (c !== this.ctl) return
    if (!s.active) this.flushRecordStopWaiters()
    if (s.active) {
      this.recordAnnouncePending = false
      this.recordAwaiting = false
      this.clearRecordTimer()
      // Started while no show wants it (e.g. late, after Arrêter): no hidden recording left running.
      if (!this.recordIntent) {
        void c.stopRecord().catch(() => {})
        return
      }
      const failed = this.state.warning?.startsWith(MSG_RECORD_FAILED)
      this.setState({ recording: 'on', ...(failed ? { warning: undefined } : {}) })
      return
    }
    if (this.recordAnnouncePending && !this.recordStopping) {
      // The file of a stopRecord that gave up waiting.
      this.recordAnnouncePending = false
      if (s.path) this.emit('recording-saved', s.path)
      return
    }
    // Our own stopRecord announces the file itself; after it, recording is already 'off'.
    if (this.recordStopping || !this.recordIntent || this.state.recording !== 'on') return
    if (s.path) this.emit('recording-saved', s.path)
    this.recordFailed(MSG_RECORD_STOPPED)
  }

  private flushStopWaiters(): void {
    const w = this.stopWaiters
    this.stopWaiters = []
    w.forEach((r) => r())
  }

  private onStreamState(c: LiveObsController, s: StreamState): void {
    if (c !== this.ctl) return
    const live = this.state.phase === 'live' && !!this.current?.service
    // A stream (re)starting while no show wants one — e.g. an SRT connect that succeeded after Arrêter —
    // must not keep sending the room audio to LinTO.
    const unwanted = this.stopRequested || (this.state.phase !== 'live' && this.state.phase !== 'starting')
    switch (s) {
      case 'starting':
        this.streamRunning = true
        if (unwanted) void c.stopStream().catch(() => {})
        else if (live) this.setState({ stream: 'starting' })
        return
      case 'active':
        this.streamRunning = true
        if (unwanted) {
          void c.stopStream().catch(() => {})
          return
        }
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
      const gen = this.cancelGen
      void this.enqueue(async () => {
        const c = this.ctl
        const cur = this.current
        if (!c || !cur?.service || this.state.phase !== 'live') return
        if (this.retryAttempt >= RETRY_PROBE_FROM) {
          let p: Awaited<ReturnType<LiveController['probeSession']>>
          try {
            p = await this.abortable(gen, this.probeSession(cur))
          } catch {
            return // Arrêter meanwhile: it runs next
          }
          if (p.kind === 'terminated' || p.kind === 'deleted') return this.stopGone(cur, p.kind)
          // LinTO may hand out new stream endpoints (transcriber redeployed): retry on the current ones.
          if (p.kind === 'ok' && cur === this.current) {
            const ch = p.session.channels.find((x) => x.id === cur.channel.id) ?? p.session.channels[0]
            const fresh = ch ? toObsStreamService(ch.streamEndpoints ?? {}) : null
            if (fresh) cur.service = fresh
          }
        }
        if (c !== this.ctl || cur !== this.current || this.state.phase !== 'live' || !cur.service) return
        await this.startStreamSafe(c, cur.service)
      })
    }, delay)
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  /** Polls OBS screenshots only when someone can see them. */
  private updatePreview(): void {
    if (this.ctl && this.previewSubscribed && this.windowVisible) {
      if (!this.previewTimer) this.startPreview()
    } else {
      this.stopPreview()
    }
  }

  private startPreview(): void {
    this.stopPreview()
    this.previewTimer = setInterval(() => {
      const c = this.ctl
      if (!c) return this.stopPreview()
      if (this.previewBusy) return
      this.previewBusy = true
      c.screenshot()
        .then((img) => {
          if (c === this.ctl) this.emit('preview', img)
        })
        .catch(() => {})
        .finally(() => (this.previewBusy = false))
    }, PREVIEW_MS)
  }

  /**
   * Pings OBS while attached. An OBS that hangs without exiting keeps its socket open, so neither the process
   * nor the websocket notices; after WATCHDOG_MISSES unanswered pings it is killed and the crash path restarts it.
   */
  private startWatchdog(c: LiveObsController): void {
    this.stopWatchdog()
    this.watchdogTimer = setInterval(() => {
      if (c !== this.ctl) return this.stopWatchdog()
      if (this.watchdogBusy) return
      this.watchdogBusy = true
      c.ping()
        .then(() => {
          if (c === this.ctl) this.watchdogMisses = 0
        })
        .catch(() => {
          if (c !== this.ctl || this.shuttingDown || this.intentionalObsStop) return
          if (++this.watchdogMisses < WATCHDOG_MISSES) return
          this.stopWatchdog()
          this.setState({ warning: MSG_OBS_HUNG })
          this.d.obs.killHung?.()
        })
        .finally(() => (this.watchdogBusy = false))
    }, WATCHDOG_MS)
    this.watchdogTimer.unref?.()
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer)
    this.watchdogTimer = null
    this.watchdogMisses = 0
  }

  private stopPreview(): void {
    if (this.previewTimer) clearInterval(this.previewTimer)
    this.previewTimer = null
  }
}
