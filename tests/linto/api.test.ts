import { describe, it, expect } from 'vitest'
import { LintoApi } from '../../src/main/linto/api'
import { UnauthorizedError } from '../../src/shared/types'
import type { LintoUrls } from '../../src/main/linto/instance'

const urls: LintoUrls = { instance: 'https://s', api: 'https://s/api', auth: 'https://s/auth', wsUrl: 'https://s', wsPath: '/io' }
interface Call { url: string; init: RequestInit }
function mk(responder: (c: Call) => Response) {
  const calls: Call[] = []
  const f = (async (url: string, init: RequestInit = {}) => { const c = { url, init }; calls.push(c); return responder(c) }) as unknown as typeof fetch
  return { calls, api: new LintoApi(urls, () => 't', f) }
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
const hdr = (c: Call, k: string) => new Headers(c.init.headers).get(k)

describe('LintoApi', () => {
  it('sends bearer token and maps organizations _id', async () => {
    const { calls, api } = mk(() => json([{ _id: 'o1', name: 'Org', extra: 1 }]))
    expect(await api.organizations()).toEqual([{ id: 'o1', name: 'Org' }])
    expect(calls[0].url).toBe('https://s/api/organizations')
    expect(hdr(calls[0], 'Authorization')).toBe('Bearer t')
  })
  it('maps transcriber profiles', async () => {
    const { calls, api } = mk(() => json([{ id: 3, config: { name: 'Fr', languages: [{ candidate: 'fr-FR' }] } }]))
    expect(await api.transcriberProfiles('o1')).toEqual([{ id: 3, name: 'Fr', languages: ['fr-FR'] }])
    expect(calls[0].url).toBe('https://s/api/organizations/o1/transcriber_profiles')
  })
  it('401 => UnauthorizedError, other non-2xx => Error with status+body', async () => {
    await expect(mk(() => json({}, 401)).api.organizations()).rejects.toBeInstanceOf(UnauthorizedError)
    await expect(mk(() => new Response('boom', { status: 500 })).api.organizations()).rejects.toThrow(/500.*boom/)
  })
  it('authMethods is unauthenticated GET {auth}/list', async () => {
    const { calls, api } = mk(() => json([{ path: 'local', from: 'a', name: 'Local' }]))
    expect(await api.authMethods()).toHaveLength(1)
    expect(calls[0].url).toBe('https://s/auth/list')
  })
  it('loginLocal posts credentials', async () => {
    const { calls, api } = mk(() => json({ auth_token: 'A', refresh_token: 'R', user_id: 'u' }))
    expect(await api.loginLocal('a@b', 'pw')).toEqual({ token: 'A', userId: 'u' })
    expect(calls[0].url).toBe('https://s/auth/login')
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ email: 'a@b', password: 'pw' })
  })
  it('loginLocal 401 is UnauthorizedError', async () => {
    await expect(mk(() => json({}, 401)).api.loginLocal('a', 'b')).rejects.toBeInstanceOf(UnauthorizedError)
  })
  it('searchSessions encodes name and maps sessions', async () => {
    const { calls, api } = mk(() => json({ sessions: [{ id: 's', name: 'Conf é&', status: 'active', owner: 'u', channels: [{ id: 7, name: 'c', streamEndpoints: { srt: 'srt://x' }, junk: 1 }] }], totalItems: 1 }))
    const r = await api.searchSessions('o1', 'Conf é&')
    expect(calls[0].url).toContain('/organizations/o1/sessions?')
    expect(calls[0].url).toContain('searchName=' + encodeURIComponent('Conf é&'))
    expect(calls[0].url).toContain('statusList=' + encodeURIComponent('on_schedule,ready,active,paused,terminated'))
    expect(calls[0].url).toContain('limit=50')
    expect(r[0]).toEqual({ id: 's', name: 'Conf é&', status: 'active', owner: 'u', channels: [{ id: 7, name: 'c', streamEndpoints: { srt: 'srt://x' } }] })
  })
  it('maps createdAt when present', async () => {
    const { api } = mk(() => json({ sessions: [{ id: 's', name: 'n', status: 'active', createdAt: '2026-01-02T00:00:00Z', channels: [] }] }))
    expect((await api.searchSessions('o1', 'n'))[0].createdAt).toBe('2026-01-02T00:00:00Z')
  })
  it('createSession body matches the constraints payload', async () => {
    const { calls, api } = mk(() => json({ id: 'n', name: 'X', status: 'ready', channels: [{ id: 1, name: 'X' }] }))
    const s = await api.createSession('o1', 'X', 42)
    expect(calls[0].url).toBe('https://s/api/organizations/o1/sessions')
    expect(calls[0].init.method).toBe('POST')
    expect(hdr(calls[0], 'Content-Type')).toBe('application/json')
    const body = JSON.parse(calls[0].init.body as string)
    expect(body).toEqual({
      name: 'X',
      channels: [{ transcriberProfileId: 42, name: 'X', translations: [], diarization: false, keepAudio: true, compressAudio: true }],
      meta: {}, scheduleOn: null, endOn: null, autoStart: true, autoEnd: false, visibility: 'organization'
    })
    expect(body.channels[0].transcriberProfileId).toBe(42)
    expect(s.id).toBe('n')
  })
  it('getSession and terminateSession', async () => {
    const { calls, api } = mk((c) => c.url.includes('stop') ? json({ success: true }) : json({ id: 's', name: 'N', status: 'ready', channels: [] }))
    expect((await api.getSession('o1', 's')).id).toBe('s')
    expect(calls[0].url).toBe('https://s/api/organizations/o1/sessions/s')
    await api.terminateSession('o1', 's')
    expect(calls[1].url).toBe('https://s/api/organizations/o1/sessions/s/stop?force=true&waitFinal=true')
    expect(calls[1].init.method).toBe('PUT')
  })
})
