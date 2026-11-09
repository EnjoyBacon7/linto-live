import { describe, expect, it, vi } from 'vitest'
import { defaultSelection, loadSetupData, type SetupDeps } from '../src/main/setupData'
import { UnauthorizedError, type Settings } from '../src/shared/types'

const dev = { videoDevices: [{ id: 'v', name: 'V' }], audioDevices: [] }
function deps(over: Partial<SetupDeps> = {}, init: Settings = { instance: 'https://x' }): SetupDeps {
  let s = init
  return {
    getSettings: () => s, hasToken: () => true,
    organizations: vi.fn().mockResolvedValue([{ id: 'o1', name: 'O' }]),
    profiles: vi.fn().mockResolvedValue([{ id: 7, name: 'P' }, { id: 8, name: 'Q' }]),
    devices: vi.fn().mockResolvedValue(dev),
    saveSettings: vi.fn(async (p) => { s = { ...s, ...p } }),
    onUnauthorized: vi.fn(), ...over
  }
}

describe('loadSetupData', () => {
  it('logged out: no LinTO call, settings and devices returned', async () => {
    const d = deps({ hasToken: () => false })
    const r = await loadSetupData(d)
    expect(r.organizations).toEqual([]); expect(r.videoDevices).toEqual(dev.videoDevices)
    expect(d.organizations).not.toHaveBeenCalled()
  })
  it('persists single org and first profile', async () => {
    const d = deps()
    const r = await loadSetupData(d)
    expect(d.saveSettings).toHaveBeenCalledWith({ orgId: 'o1', profileId: 7 })
    expect(r.settings).toMatchObject({ orgId: 'o1', profileId: 7 })
  })
  it('keeps valid saved choices', async () => {
    const d = deps({}, { instance: 'x', orgId: 'o1', profileId: 8 })
    await loadSetupData(d)
    expect(d.saveSettings).not.toHaveBeenCalled()
  })
  it('401: empty lists, local data kept, unauthorized reported', async () => {
    const d = deps({ organizations: vi.fn().mockRejectedValue(new UnauthorizedError()) })
    const r = await loadSetupData(d)
    expect(r.organizations).toEqual([]); expect(r.videoDevices).toEqual(dev.videoDevices)
    expect(d.onUnauthorized).toHaveBeenCalled()
  })
  it('other errors propagate', async () => {
    await expect(loadSetupData(deps({ organizations: vi.fn().mockRejectedValue(new Error('net')) }))).rejects.toThrow('net')
  })
})

describe('defaultSelection', () => {
  it('does not pick an org among several', () => {
    expect(defaultSelection({ instance: 'x' }, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], [])).toEqual({})
  })
  it('replaces a profile missing from the list', () => {
    expect(defaultSelection({ instance: 'x', orgId: 'a', profileId: 99 }, [{ id: 'a', name: 'A' }], [{ id: 1, name: 'P' }])).toEqual({ profileId: 1 })
  })
})
