import type {
  AuthMethod, DeviceItem, SavedLogin, Organization, Session, SessionLookup, SessionStatus, SessionSummary, Settings,
  TranscriberProfile, Transcript, TranscriptExportFormat, TranscriptUpdate, Watermark
} from './types'

export interface SetupData {
  settings: Settings
  organizations: Organization[]
  profiles: TranscriberProfile[]
  videoDevices: DeviceItem[]
  audioDevices: DeviceItem[]
  /** The instance offers the watermark settings (VUE_APP_ENABLE_WATERMARK, as in LinTO Studio). */
  watermarkEnabled: boolean
}

export type StartResult = { ok: true; reused: boolean; canStream: boolean } | { ok: false; message: string }

export interface LiveState {
  phase: 'idle' | 'starting' | 'live' | 'stopping' | 'error'
  session?: { name: string; status: SessionStatus }
  stream: 'off' | 'starting' | 'active' | 'error' | 'unavailable'
  captions: 'connecting' | 'live' | 'offline'
  obs: 'running' | 'restarting' | 'down'
  /** 'shown': an output window was opened during the current OBS run (it stays open, on the camera, after Arrêter). */
  output: 'shown' | 'off'
  /** ms epoch when the current session went live (absent when not live). */
  startedAt?: number
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
  setup: { load(): Promise<SetupData>; save(s: Partial<Settings>): Promise<void> }
  sessions: {
    list(): Promise<SessionSummary[]>
    /** Does a session with exactly this name exist in the organisation, and can the user stream to it? */
    lookup(name: string): Promise<SessionLookup>
    /** Saves the watermark on the LinTO session (as LinTO Studio does); the overlay follows if it is on air. */
    setWatermark(sessionId: string, w: Watermark): Promise<void>
  }
  live: {
    start(sessionName: string): Promise<StartResult>
    stop(): Promise<void>
    terminate(): Promise<void>
    /** Opens (another) OBS output window, even if one is already open. */
    showOutputWindow(): Promise<void>
    /** Empties the subtitle band (« Effacer les sous-titres »). */
    clearSubtitles(): Promise<void>
    /** Current LiveState (the 'live-state' event only carries changes). */
    getState(): Promise<LiveState>
    /** Transcript of the show on air or of the last one (the 'transcript' event only carries changes). */
    getTranscript(): Promise<Transcript>
    /** Saves the finalized transcript where the user picks (save dialog); false if they cancelled. */
    exportTranscript(format: TranscriptExportFormat): Promise<{ saved: boolean }>
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
  on(evt: 'live-state', cb: (s: LiveState) => void): () => void
  /** Camera preview: a JPEG data URL of the OBS program output. */
  on(evt: 'preview', cb: (dataUrl: string) => void): () => void
  on(evt: 'audio-level', cb: (db: number) => void): () => void
  on(evt: 'auth-required', cb: () => void): () => void
  /** Transcript changes; kept out of LiveState (one per partial). */
  on(evt: 'transcript', cb: (u: TranscriptUpdate) => void): () => void
  /** An app menu / tray command the renderer carries out (new-session, start, terminate, logout). */
  on(evt: 'command', cb: (c: AppCommand) => void): () => void
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
  sessionsList: 'sessions:list',
  sessionsLookup: 'sessions:lookup',
  sessionsSetWatermark: 'sessions:set-watermark',
  liveStart: 'live:start',
  liveStop: 'live:stop',
  liveTerminate: 'live:terminate',
  liveShowOutput: 'live:show-output',
  liveGetState: 'live:get-state',
  liveClearSubtitles: 'live:clear-subtitles',
  liveGetTranscript: 'live:get-transcript',
  liveExportTranscript: 'live:export-transcript',
  appUninstall: 'app:uninstall',
  shellState: 'shell:state',
  previewSubscribe: 'preview:subscribe',
  previewUnsubscribe: 'preview:unsubscribe',
  evtLiveState: 'evt:live-state',
  evtPreview: 'evt:preview',
  evtAudioLevel: 'evt:audio-level',
  evtAuthRequired: 'evt:auth-required',
  evtCommand: 'evt:command',
  evtTranscript: 'evt:transcript'
} as const

export type EventName = 'live-state' | 'preview' | 'audio-level' | 'auth-required' | 'command' | 'transcript'

export const EVENT_CHANNELS: Record<EventName, string> = {
  'live-state': IPC.evtLiveState,
  preview: IPC.evtPreview,
  'audio-level': IPC.evtAudioLevel,
  'auth-required': IPC.evtAuthRequired,
  command: IPC.evtCommand,
  transcript: IPC.evtTranscript
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
    setup: { load: () => call(IPC.setupLoad), save: (s) => call(IPC.setupSave, s) },
    sessions: {
      list: () => call(IPC.sessionsList),
      lookup: (name) => call(IPC.sessionsLookup, name),
      setWatermark: (id, w) => call(IPC.sessionsSetWatermark, id, w)
    },
    live: {
      start: (name) => call(IPC.liveStart, name),
      stop: () => call(IPC.liveStop),
      terminate: () => call(IPC.liveTerminate),
      showOutputWindow: () => call(IPC.liveShowOutput),
      clearSubtitles: () => call(IPC.liveClearSubtitles),
      getState: () => call(IPC.liveGetState),
      getTranscript: () => call(IPC.liveGetTranscript),
      exportTranscript: (format) => call(IPC.liveExportTranscript, format)
    },
    app: { uninstall: () => call(IPC.appUninstall), reportShellState: (s) => call(IPC.shellState, s) },
    preview: { subscribe: () => call(IPC.previewSubscribe), unsubscribe: () => call(IPC.previewUnsubscribe) },
    on(evt: EventName, cb: (...a: never[]) => void): () => void {
      const channel = EVENT_CHANNELS[evt]
      const wrapper = (_e: unknown, ...args: unknown[]): void => (cb as (...a: unknown[]) => void)(...args)
      t.on(channel, wrapper)
      return () => t.off(channel, wrapper)
    }
  }
}
