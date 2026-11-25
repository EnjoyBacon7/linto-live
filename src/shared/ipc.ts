import { MIC_GAIN_MAX, MIC_GAIN_MIN } from './types'
import type {
  AuthMethod, CaptureKind, CaptureTargets, DeviceItem, NewSessionOptions, SavedLogin, Organization, Session, SessionLookup, SessionStatus, SessionSummary, Settings,
  MediaAccess, MediaPermission, PermissionsStatus, QrSettings, SubtitleLanguageOption, TranscriberProfile, Transcript, TranscriptExportFormat, TranscriptUpdate, VideoSource, Watermark
} from './types'

export interface SetupData {
  settings: Settings
  organizations: Organization[]
  profiles: TranscriberProfile[]
  videoDevices: DeviceItem[]
  audioDevices: DeviceItem[]
  /** The instance offers the watermark settings (VUE_APP_ENABLE_WATERMARK, as in LinTO Studio). */
  watermarkEnabled: boolean
  /** Where recordings go when Settings.recordDir is not set (the OS videos folder › LinTO Live). */
  defaultRecordDir: string
}

/** `cancelled`: Arrêter came while it waited (nothing to report to the user). */
export type StartResult = { ok: true; reused: boolean; canStream: boolean } | { ok: false; message: string; cancelled?: boolean }

export interface LiveState {
  phase: 'idle' | 'starting' | 'live' | 'stopping' | 'error'
  /** languages: the « Langue affichée » options of the session on air (from the channel LinTO returned). */
  session?: { name: string; status: SessionStatus; languages?: SubtitleLanguageOption[] }
  /** 'following': the session's audio comes from another device, this show only displays its captions. */
  stream: 'off' | 'starting' | 'active' | 'error' | 'unavailable' | 'following'
  captions: 'connecting' | 'live' | 'offline'
  obs: 'running' | 'restarting' | 'down'
  /** 'shown': an output window was opened during the current OBS run (it stays open, on the camera, after Arrêter). */
  output: 'shown' | 'off'
  /** ms epoch when the current session went live (absent when not live). */
  startedAt?: number
  /** Video source shown in OBS; absent when no backup source is configured. */
  videoOnAir?: 'primary' | 'backup'
  /**
   * The show's second OBS output — a recording to a file, or an online broadcast (`recordingTarget`):
   * 'error' when it could not start or stopped by itself (the show goes on).
   */
  recording: 'off' | 'on' | 'error'
  /** What `recording` is about for the show on air (absent when that show has neither). */
  recordingTarget?: 'file' | 'broadcast'
  /** Audio feedback: the micro, as sent to LinTO and recorded, plays on the system output (absent = off). */
  audioMonitor?: boolean
  /** OBS's output offered to the system as a camera (absent = off). */
  virtualCam?: boolean
  /** Why this OBS has no virtual camera at all (absent = it has one, or OBS is not up yet). */
  virtualCamBlocked?: string
  warning?: string
}

export type { Session }

/** Actions of the app menu and the tray icon. */
export type AppCommand =
  | 'new-session' | 'start' | 'stop' | 'terminate' | 'show-output' | 'show-window' | 'logout' | 'uninstall' | 'quit'

/** What the renderer tells main so the menus enable the right items. */
export interface ShellReport {
  loggedIn: boolean
  /** Selected (or on-air) session. */
  sessionName?: string
  /** Démarrer is currently possible (session and micro chosen, nothing in progress). */
  canStart: boolean
  /** The selected session is live on another device: Démarrer reads « Suivre ». */
  follow?: boolean
}

