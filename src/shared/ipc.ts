import type {
  AuthMethod, DeviceItem, Organization, Session, SessionStatus, SessionSummary, Settings,
  TranscriberProfile
} from './types'

export interface SetupData {
  settings: Settings
  organizations: Organization[]
  profiles: TranscriberProfile[]
  videoDevices: DeviceItem[]
  audioDevices: DeviceItem[]
}

export type StartResult = { ok: true; reused: boolean; canStream: boolean } | { ok: false; message: string }

export interface LiveState {
  phase: 'idle' | 'starting' | 'live' | 'stopping' | 'error'
  session?: { name: string; status: SessionStatus }
  stream: 'off' | 'starting' | 'active' | 'error' | 'unavailable'
  captions: 'connecting' | 'live' | 'offline'
  obs: 'running' | 'restarting' | 'down'
  /** 'shown': an output window was opened during the current OBS run (it stays open, black, after Arrêter). */
  output: 'shown' | 'off'
  /** ms epoch when the current session went live (absent when not live). */
  startedAt?: number
  lastLine?: string
  warning?: string
}

export type { Session }

export interface LintoLiveApi {
  /** process.platform of the app ('darwin' | 'linux' …): the sandboxed renderer cannot read it. */
  platform: 'darwin' | 'linux' | (string & {})
  auth: {
    methods(): Promise<AuthMethod[]>
    loginLocal(email: string, pw: string): Promise<void>
    loginSso(path: string, email?: string): Promise<void>
    logout(): Promise<void>
    status(): Promise<{ loggedIn: boolean }>
  }
  setup: { load(): Promise<SetupData>; save(s: Partial<Settings>): Promise<void> }
  sessions: { list(): Promise<SessionSummary[]> }
  live: {
    start(sessionName: string): Promise<StartResult>
    stop(): Promise<void>
    terminate(): Promise<void>
    /** Opens (another) OBS output window, even if one is already open. */
    showOutputWindow(): Promise<void>
  }
  app: { uninstall(): Promise<void> }
  on(evt: 'live-state', cb: (s: LiveState) => void): () => void
  on(evt: 'preview', cb: (dataUrl: string) => void): () => void
  on(evt: 'audio-level', cb: (db: number) => void): () => void
  on(evt: 'auth-required', cb: () => void): () => void
}

export const IPC = {
  authMethods: 'auth:methods',
  authLoginLocal: 'auth:login-local',
  authLoginSso: 'auth:login-sso',
  authLogout: 'auth:logout',
  authStatus: 'auth:status',
  setupLoad: 'setup:load',
  setupSave: 'setup:save',
  sessionsList: 'sessions:list',
  liveStart: 'live:start',
  liveStop: 'live:stop',
  liveTerminate: 'live:terminate',
  liveShowOutput: 'live:show-output',
  appUninstall: 'app:uninstall',
  evtLiveState: 'evt:live-state',
  evtPreview: 'evt:preview',
  evtAudioLevel: 'evt:audio-level',
  evtAuthRequired: 'evt:auth-required'
} as const

export type EventName = 'live-state' | 'preview' | 'audio-level' | 'auth-required'

export const EVENT_CHANNELS: Record<EventName, string> = {
  'live-state': IPC.evtLiveState,
  preview: IPC.evtPreview,
  'audio-level': IPC.evtAudioLevel,
  'auth-required': IPC.evtAuthRequired
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
      loginLocal: (email, pw) => call(IPC.authLoginLocal, email, pw),
      loginSso: (path, email) => (email === undefined ? call(IPC.authLoginSso, path) : call(IPC.authLoginSso, path, email)),
      logout: () => call(IPC.authLogout),
      status: () => call(IPC.authStatus)
    },
    setup: { load: () => call(IPC.setupLoad), save: (s) => call(IPC.setupSave, s) },
    sessions: { list: () => call(IPC.sessionsList) },
    live: {
      start: (name) => call(IPC.liveStart, name),
      stop: () => call(IPC.liveStop),
      terminate: () => call(IPC.liveTerminate),
      showOutputWindow: () => call(IPC.liveShowOutput)
    },
    app: { uninstall: () => call(IPC.appUninstall) },
    on(evt: EventName, cb: (...a: never[]) => void): () => void {
      const channel = EVENT_CHANNELS[evt]
      const wrapper = (_e: unknown, ...args: unknown[]): void => (cb as (...a: unknown[]) => void)(...args)
      t.on(channel, wrapper)
      return () => t.off(channel, wrapper)
    }
  }
}
