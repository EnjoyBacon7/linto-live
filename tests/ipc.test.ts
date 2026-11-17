import { describe, it, expect, expectTypeOf, vi } from 'vitest'
import { EVENT_CHANNELS, IPC, checkNewSessionOptions, checkSettingsPatch, createLintoLiveApi, type LintoLiveApi, type Transport } from '../src/shared/ipc'

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
        'setupLoad', 'setupSave', 'setupPickMedia', 'setupPickFolder', 'sessionsList', 'sessionsLookup', 'sessionsSetWatermark', 'liveStart', 'liveStop', 'liveTerminate', 'liveShowOutput', 'liveGetState', 'liveClearTranscript',
        'appUninstall', 'shellState', 'evtLiveState', 'evtAudioLevel', 'evtAuthRequired', 'evtCommand', 'evtTranscript',
        'liveGetTranscript', 'liveExportTranscript', 'liveSetSubtitleLanguage', 'evtPreview', 'previewSubscribe', 'previewUnsubscribe',
        'liveSetAudioMonitor', 'setupSetBroadcastKey'
      ].sort()
    )
  })
  it('api shape (type-level)', () => {
    expectTypeOf<LintoLiveApi['auth']['methods']>().returns.resolves.toBeArray()
    expectTypeOf<LintoLiveApi['live']['start']>().parameter(0).toBeString()
    expectTypeOf<LintoLiveApi['setup']['load']>().returns.resolves.not.toHaveProperty('displays')
    expectTypeOf<LintoLiveApi['live']['showOutputWindow']>().returns.resolves.toBeVoid()
    expectTypeOf<LintoLiveApi['setup']['pickMedia']>().parameter(0).toEqualTypeOf<'image' | 'video'>()
    expectTypeOf<LintoLiveApi['setup']['pickMedia']>().returns.resolves.toEqualTypeOf<string | null>()
    expectTypeOf<LintoLiveApi['setup']['pickFolder']>().returns.resolves.toEqualTypeOf<string | null>()
    expectTypeOf<LintoLiveApi['live']['getState']>().returns.resolves.toHaveProperty('recording')
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
    await api.setup.pickMedia('image')
    await api.setup.pickFolder()
    await api.sessions.list()
    await api.sessions.lookup('S')
    await api.live.start('S')
    await api.live.start('S', { translations: ['en'], visibility: 'public' })
    await api.live.setSubtitleLanguage('s1', 'en')
    await api.live.stop()
    await api.live.terminate()
    await api.live.showOutputWindow()
    await api.live.setAudioMonitor(true)
    await api.live.getState()
    await api.live.getTranscript()
    await api.live.exportTranscript('srt')
    await api.app.uninstall()
    await api.app.reportShellState({ loggedIn: true, sessionName: 'S', canStart: true })
    await api.preview.subscribe()
    await api.preview.unsubscribe()
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
      ['setup:pick-media', 'image'],
      ['setup:pick-folder'],
      [IPC.sessionsList],
      ['sessions:lookup', 'S'],
      [IPC.liveStart, 'S'],
      [IPC.liveStart, 'S', { translations: ['en'], visibility: 'public' }],
      ['live:set-subtitle-language', 's1', 'en'],
      [IPC.liveStop],
      [IPC.liveTerminate],
      ['live:show-output'],
      ['live:set-audio-monitor', true],
      ['live:get-state'],
      ['live:get-transcript'],
      ['live:export-transcript', 'srt'],
      [IPC.appUninstall],
      ['shell:state', { loggedIn: true, sessionName: 'S', canStart: true }],
      ['preview:subscribe'],
      ['preview:unsubscribe']
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
    api.on('preview', () => {})
    api.on('auth-required', () => {})
    api.on('transcript', () => {})
    expect(on.mock.calls.map((c) => c[0])).toEqual([IPC.evtLiveState, IPC.evtPreview, IPC.evtAuthRequired, IPC.evtTranscript])
  })
})