export interface LintoLiveApi {
  /** process.platform of the app ('darwin' | 'linux' …): the sandboxed renderer cannot read it. */
  platform: 'darwin' | 'linux' | (string & {})
  auth: {
    methods(): Promise<AuthMethod[]>
    /** remember: true saves email + password in the OS keychain after a successful login, false forgets them. */
    loginLocal(email: string, pw: string, remember?: boolean): Promise<void>
    /** canRemember is false when the OS has no keychain to protect a password (Linux without a secret service). */
    savedLogin(): Promise<{ canRemember: boolean; login: SavedLogin | null }>
    loginSso(path: string, email?: string): Promise<void>
    logout(): Promise<void>
    status(): Promise<{ loggedIn: boolean }>
  }
  setup: {
    load(): Promise<SetupData>
    save(s: Partial<Settings>): Promise<void>
    /** Lets the user pick an image or a video file (open dialog); its path, or null if they cancelled. */
    pickMedia(kind: 'image' | 'video'): Promise<string | null>
    /** Screens or windows to capture; on macOS, none without the screen recording access (`ok: false`). */
    listCaptureTargets(kind: CaptureKind): Promise<CaptureTargets>
    /** macOS: shows the screen recording prompt when the app never asked; the access now. */
    requestScreenAccess(): Promise<MediaAccess>
    /** Lets the user pick (or create) a folder; its path, or null if they cancelled. */
    pickFolder(): Promise<string | null>
    /**
     * Saves the online broadcast's server and stream key together (the key encrypted, never read back).
     * `key` absent: kept if the server is unchanged, forgotten otherwise; blank: forgotten.
     */
    setBroadcast(server: string, key?: string): Promise<void>
  }
  sessions: {
    list(): Promise<SessionSummary[]>
    /** Does a session with exactly this name exist in the organisation, and can the user stream to it? */
    lookup(name: string): Promise<SessionLookup>
    /** Saves the watermark on the LinTO session (as LinTO Studio does); the overlay follows if it is on air. */
    setWatermark(sessionId: string, w: Watermark): Promise<void>
  }
  live: {
    /**
     * `create`: options of the session created when none has this name (ignored when one is reused).
     * `follow`: the session is sent from another device; show its captions without sending audio.
     */
    start(sessionName: string, create?: NewSessionOptions, follow?: boolean): Promise<StartResult>
    /** Saves the language shown in the subtitle band for this session; the band switches now if it is on air. */
    setSubtitleLanguage(sessionId: string, choice: string): Promise<void>
    stop(): Promise<void>
    terminate(): Promise<void>
    /** Opens (another) OBS output window, even if one is already open. */
    showOutputWindow(): Promise<void>
    /** Audio feedback on/off: hear the micro as OBS sends it to LinTO and records it (not saved). */
    setAudioMonitor(on: boolean): Promise<void>
    /** Virtual camera on/off: other apps see the output (captions included) as a camera (not saved). */
    setVirtualCam(on: boolean): Promise<void>
    /**
     * Clears the on-air session's transcript on LinTO (« Effacer la transcription », as in LinTO Studio): Studio,
     * the subtitle band and the transcript here all empty.
     */
    clearTranscript(): Promise<void>
    /** Current LiveState (the 'live-state' event only carries changes). */
    getState(): Promise<LiveState>
    /** Transcript of the show on air or of the last one (the 'transcript' event only carries changes). */
    getTranscript(): Promise<Transcript>
    /** Off air: loads the selected session's transcript from LinTO (on air: the show's own, unchanged). */
    viewTranscript(sessionId: string): Promise<Transcript>
    /** Saves the finalized transcript where the user picks (save dialog); false if they cancelled. */
    exportTranscript(format: TranscriptExportFormat): Promise<{ saved: boolean }>
  }
  /** First-launch page (macOS camera and microphone, Linux system checks, notifications). */
  permissions: {
    status(): Promise<PermissionsStatus>
    /** Shows the system prompt when the user was never asked; the access now. */
    request(kind: MediaPermission): Promise<MediaAccess>
    /** Opens the system settings pane of this permission (to grant one that was refused). */
    openSettings(kind: MediaPermission | 'notifications' | 'screen'): Promise<void>
    /** Shows a notification (macOS asks for the notification permission at the first one). */
    testNotification(): Promise<void>
    /** The page is done: never shown again, OBS starts if it was waiting for it. */
    finish(): Promise<void>
  }
  app: {
    uninstall(): Promise<void>
    reportShellState(s: ShellReport): Promise<void>
  }
  /** The 'preview' event only flows while subscribed (and the window is visible): OBS screenshots cost CPU. */
  preview: {
    subscribe(): Promise<void>
    unsubscribe(): Promise<void>
  }
  /** Borderless, always-on-top window showing only the subtitle band. */
  subtitles: {
    /** Opens it, or closes it when open; whether it is open now. Rejects before the subtitle server is up. */
    toggle(): Promise<boolean>
    isOpen(): Promise<boolean>
  }
  on(evt: 'live-state', cb: (s: LiveState) => void): () => void
  /** Camera preview: a JPEG data URL of the OBS program output. */
  on(evt: 'preview', cb: (dataUrl: string) => void): () => void
  on(evt: 'audio-level', cb: (db: number) => void): () => void
  on(evt: 'auth-required', cb: () => void): () => void
  /** Transcript changes; kept out of LiveState (one per partial). */
  on(evt: 'transcript', cb: (u: TranscriptUpdate) => void): () => void
  /** An app menu / tray command the renderer carries out (new-session, start, terminate, logout). */
  on(evt: 'command', cb: (c: AppCommand) => void): () => void
  /** The subtitle window opened or closed (also by its own × or Esc). */
  on(evt: 'subtitles-window', cb: (open: boolean) => void): () => void
}

