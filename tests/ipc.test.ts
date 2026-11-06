import { describe, it, expect, expectTypeOf, vi } from 'vitest'
import { IPC, createLintoLiveApi, type LintoLiveApi, type Transport } from '../src/shared/ipc'

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
        'authMethods', 'authLoginLocal', 'authLoginSso', 'authLogout', 'authStatus',
        'setupLoad', 'setupSave', 'liveStart', 'liveStop', 'liveTerminate', 'liveChangeDisplay',
        'appUninstall', 'evtLiveState', 'evtPreview', 'evtAudioLevel', 'evtAuthRequired'
      ].sort()
    )
  })
  it('api shape (type-level)', () => {
    expectTypeOf<LintoLiveApi['auth']['methods']>().returns.resolves.toBeArray()
    expectTypeOf<LintoLiveApi['live']['start']>().parameter(0).toBeString()
    expectTypeOf<LintoLiveApi['setup']['load']>().returns.resolves.toHaveProperty('displays')
  })
})

function fake() {
  const invoke = vi.fn(async (_c: string, ..._a: unknown[]) => undefined as unknown)
  const on = vi.fn()
  const off = vi.fn()
  const t: Transport = { invoke, on, off }
  return { invoke, on, off, api: createLintoLiveApi(t) }
}

describe('createLintoLiveApi', () => {
  it('methods invoke the right channel with args', async () => {
    const { api, invoke } = fake()
    const disp = { name: 'x', x: 1, y: 2, width: 3, height: 4 }
    await api.auth.methods()
    await api.auth.loginLocal('a@b', 'pw')
    await api.auth.loginSso('/p', 'e')
    await api.auth.logout()
    await api.auth.status()
    await api.setup.load()
    await api.setup.save({ instance: 'i' })
    await api.live.start('S')
    await api.live.stop()
    await api.live.terminate()
    await api.live.changeDisplay(disp)
    await api.app.uninstall()
    expect(invoke.mock.calls).toEqual([
      [IPC.authMethods],
      [IPC.authLoginLocal, 'a@b', 'pw'],
      [IPC.authLoginSso, '/p', 'e'],
      [IPC.authLogout],
      [IPC.authStatus],
      [IPC.setupLoad],
      [IPC.setupSave, { instance: 'i' }],
      [IPC.liveStart, 'S'],
      [IPC.liveStop],
      [IPC.liveTerminate],
      [IPC.liveChangeDisplay, disp],
      [IPC.appUninstall]
    ])
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
    expect(on.mock.calls.map((c) => c[0])).toEqual([IPC.evtLiveState, IPC.evtPreview, IPC.evtAuthRequired])
  })
})
