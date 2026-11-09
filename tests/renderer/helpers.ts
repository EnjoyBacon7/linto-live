import { vi } from 'vitest'
import type { LintoLiveApi, SetupData } from '../../src/shared/ipc'

export function makeApi(over: Partial<{ [K in keyof LintoLiveApi]: Partial<LintoLiveApi[K]> }> = {}): LintoLiveApi {
  const setupData: SetupData = {
    settings: { instance: 'https://studio.linto.ai' },
    organizations: [{ id: 'o1', name: 'Org' }],
    profiles: [{ id: 1, name: 'Français' }],
    videoDevices: [{ id: 'v1', name: 'Capture HDMI' }],
    audioDevices: [{ id: 'a1', name: 'Micro' }],
    watermarkEnabled: false
  }
  const api = {
    platform: 'darwin',
    auth: {
      methods: vi.fn().mockResolvedValue([]), loginLocal: vi.fn().mockResolvedValue(undefined),
      loginSso: vi.fn().mockResolvedValue(undefined), logout: vi.fn(), status: vi.fn().mockResolvedValue({ loggedIn: true }),
      ...over.auth
    },
    setup: { load: vi.fn().mockResolvedValue(setupData), save: vi.fn().mockResolvedValue(undefined), ...over.setup },
    sessions: { list: vi.fn().mockResolvedValue([]), setWatermark: vi.fn().mockResolvedValue(undefined), ...over.sessions },
    live: {
      start: vi.fn().mockResolvedValue({ ok: true, reused: false, canStream: true }), stop: vi.fn().mockResolvedValue(undefined),
      terminate: vi.fn().mockResolvedValue(undefined), showOutputWindow: vi.fn().mockResolvedValue(undefined),
      clearSubtitles: vi.fn().mockResolvedValue(undefined),
      getState: vi.fn().mockResolvedValue({ phase: 'idle', stream: 'off', captions: 'offline', obs: 'running', output: 'off' }),
      ...over.live
    },
    app: { uninstall: vi.fn().mockResolvedValue(undefined), reportShellState: vi.fn().mockResolvedValue(undefined), ...over.app },
    on: vi.fn().mockReturnValue(() => {})
  }
  return api as unknown as LintoLiveApi
}

/** Routes `on(evt, cb)` subscriptions (several per event) so a test can `emit` main-process events. */
export function withEvents(api: LintoLiveApi): (evt: string, payload?: unknown) => void {
  const listeners: Record<string, Set<(p: unknown) => void>> = {}
  ;(api as { on: unknown }).on = vi.fn((evt: string, cb: (p: unknown) => void) => {
    ;(listeners[evt] ??= new Set()).add(cb)
    return () => { listeners[evt]?.delete(cb) }
  })
  return (evt, payload) => { for (const cb of [...(listeners[evt] ?? [])]) cb(payload) }
}
