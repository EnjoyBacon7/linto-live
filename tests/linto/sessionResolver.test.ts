import { describe, it, expect, vi } from 'vitest'
import { lookupSession, resolveSession } from '../../src/main/linto/sessionResolver'
import type { Session } from '../../src/shared/types'

const ep = { srt: 'srt://h:1?streamid=abc' }
const sess = (o: Partial<Session> & { name: string }): Session => ({
  id: 'id-' + o.name, status: 'active', channels: [{ id: 1, name: o.name, streamEndpoints: ep }], ...o
})
function fake(list: Session[], opts: { created?: Session; full?: Session } = {}) {
  const searchSessions = vi.fn(async () => list)
  const createSession = vi.fn(async (_o: string, name: string) => opts.created ?? sess({ name, id: 'new' }))
  const getSession = vi.fn(async (_o: string, id: string) => opts.full ?? list.find((s) => s.id === id) ?? sess({ name: 'x', id }))
  return { api: { searchSessions, createSession, getSession }, searchSessions, createSession, getSession }
}

describe('resolveSession', () => {
  it('reuses active exact match', async () => {
    const f = fake([sess({ name: 'Conf' })])
    const r = await resolveSession(f.api, 'o', 'Conf', 1)
    expect(r.kind).toBe('reused')
    expect(f.createSession).not.toHaveBeenCalled()
    if (r.kind !== 'terminated') { expect(r.channel.id).toBe(1); expect(r.canStream).toBe(true) }
  })
  it('ignores prefix matches', async () => {
    const f = fake([sess({ name: 'Conférence' })])
    const r = await resolveSession(f.api, 'o', 'Conf', 1)
    expect(r.kind).toBe('created')
    expect(f.createSession).toHaveBeenCalledWith('o', 'Conf', 1)
  })
  it('trims input', async () => {
    const f = fake([sess({ name: 'Conf' })])
    expect((await resolveSession(f.api, 'o', '  Conf  ', 1)).kind).toBe('reused')
    expect(f.searchSessions).toHaveBeenCalledWith('o', 'Conf')
  })
  it('rejects empty name', async () => {
    await expect(resolveSession(fake([]).api, 'o', '   ', 1)).rejects.toThrow('Nom de session vide')
  })
  it('terminated only => terminated, no create', async () => {
    const f = fake([sess({ name: 'Conf', status: 'terminated' })])
    expect(await resolveSession(f.api, 'o', 'Conf', 1)).toEqual({ kind: 'terminated', name: 'Conf' })
    expect(f.createSession).not.toHaveBeenCalled()
  })
  it('active + terminated same name => reused', async () => {
    const f = fake([sess({ name: 'Conf', status: 'terminated', id: 't' }), sess({ name: 'Conf', id: 'a' })])
    const r = await resolveSession(f.api, 'o', 'Conf', 1)
    expect(r.kind).toBe('reused')
    if (r.kind !== 'terminated') expect(r.session.id).toBe('a')
  })
  it('several active matches => most recently created', async () => {
    const f = fake([
      sess({ name: 'Conf', id: 'old', createdAt: '2026-01-01T00:00:00Z' }),
      sess({ name: 'Conf', id: 'new', createdAt: '2026-02-01T00:00:00Z' })
    ])
    const r = await resolveSession(f.api, 'o', 'Conf', 1)
    if (r.kind !== 'terminated') expect(r.session.id).toBe('new')
  })
  it('reused session without endpoints yields canStream false', async () => {
    const f = fake([sess({ name: 'Conf', channels: [{ id: 1, name: 'c' }] })])
    const r = await resolveSession(f.api, 'o', 'Conf', 1)
    if (r.kind !== 'terminated') expect(r.canStream).toBe(false)
  })
  it('RTMP-only session yields canStream false with the rtmp-only blocker', async () => {
    const f = fake([sess({ name: 'Conf', channels: [{ id: 1, name: 'c', streamEndpoints: { rtmp: 'rtmp://h/a/k' } }] })])
    const r = await resolveSession(f.api, 'o', 'Conf', 1)
    expect(r).toMatchObject({ kind: 'reused', canStream: false, blocker: 'rtmp-only' })
  })
  it('created session lacking endpoints is refetched via getSession', async () => {
    const f = fake([], { created: sess({ name: 'N', id: 'new', channels: [{ id: 1, name: 'N' }] }), full: sess({ name: 'N', id: 'new' }) })
    const r = await resolveSession(f.api, 'o', 'N', 1)
    expect(f.getSession).toHaveBeenCalledWith('o', 'new')
    if (r.kind !== 'terminated') expect(r.canStream).toBe(true)
  })
  it('throws when session has no channels', async () => {
    const f = fake([sess({ name: 'Conf', channels: [] })])
    await expect(resolveSession(f.api, 'o', 'Conf', 1)).rejects.toThrow("La session « Conf » n'a aucun canal.")
  })
  it('search failure (too many matches) never creates a session', async () => {
    const f = fake([])
    f.searchSessions.mockRejectedValue(new Error('Trop de sessions correspondent à ce nom.'))
    await expect(resolveSession(f.api, 'o', 'Conf', 1)).rejects.toThrow('Trop de sessions correspondent à ce nom.')
    expect(f.createSession).not.toHaveBeenCalled()
  })
})

describe('lookupSession', () => {
  it('none when no exact match (prefix matches do not count)', async () => {
    expect(await lookupSession(fake([sess({ name: 'Conférence' })]).api, 'o', 'Conf')).toBe('none')
    expect(await lookupSession(fake([]).api, 'o', '  ')).toBe('none')
  })
  it('usable when the session Démarrer would reuse has a stream endpoint', async () => {
    const f = fake([sess({ name: 'Conf' })])
    expect(await lookupSession(f.api, 'o', ' Conf ')).toBe('usable')
    expect(f.searchSessions).toHaveBeenCalledWith('o', 'Conf')
  })
  it('forbidden when LinTO gives no stream endpoint (no rights)', async () => {
    const other = sess({ name: 'Conf', channels: [{ id: 1, name: 'Conf' }] })
    expect(await lookupSession(fake([other]).api, 'o', 'Conf')).toBe('forbidden')
    expect(await lookupSession(fake([sess({ name: 'Conf', channels: [] })]).api, 'o', 'Conf')).toBe('forbidden')
  })
  it('rtmp-only when the session only offers RTMP (not supported)', async () => {
    const r = sess({ name: 'Conf', channels: [{ id: 1, name: 'Conf', streamEndpoints: { rtmp: 'rtmp://h/a/k' } }] })
    expect(await lookupSession(fake([r]).api, 'o', 'Conf')).toBe('rtmp-only')
  })
  it('terminated when only terminated sessions have that name', async () => {
    expect(await lookupSession(fake([sess({ name: 'Conf', status: 'terminated' })]).api, 'o', 'Conf')).toBe('terminated')
  })
})