export const IPC = {
  authMethods: 'auth:methods',
  authLoginLocal: 'auth:login-local',
  authLoginSso: 'auth:login-sso',
  authLogout: 'auth:logout',
  authStatus: 'auth:status',
  authSavedLogin: 'auth:saved-login',
  setupLoad: 'setup:load',
  setupSave: 'setup:save',
  setupPickMedia: 'setup:pick-media',
  setupPickFolder: 'setup:pick-folder',
  setupListCapture: 'setup:list-capture',
  setupRequestScreenAccess: 'setup:request-screen-access',
  setupSetBroadcast: 'setup:set-broadcast',
  sessionsList: 'sessions:list',
  sessionsLookup: 'sessions:lookup',
  sessionsSetWatermark: 'sessions:set-watermark',
  liveStart: 'live:start',
  liveStop: 'live:stop',
  liveTerminate: 'live:terminate',
  liveShowOutput: 'live:show-output',
  liveGetState: 'live:get-state',
  liveClearTranscript: 'live:clear-transcript',
  liveGetTranscript: 'live:get-transcript',
  liveViewTranscript: 'live:view-transcript',
  liveExportTranscript: 'live:export-transcript',
  liveSetSubtitleLanguage: 'live:set-subtitle-language',
  liveSetAudioMonitor: 'live:set-audio-monitor',
  liveSetVirtualCam: 'live:set-virtual-cam',
  permissionsStatus: 'permissions:status',
  permissionsRequest: 'permissions:request',
  permissionsOpenSettings: 'permissions:open-settings',
  permissionsTestNotification: 'permissions:test-notification',
  permissionsFinish: 'permissions:finish',
  appUninstall: 'app:uninstall',
  shellState: 'shell:state',
  previewSubscribe: 'preview:subscribe',
  previewUnsubscribe: 'preview:unsubscribe',
  subtitlesToggle: 'subtitles:toggle',
  subtitlesIsOpen: 'subtitles:is-open',
  evtLiveState: 'evt:live-state',
  evtPreview: 'evt:preview',
  evtAudioLevel: 'evt:audio-level',
  evtAuthRequired: 'evt:auth-required',
  evtCommand: 'evt:command',
  evtTranscript: 'evt:transcript',
  evtSubtitlesWindow: 'evt:subtitles-window'
} as const

export type EventName = 'live-state' | 'preview' | 'audio-level' | 'auth-required' | 'command' | 'transcript' | 'subtitles-window'

