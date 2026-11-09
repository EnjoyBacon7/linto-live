import { vi } from 'vitest'
import type { LintoLiveApi, SetupData } from '../../src/shared/ipc'

export function makeApi(over: Partial<{ [K in keyof LintoLiveApi]: Partial<LintoLiveApi[K]> }> = {}): LintoLiveApi {
  const setupData: SetupData = {
    settings: { instance: 'https://studio.linto.ai' },
    organizations: [{ id: 'o1', name: 'Org' }],
    profiles: [{ id: 1, name: 'Français' }],
    videoDevices: [{ id: 'v1', name: 'Capture HDMI' }],
    audioDevices: [{ id: 'a1', name: 'Micro' }]
  }
  const api = {
    auth: {
      methods: vi.fn().mockResolvedValue([]), loginLocal: vi.fn().mockResolvedValue(undefined),
      loginSso: vi.fn().mockResolvedValue(undefined), logout: vi.fn(), status: vi.fn().mockResolvedValue({ loggedIn: true }),
      ...over.auth
    },
    setup: { load: vi.fn().mockResolvedValue(setupData), save: vi.fn().mockResolvedValue(undefined), ...over.setup },
    live: {
      start: vi.fn().mockResolvedValue({ ok: true, reused: false, canStream: true }), stop: vi.fn().mockResolvedValue(undefined),
      terminate: vi.fn().mockResolvedValue(undefined), showOutputWindow: vi.fn().mockResolvedValue(undefined), ...over.live
    },
    app: { uninstall: vi.fn().mockResolvedValue(undefined), ...over.app },
    on: vi.fn().mockReturnValue(() => {})
  }
  return api as unknown as LintoLiveApi
}
