import { describe, expect, it, vi } from 'vitest'
import { defaultSelection, loadSetupData, toSessionSummaries, type SetupDeps } from '../src/main/setupData'
import { UnauthorizedError, type Session, type Settings } from '../src/shared/types'

const dev = { videoDevices: [{ id: 'v', name: 'V' }], audioDevices: [] }
function deps(over: Partial<SetupDeps> = {}, init: Settings = { instance: 'https://x' }): SetupDeps {
  let s = init
  return {
    getSettings: () => s, hasToken: () => true,
    organizations: vi.fn().mockResolvedValue([{ id: 'o1', name: 'O' }]),
    profiles: vi.fn().mockResolvedValue([{ id: 7, name: 'P' }, { id: 8, name: 'Q' }]),
    devices: vi.fn().mockResolvedValue(dev),
    saveSettings: vi.fn(async (p) => { s = { ...s, ...p } }),
    onUnauthorized: vi.fn(), watermarkEnabled: () => true, ...over
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

describe('toSessionSummaries', () => {
  const ep = { srt: 'srt://h:1?streamid=k' }
  const mk = (id: string, status: Session['status'], updatedAt?: string, streamEndpoints: Session['channels'][0]['streamEndpoints'] = ep): Session =>
    ({ id, name: id, status, updatedAt, channels: [{ id: 1, name: 'c', streamEndpoints }] })
  it('active first, then newest updatedAt', () => {
    const r = toSessionSummaries([
      mk('old', 'ready', '2026-01-01'), mk('act', 'active', '2025-01-01'), mk('new', 'paused', '2026-02-01')
    ])
    expect(r.map((s) => s.id)).toEqual(['act', 'new', 'old'])
  })
  it('leaves out sessions the user cannot stream to (no endpoints or no channel)', () => {
    const r = toSessionSummaries([
      mk('a', 'ready', undefined, {}), { id: 'b', name: 'b', status: 'ready', channels: [] }, mk('c', 'ready'),
      mk('d', 'ready', undefined, { rtmp: 'rtmp://h/a/k' })
    ])
    expect(r.map((s) => s.id)).toEqual(['c'])
  })
})