export const EVENT_CHANNELS: Record<EventName, string> = {
  'live-state': IPC.evtLiveState,
  preview: IPC.evtPreview,
  'audio-level': IPC.evtAudioLevel,
  'auth-required': IPC.evtAuthRequired,
  command: IPC.evtCommand,
  transcript: IPC.evtTranscript,
  'subtitles-window': IPC.evtSubtitlesWindow
}

const VISIBILITIES: readonly unknown[] = ['private', 'organization', 'public', 'password'] satisfies NewSessionOptions['visibility'][]

/** Main-side check of `live.start`'s `create` argument (it comes from the renderer); throws when malformed. */
export function checkNewSessionOptions(raw: unknown): NewSessionOptions | undefined {
  if (raw === undefined) return undefined
  const bad = (): never => { throw new Error('Options de session invalides.') }
  if (typeof raw !== 'object' || raw === null) return bad()
  const o = raw as Record<string, unknown>
  if (!Array.isArray(o.translations) || !o.translations.every((t) => typeof t === 'string')) return bad()
  if (!VISIBILITIES.includes(o.visibility)) return bad()
  const visibility = o.visibility as NewSessionOptions['visibility']
  const out: NewSessionOptions = { translations: [...(o.translations as string[])], visibility }
  if (visibility === 'password') {
    if (typeof o.password !== 'string' || !o.password) return bad()
    out.password = o.password
  }
  return out
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0
/** macOS and Linux only: an absolute path starts with « / ». */
const absolute = (v: unknown): v is string => nonEmpty(v) && v.startsWith('/')
const positive = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v > 0

function isVideoSource(v: unknown): v is VideoSource {
  if (!isObj(v)) return false
  if (v.kind === 'none') return true
  if (v.kind === 'device') return nonEmpty(v.id)
  if (v.kind === 'screen' || v.kind === 'window') return nonEmpty(v.id) && typeof v.name === 'string' && v.name.length <= 500
  return (v.kind === 'image' || v.kind === 'video') && absolute(v.path)
}

const isQr = (v: unknown): v is QrSettings =>
  isObj(v) && typeof v.display === 'boolean' && typeof v.pinned === 'boolean' && positive(v.frequency) && positive(v.duration)

/**
 * Main-side check of `setup.save`'s patch (it comes from the renderer); throws when malformed. The
 * per-session subtitle languages are not writable this way (live.setSubtitleLanguage is).
 */
export function checkSettingsPatch(raw: unknown): Partial<Settings> {
  const bad = (): never => { throw new Error('Réglages invalides.') }
  if (!isObj(raw)) return bad()
  // The broadcast server goes with its key (setup.setBroadcast), never alone.
  if ('subtitleLanguages' in raw || 'broadcastKeySet' in raw || 'broadcastServer' in raw) return bad()
  // Set by permissions.finish only.
  if ('permissionsOnboarded' in raw) return bad()
  if ('primarySource' in raw && !isVideoSource(raw.primarySource)) return bad()
  if ('backupSource' in raw && !isVideoSource(raw.backupSource)) return bad()
  if ('recordDir' in raw && !absolute(raw.recordDir)) return bad()
  if ('qr' in raw && !isQr(raw.qr)) return bad()
  if ('properNouns' in raw) {
    const v = raw.properNouns
    if (!Array.isArray(v) || v.length > 1000 || !v.every((n) => typeof n === 'string' && n.length <= 200)) return bad()
  }
  if ('subtitlePosition' in raw) {
    const v = raw.subtitlePosition
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) return bad()
  }
  if ('micGainDb' in raw) {
    const v = raw.micGainDb
    if (typeof v !== 'number' || !Number.isFinite(v) || v < MIC_GAIN_MIN || v > MIC_GAIN_MAX) return bad()
  }
  for (const k of ['blackIsAbsent', 'recordEnabled', 'properNounsEnabled', 'broadcastEnabled'] as const) if (k in raw && typeof raw[k] !== 'boolean') return bad()
  return raw as Partial<Settings>
}

