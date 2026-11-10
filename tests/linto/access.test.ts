import { describe, expect, it, vi } from 'vitest'
import { LintoApi, RESOURCE_DENIED_MESSAGE, tokenUserId } from '../../src/main/linto/api'
import {
  MSG_ORG_ACCESS_LOST, MSG_ORG_GONE, MSG_PROFILE_SECURITY_LEVEL, MSG_RESOURCE_DENIED, MSG_SESSION_GONE, asLintoAction,
  lintoErrorMessage
} from '../../src/main/linto/accessMessages'
import { MSG_ACCOUNT_DISABLED, MSG_EMAIL_NOT_VERIFIED, loginWithPassword } from '../../src/main/linto/auth'
import { MSG_NO_PROFILE, resolveSession } from '../../src/main/linto/sessionResolver'
import { loadSetupData, type SetupDeps } from '../../src/main/setupData'
import { MSG_NO_SESSION_PERMISSION, MSG_ROLE_TOO_LOW, ORG_ROLE, orgRights } from '../../src/shared/rights'
import {
  ForbiddenError, LintoHttpError, NotFoundError, UnauthorizedError, type Session, type Settings
} from '../../src/shared/types'
import type { LintoUrls } from '../../src/main/linto/instance'

const urls: LintoUrls = { instance: 'https://s', api: 'https://s/api', auth: 'https://s/auth', wsUrl: 'https://s', wsPath: '/io' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
const jwt = (data: unknown) => `h.${Buffer.from(JSON.stringify({ data })).toString('base64url')}.sig`
const apiWith = (res: () => Response, token: string | null = 't') =>
  new LintoApi(urls, () => token, (async () => res()) as unknown as typeof fetch)

describe('orgRights', () => {
  it('meeting manager with the SESSION permission manages sessions', () => {
    expect(orgRights(ORG_ROLE.MEETING_MANAGER, 16 | 4)).toEqual({ manageSessions: true, readProfiles: true })
    expect(orgRights(ORG_ROLE.ADMIN, 31)).toEqual({ manageSessions: true, readProfiles: true })
  })
  it('below meeting manager: no management; profiles from quick meeting up', () => {
    expect(orgRights(ORG_ROLE.QUICK_MEETING, 31)).toEqual({ manageSessions: false, readProfiles: true, reason: MSG_ROLE_TOO_LOW })
    expect(orgRights(ORG_ROLE.MEMBER, 31)).toEqual({ manageSessions: false, readProfiles: false, reason: MSG_ROLE_TOO_LOW })
  })
  it('organisation without the SESSION permission: refused even to its admin', () => {
    expect(orgRights(ORG_ROLE.ADMIN, 1 | 2 | 4)).toEqual({ manageSessions: false, readProfiles: true, reason: MSG_NO_SESSION_PERMISSION })
  })
  it('unknown role or permissions grant everything (LinTO decides)', () => {
    expect(orgRights(undefined, undefined)).toEqual({ manageSessions: true, readProfiles: true })
    expect(orgRights(undefined, 16)).toEqual({ manageSessions: true, readProfiles: true })
  })
})

describe('LintoApi errors', () => {
  it('403 → ForbiddenError with LinTO message and code', async () => {
    const e = await apiWith(() => json({ message: 'Not allowed to do this', code: 'x' }, 403)).organizations().catch((x) => x)
    expect(e).toBeInstanceOf(ForbiddenError)
    expect(e).toMatchObject({ status: 403, serverMessage: 'Not allowed to do this', code: 'x' })
  })
  it('401 « not authorized to access this resource » is a refusal, not an expired token', async () => {
    const e = await apiWith(() => json({ message: RESOURCE_DENIED_MESSAGE }, 401)).getSession('o', 's').catch((x) => x)
    expect(e).toBeInstanceOf(ForbiddenError)
    expect(e).not.toBeInstanceOf(UnauthorizedError)
    const jwtErr = await apiWith(() => json({ message: 'jwt expired' }, 401)).getSession('o', 's').catch((x) => x)
    expect(jwtErr).toBeInstanceOf(UnauthorizedError)
  })
  it('404 → NotFoundError, other statuses → LintoHttpError (message keeps status and body)', async () => {
    expect(await apiWith(() => json({ message: 'gone' }, 404)).getSession('o', 's').catch((x) => x)).toBeInstanceOf(NotFoundError)
    const e = await apiWith(() => new Response('boom', { status: 502 })).getSession('o', 's').catch((x) => x)
    expect(e).toBeInstanceOf(LintoHttpError)
    expect(e.message).toMatch(/502.*boom/)
  })
})

describe('organisation rights from the organisations list', () => {
  it('reads the user role (token data.userId) and the organisation permissions', async () => {
    const token = jwt({ userId: 'me' })
    const api = apiWith(() => json([
      { _id: 'a', name: 'A', permissions: 31, users: [{ userId: 'me', role: 1 }, { userId: 'x', role: 6 }] },
      { _id: 'b', name: 'B', permissions: 31, users: [{ userId: 'me', role: 4 }] },
      { _id: 'c', name: 'C' }
    ]), token)
    const orgs = await api.organizations()
    expect(orgs[0].rights).toEqual({ manageSessions: false, readProfiles: false, reason: MSG_ROLE_TOO_LOW })
    expect(orgs[1].rights).toEqual({ manageSessions: true, readProfiles: true })
    expect(orgs[2]).toEqual({ id: 'c', name: 'C' })
  })
  it('tokenUserId: null for anything that is not a LinTO JWT', () => {
    expect(tokenUserId(jwt({ userId: 'u1' }))).toBe('u1')
    expect(tokenUserId('opaque')).toBeNull()
    expect(tokenUserId('a.!!!.c')).toBeNull()
    expect(tokenUserId(null)).toBeNull()
  })
})

describe('lintoErrorMessage', () => {
  const forbidden = (message?: string, code?: string, status = 403) => new ForbiddenError(status, '', message, code)
  it('names the right that is missing', () => {
    expect(lintoErrorMessage(forbidden('Not allowed to do this'), 'create')).toMatch(/créer une session.*gestionnaire de réunion/)
    expect(lintoErrorMessage(forbidden('Not allowed to do this'), 'terminate')).toMatch(/terminer cette session/)
    expect(lintoErrorMessage(forbidden('Not allowed to do this'), 'modify')).toMatch(/modifier cette session/)
    expect(lintoErrorMessage(forbidden('Not allowed to do this'), 'list')).toBe(MSG_ORG_ACCESS_LOST)
    expect(lintoErrorMessage(forbidden('Organization does not have the required permission'), 'create')).toBe(MSG_NO_SESSION_PERMISSION)
    expect(lintoErrorMessage(forbidden('x', 'transcriber_profile_security_level'), 'create')).toBe(MSG_PROFILE_SECURITY_LEVEL)
    expect(lintoErrorMessage(forbidden(RESOURCE_DENIED_MESSAGE, undefined, 401), 'read')).toBe(MSG_RESOURCE_DENIED)
  })
  it('deleted organisation / session, server errors; anything else is left alone', () => {
    expect(lintoErrorMessage(new NotFoundError(404, ''), 'list')).toBe(MSG_ORG_GONE)
    expect(lintoErrorMessage(new NotFoundError(404, ''), 'terminate')).toBe(MSG_SESSION_GONE)
    expect(lintoErrorMessage(new LintoHttpError(503, ''), 'list')).toMatch(/HTTP 503/)
    expect(lintoErrorMessage(new UnauthorizedError(), 'list')).toBeNull()
    expect(lintoErrorMessage(new Error('net'), 'list')).toBeNull()
  })
  it('asLintoAction rewrites HTTP errors but lets an expired token through', async () => {
    await expect(asLintoAction('list', async () => { throw new NotFoundError(404, '') })).rejects.toThrow(MSG_ORG_GONE)
    await expect(asLintoAction('list', async () => { throw new UnauthorizedError() })).rejects.toBeInstanceOf(UnauthorizedError)
    expect(await asLintoAction('list', async () => 3)).toBe(3)
  })
})

describe('resolveSession and rights', () => {
  const ep = { srt: 'srt://h:1?streamid=abc' }
  const sess = (name: string, id = 'id-' + name): Session => ({ id, name, status: 'active', channels: [{ id: 1, name, streamEndpoints: ep }] })
  it('reusing a session needs no transcriber profile', async () => {
    const api = { searchSessions: vi.fn(async () => [sess('Conf')]), getSession: vi.fn(async () => sess('Conf')), createSession: vi.fn() }
    expect((await resolveSession(api, 'o', 'Conf', undefined)).kind).toBe('reused')
  })
  it('creating one without a profile says why, without calling LinTO', async () => {
    const api = { searchSessions: vi.fn(async () => []), getSession: vi.fn(), createSession: vi.fn() }
    await expect(resolveSession(api, 'o', 'Conf', undefined)).rejects.toThrow(MSG_NO_PROFILE)
    expect(api.createSession).not.toHaveBeenCalled()
  })
  it('a refused creation is explained', async () => {
    const api = {
      searchSessions: vi.fn(async () => []), getSession: vi.fn(),
      createSession: vi.fn(async () => { throw new ForbiddenError(403, '', 'Not allowed to do this') })
    }
    await expect(resolveSession(api, 'o', 'Conf', 2)).rejects.toThrow(/créer une session/)
  })
})

describe('loadSetupData and rights', () => {
  function deps(over: Partial<SetupDeps>, init: Settings): SetupDeps & { saved: () => Settings } {
    let s = init
    return {
      getSettings: () => s, hasToken: () => true,
      organizations: vi.fn().mockResolvedValue([{ id: 'o1', name: 'O' }]),
      profiles: vi.fn().mockResolvedValue([{ id: 7, name: 'P' }]),
      devices: vi.fn().mockResolvedValue({ videoDevices: [], audioDevices: [] }),
      saveSettings: vi.fn(async (p) => { s = { ...s, ...p } }),
      onUnauthorized: vi.fn(), watermarkEnabled: () => false, saved: () => s, ...over
    }
  }
  it('profiles refused (role below quick meeting): empty list, the rest still loads', async () => {
    const d = deps({ profiles: vi.fn().mockRejectedValue(new ForbiddenError(403, '')) }, { instance: 'x', orgId: 'o1', profileId: 3 })
    const r = await loadSetupData(d)
    expect(r.organizations).toHaveLength(1)
    expect(r.profiles).toEqual([])
    expect(r.settings.profileId).toBe(3)
  })
  it('known not to read profiles: LinTO is not asked', async () => {
    const d = deps({
      organizations: vi.fn().mockResolvedValue([{ id: 'o1', name: 'O', rights: { manageSessions: false, readProfiles: false } }])
    }, { instance: 'x', orgId: 'o1' })
    await loadSetupData(d)
    expect(d.profiles).not.toHaveBeenCalled()
  })
  it('forgets a saved organisation the user no longer belongs to', async () => {
    const d = deps({
      organizations: vi.fn().mockResolvedValue([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])
    }, { instance: 'x', orgId: 'gone' })
    const r = await loadSetupData(d)
    expect(d.saveSettings).toHaveBeenCalledWith({ orgId: undefined })
    expect(r.settings.orgId).toBeUndefined()
    expect(d.profiles).not.toHaveBeenCalled()
  })
  it('no organisation at all: saved one forgotten too', async () => {
    const d = deps({ organizations: vi.fn().mockResolvedValue([]) }, { instance: 'x', orgId: 'gone' })
    expect((await loadSetupData(d)).settings.orgId).toBeUndefined()
  })
})

describe('loginWithPassword refusals', () => {
  const failing = (e: Error) => ({ loginLocal: async () => { throw e } }) as unknown as LintoApi
  it('disabled account (423) and unverified e-mail (403) are explained', async () => {
    await expect(loginWithPassword(failing(new LintoHttpError(423, '')), 'a', 'b')).rejects.toThrow(MSG_ACCOUNT_DISABLED)
    await expect(loginWithPassword(failing(new ForbiddenError(403, '')), 'a', 'b')).rejects.toThrow(MSG_EMAIL_NOT_VERIFIED)
  })
})