describe('checkNewSessionOptions (live.start create options)', () => {
  it('accepts absent options and valid ones', () => {
    expect(checkNewSessionOptions(undefined)).toBeUndefined()
    expect(checkNewSessionOptions({ translations: ['en'], visibility: 'public' })).toEqual({ translations: ['en'], visibility: 'public' })
    expect(checkNewSessionOptions({ translations: [], visibility: 'password', password: 'secret' }))
      .toEqual({ translations: [], visibility: 'password', password: 'secret' })
  })
  it('rejects invalid options', () => {
    expect(() => checkNewSessionOptions({ translations: [], visibility: 'x' })).toThrow()
    expect(() => checkNewSessionOptions({ translations: 'en', visibility: 'public' })).toThrow()
    expect(() => checkNewSessionOptions({ translations: [1], visibility: 'public' })).toThrow()
    expect(() => checkNewSessionOptions({ translations: [], visibility: 'password' })).toThrow()
    expect(() => checkNewSessionOptions('public')).toThrow()
    expect(() => checkNewSessionOptions(null)).toThrow()
  })
})

describe('checkSettingsPatch (setup.save patch)', () => {
  it('accepts valid patches of the new fields, and other fields as they are', () => {
    const ok = [
      { primarySource: { kind: 'none' } },
      { primarySource: { kind: 'device', id: 'cam' } },
      { backupSource: { kind: 'image', path: '/Users/x/secours.png' } },
      { backupSource: { kind: 'video', path: '/home/x/boucle.mp4' } },
      { recordDir: '/Users/x/Movies/LinTO Live' },
      { qr: { display: true, pinned: false, frequency: 60, duration: 15 } },
      { blackIsAbsent: false, recordEnabled: true },
      { properNounsEnabled: true, properNouns: ['LINAGORA', 'Issy-les-Moulineaux'] },
      { properNouns: [] },
      { broadcastEnabled: true, recordEnabled: false },
      { broadcastServer: 'rtmp://a.rtmp.youtube.com/live2' },
      { broadcastServer: 'rtmps://live-api-s.facebook.com:443/rtmp/' },
      { broadcastServer: '' },
      { instance: 'https://studio.linto.ai', profileId: 2, subtitleFontSize: 40 }
    ]
    for (const p of ok) expect(checkSettingsPatch(p)).toEqual(p)
  })
  it('rejects malformed patches', () => {
    const bad: unknown[] = [
      null, 'x', [],
      { primarySource: { kind: 'camera', id: 'cam' } },
      { primarySource: { kind: 'device', id: '' } },
      { primarySource: { kind: 'device' } },
      { primarySource: null },
      { backupSource: { kind: 'image', path: 'relatif.png' } },
      { backupSource: { kind: 'video', path: '' } },
      { backupSource: { kind: 'image', path: 3 } },
      { recordDir: 'Movies' },
      { recordDir: '' },
      { recordDir: 42 },
      { qr: { display: 'yes', pinned: false, frequency: 60, duration: 15 } },
      { qr: { display: true, pinned: false, frequency: 0, duration: 15 } },
      { qr: { display: true, pinned: false, frequency: 60, duration: Infinity } },
      { qr: { display: true, pinned: false, frequency: 60 } },
      { qr: null },
      { blackIsAbsent: 'true' },
      { recordEnabled: 1 },
      { properNounsEnabled: 'oui' },
      { properNouns: 'LINAGORA' },
      { properNouns: ['LINAGORA', 3] },
      { properNouns: ['x'.repeat(201)] },
      { subtitleLanguages: { s1: 'en' } },
      { broadcastEnabled: 'yes' },
      { broadcastServer: 'https://youtube.com/live' },
      { broadcastServer: 'rtmp://' },
      { broadcastServer: 'rtmp://a b/live' },
      { broadcastServer: 42 },
      { broadcastKeySet: true }
    ]
    for (const p of bad) expect(() => checkSettingsPatch(p), JSON.stringify(p)).toThrow('Réglages invalides.')
  })
})
