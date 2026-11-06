import type {
  AuthMethod, DeviceItem, MonitorInfo, Organization, SavedDisplay, Session, SessionStatus, Settings,
  TranscriberProfile
} from './types'

export interface SetupData {
  settings: Settings
  organizations: Organization[]
  profiles: TranscriberProfile[]
  videoDevices: DeviceItem[]
  audioDevices: DeviceItem[]
  displays: MonitorInfo[]
}

export type StartResult = { ok: true; reused: boolean; canStream: boolean } | { ok: false; message: string }

export interface LiveState {
  phase: 'idle' | 'starting' | 'live' | 'stopping' | 'error'
  session?: { name: string; status: SessionStatus }
  stream: 'off' | 'starting' | 'active' | 'error' | 'unavailable'
  captions: 'connecting' | 'live' | 'offline'
  obs: 'running' | 'restarting' | 'down'
  output: 'shown' | 'display-missing' | 'off'
  lastLine?: string
  warning?: string
}

export type { Session }

export interface LintoLiveApi {
  auth: {
    methods(): Promise<AuthMethod[]>
    loginLocal(email: string, pw: string): Promise<void>
    loginSso(path: string, email?: string): Promise<void>
    logout(): Promise<void>
    status(): Promise<{ loggedIn: boolean }>
  }
  setup: { load(): Promise<SetupData>; save(s: Partial<Settings>): Promise<void> }
  live: {
    start(sessionName: string): Promise<StartResult>
    stop(): Promise<void>
    terminate(): Promise<void>
    changeDisplay(d: SavedDisplay): Promise<void>
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
  liveStart: 'live:start',
  liveStop: 'live:stop',
  liveTerminate: 'live:terminate',
  liveChangeDisplay: 'live:change-display',
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

export function createLintoLiveApi(t: Transport): LintoLiveApi {
  const call = <T>(channel: string, ...args: unknown[]): Promise<T> => t.invoke(channel, ...args) as Promise<T>
  return {
    auth: {
      methods: () => call(IPC.authMethods),
      loginLocal: (email, pw) => call(IPC.authLoginLocal, email, pw),
      loginSso: (path, email) => (email === undefined ? call(IPC.authLoginSso, path) : call(IPC.authLoginSso, path, email)),
      logout: () => call(IPC.authLogout),
      status: () => call(IPC.authStatus)
    },
    setup: { load: () => call(IPC.setupLoad), save: (s) => call(IPC.setupSave, s) },
    live: {
      start: (name) => call(IPC.liveStart, name),
      stop: () => call(IPC.liveStop),
      terminate: () => call(IPC.liveTerminate),
      changeDisplay: (d) => call(IPC.liveChangeDisplay, d)
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
