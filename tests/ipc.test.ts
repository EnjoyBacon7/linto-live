import { describe, it, expect, expectTypeOf, vi } from 'vitest'
import { EVENT_CHANNELS, IPC, createLintoLiveApi, type LintoLiveApi, type Transport } from '../src/shared/ipc'

describe('IPC constants', () => {
  it('values are unique', () => {
    const v = Object.values(IPC)
    expect(new Set(v).size).toBe(v.length)
    expect(new Set(Object.keys(IPC)).size).toBe(Object.keys(IPC).length)
  })
  it('covers every api method and event', () => {
    const keys = Object.keys(IPC).sort()
    expect(keys).toEqual(
      [
        'authMethods', 'authLoginLocal', 'authLoginSso', 'authLogout', 'authStatus', 'authSavedLogin',
        'setupLoad', 'setupSave', 'sessionsList', 'sessionsLookup', 'sessionsSetWatermark', 'liveStart', 'liveStop', 'liveTerminate', 'liveShowOutput', 'liveGetState', 'liveClearSubtitles',
        'appUninstall', 'shellState', 'evtLiveState', 'evtAudioLevel', 'evtAuthRequired', 'evtCommand', 'evtTranscript',
        'liveGetTranscript', 'liveExportTranscript'
      ].sort()
    )
  })
  it('api shape (type-level)', () => {
    expectTypeOf<LintoLiveApi['auth']['methods']>().returns.resolves.toBeArray()
    expectTypeOf<LintoLiveApi['live']['start']>().parameter(0).toBeString()
    expectTypeOf<LintoLiveApi['setup']['load']>().returns.resolves.not.toHaveProperty('displays')
    expectTypeOf<LintoLiveApi['live']['showOutputWindow']>().returns.resolves.toBeVoid()
    expectTypeOf<LintoLiveApi['live']['getState']>().returns.resolves.toHaveProperty('phase')
  })
})

function fake() {
  const invoke = vi.fn(async (_c: string, ..._a: unknown[]) => undefined as unknown)
  const on = vi.fn()
  const off = vi.fn()
  const t: Transport = { invoke, on, off }
  return { invoke, on, off, api: createLintoLiveApi(t, 'darwin') }
}

it('sessions channel', () => { expect(IPC.sessionsList).toBe('sessions:list') })
it('command event channel', () => {
  expect(IPC.evtCommand).toBe('evt:command')
  expect(EVENT_CHANNELS.command).toBe('evt:command')
})

describe('createLintoLiveApi', () => {
  it('methods invoke the right channel with args', async () => {
    const { api, invoke } = fake()
    await api.auth.methods()
    await api.auth.loginLocal('a@b', 'pw')
    await api.auth.loginLocal('a@b', 'pw', true)
    await api.auth.savedLogin()
    await api.auth.loginSso('/p', 'e')
    await api.auth.logout()
    await api.auth.status()
    await api.setup.load()
    await api.setup.save({ instance: 'i' })
    await api.sessions.list()
    await api.sessions.lookup('S')
    await api.live.start('S')
    await api.live.stop()
    await api.live.terminate()
    await api.live.showOutputWindow()
    await api.live.getState()
    await api.live.getTranscript()
    await api.live.exportTranscript('srt')
    await api.app.uninstall()
    await api.app.reportShellState({ loggedIn: true, sessionName: 'S', canStart: true })
    expect(invoke.mock.calls).toEqual([
      [IPC.authMethods],
      [IPC.authLoginLocal, 'a@b', 'pw'],
      [IPC.authLoginLocal, 'a@b', 'pw', true],
      ['auth:saved-login'],
      [IPC.authLoginSso, '/p', 'e'],
      [IPC.authLogout],
      [IPC.authStatus],
      [IPC.setupLoad],
      [IPC.setupSave, { instance: 'i' }],
      [IPC.sessionsList],
      ['sessions:lookup', 'S'],
      [IPC.liveStart, 'S'],
      [IPC.liveStop],
      [IPC.liveTerminate],
      ['live:show-output'],
      ['live:get-state'],
      ['live:get-transcript'],
      ['live:export-transcript', 'srt'],
      [IPC.appUninstall],
      ['shell:state', { loggedIn: true, sessionName: 'S', canStart: true }]
    ])
  })
  it('passes the platform through', () => {
    const t: Transport = { invoke: vi.fn(), on: vi.fn(), off: vi.fn() }
    expect(createLintoLiveApi(t, 'darwin').platform).toBe('darwin')
    expect(createLintoLiveApi(t, 'linux').platform).toBe('linux')
  })
  it('returns invoke result', async () => {
    const { api, invoke } = fake()
    invoke.mockResolvedValueOnce({ loggedIn: true })
    expect(await api.auth.status()).toEqual({ loggedIn: true })
  })
  it('on() subscribes with mapped channel, strips event arg, and unsubscribes same wrapper', () => {
    const { api, on, off } = fake()
    const cb = vi.fn()
    const un = api.on('audio-level', cb)
    expect(on).toHaveBeenCalledWith(IPC.evtAudioLevel, expect.any(Function))
    const wrapper = on.mock.calls[0][1] as (...a: unknown[]) => void
    wrapper({ sender: 1 }, -12)
    expect(cb).toHaveBeenCalledWith(-12)
    un()
    expect(off).toHaveBeenCalledWith(IPC.evtAudioLevel, wrapper)
  })
  it('maps every event name', () => {
    const { api, on } = fake()
    api.on('live-state', () => {})
    api.on('auth-required', () => {})
    api.on('transcript', () => {})
    expect(on.mock.calls.map((c) => c[0])).toEqual([IPC.evtLiveState, IPC.evtAuthRequired, IPC.evtTranscript])
  })
})