/** Minimal transport (ipcRenderer-shaped) so the bridge is testable without Electron. */
export interface Transport {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void
  off(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void
}

export function createLintoLiveApi(t: Transport, platform: string): LintoLiveApi {
  const call = <T>(channel: string, ...args: unknown[]): Promise<T> => t.invoke(channel, ...args) as Promise<T>
  return {
    platform,
    auth: {
      methods: () => call(IPC.authMethods),
      loginLocal: (email, pw, remember) =>
        (remember === undefined ? call(IPC.authLoginLocal, email, pw) : call(IPC.authLoginLocal, email, pw, remember)),
      savedLogin: () => call(IPC.authSavedLogin),
      loginSso: (path, email) => (email === undefined ? call(IPC.authLoginSso, path) : call(IPC.authLoginSso, path, email)),
      logout: () => call(IPC.authLogout),
      status: () => call(IPC.authStatus)
    },
    setup: {
      load: () => call(IPC.setupLoad),
      save: (s) => call(IPC.setupSave, s),
      pickMedia: (kind) => call(IPC.setupPickMedia, kind),
      pickFolder: () => call(IPC.setupPickFolder),
      listCaptureTargets: (kind) => call(IPC.setupListCapture, kind),
      requestScreenAccess: () => call(IPC.setupRequestScreenAccess),
      setBroadcast: (server, key) => (key === undefined ? call(IPC.setupSetBroadcast, server) : call(IPC.setupSetBroadcast, server, key))
    },
    sessions: {
      list: () => call(IPC.sessionsList),
      lookup: (name) => call(IPC.sessionsLookup, name),
      setWatermark: (id, w) => call(IPC.sessionsSetWatermark, id, w)
    },
    live: {
      start: (name, create, follow) => (follow ? call(IPC.liveStart, name, create, true)
        : create === undefined ? call(IPC.liveStart, name) : call(IPC.liveStart, name, create)),
      setSubtitleLanguage: (id, choice) => call(IPC.liveSetSubtitleLanguage, id, choice),
      stop: () => call(IPC.liveStop),
      terminate: () => call(IPC.liveTerminate),
      showOutputWindow: () => call(IPC.liveShowOutput),
      setAudioMonitor: (on) => call(IPC.liveSetAudioMonitor, on),
      setVirtualCam: (on) => call(IPC.liveSetVirtualCam, on),
      clearTranscript: () => call(IPC.liveClearTranscript),
      getState: () => call(IPC.liveGetState),
      getTranscript: () => call(IPC.liveGetTranscript),
      viewTranscript: (sessionId) => call(IPC.liveViewTranscript, sessionId),
      exportTranscript: (format) => call(IPC.liveExportTranscript, format)
    },
    permissions: {
      status: () => call(IPC.permissionsStatus),
      request: (kind) => call(IPC.permissionsRequest, kind),
      openSettings: (kind) => call(IPC.permissionsOpenSettings, kind),
      testNotification: () => call(IPC.permissionsTestNotification),
      finish: () => call(IPC.permissionsFinish)
    },
    app: { uninstall: () => call(IPC.appUninstall), reportShellState: (s) => call(IPC.shellState, s) },
    preview: { subscribe: () => call(IPC.previewSubscribe), unsubscribe: () => call(IPC.previewUnsubscribe) },
    subtitles: { toggle: () => call(IPC.subtitlesToggle), isOpen: () => call(IPC.subtitlesIsOpen) },
    on(evt: EventName, cb: (...a: never[]) => void): () => void {
      const channel = EVENT_CHANNELS[evt]
      const wrapper = (_e: unknown, ...args: unknown[]): void => (cb as (...a: unknown[]) => void)(...args)
      t.on(channel, wrapper)
      return () => t.off(channel, wrapper)
    }
  }
}
