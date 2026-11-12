import {
  ForbiddenError, LintoHttpError, NotFoundError, UnauthorizedError,
  type AuthMethod, type Channel, type Organization, type Session, type SessionStatus, type TranscriberProfile
} from '../../shared/types'
import { orgRights } from '../../shared/rights'
import type { LintoUrls } from './instance'
import { LINTO_TIMEOUT_MS, withTimeout } from './timeout'

export { ForbiddenError, LintoHttpError, NotFoundError, UnauthorizedError }

/**
 * LinTO answers 401 with this message when a valid token asks for a resource of another organisation (or
 * one that vanished): an access refusal, not an expired login — logging in again would not help.
 */
export const RESOURCE_DENIED_MESSAGE = 'You are not authorized to access this resource'

/** The user id inside a LinTO token (`data.userId` of the JWT payload), or null. Not verified: a hint only. */
export function tokenUserId(token: string | null): string | null {
  const part = token?.split('.')[1]
  if (!part) return null
  try {
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
    const id = payload?.data?.userId
    return typeof id === 'string' && id ? id : null
  } catch {
    return null
  }
}

/** LinTO's JSON error body: `{ message, code? }`. */
function errorBody(text: string): { message?: string; code?: string } {
  try {
    const b = JSON.parse(text)
    return {
      ...(typeof b?.message === 'string' ? { message: b.message } : {}),
      ...(typeof b?.code === 'string' ? { code: b.code } : {})
    }
  } catch {
    return {}
  }
}

const SEARCH_PAGE_SIZE = 50
const SEARCH_MAX_PAGES = 20

/* eslint-disable @typescript-eslint/no-explicit-any */
function toChannel(c: any): Channel {
  const ch: Channel = { id: c.id, name: c.name }
  if (c.streamEndpoints) ch.streamEndpoints = c.streamEndpoints
  return ch
}

function toSession(s: any): Session {
  const out: Session = {
    id: s.id,
    name: s.name,
    status: s.status as SessionStatus,
    channels: (s.channels ?? []).map(toChannel)
  }
  if (s.owner) out.owner = s.owner
  if (s.createdAt) out.createdAt = s.createdAt
  if (s.updatedAt) out.updatedAt = s.updatedAt
  if (s.meta && typeof s.meta === 'object' && !Array.isArray(s.meta)) out.meta = s.meta
  return out
}

export class LintoApi {
  constructor(
    private urls: LintoUrls,
    private token: () => string | null,
    private fetchFn: typeof fetch = fetch
  ) {}

  private async request(url: string, init: RequestInit = {}, auth = true): Promise<any> {
    const headers = new Headers(init.headers)
    if (init.body !== undefined) headers.set('Content-Type', 'application/json')
    const t = this.token()
    if (auth && t) headers.set('Authorization', `Bearer ${t}`)
    const res = await withTimeout(() => this.fetchFn(url, { ...init, headers, signal: AbortSignal.timeout(LINTO_TIMEOUT_MS) }))
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const { message, code } = errorBody(text)
      if (res.status === 401) {
        if (auth && message === RESOURCE_DENIED_MESSAGE) throw new ForbiddenError(401, text, message, code)
        throw new UnauthorizedError()
      }
      if (res.status === 403) throw new ForbiddenError(403, text, message, code)
      if (res.status === 404) throw new NotFoundError(404, text, message, code)
      throw new LintoHttpError(res.status, text, message, code)
    }
    const text = await withTimeout(() => res.text())
    return text ? JSON.parse(text) : undefined
  }

  authMethods(): Promise<AuthMethod[]> {
    return this.request(`${this.urls.auth}/list`, {}, false)
  }

  async loginLocal(email: string, password: string): Promise<{ token: string; userId: string }> {
    const r = await this.request(`${this.urls.auth}/login`, {
      method: 'POST', body: JSON.stringify({ email, password })
    }, false)
    return { token: r.auth_token, userId: r.user_id }
  }

  /**
   * The user's organisations. LinTO sends each one's members (with their role) and permissions: the user's
   * rights there are derived from them when the token names the user.
   */
  async organizations(): Promise<Organization[]> {
    const r = await this.request(`${this.urls.api}/organizations`)
    const me = tokenUserId(this.token())
    return (Array.isArray(r) ? r : []).map((o: any) => {
      const out: Organization = { id: o._id, name: o.name }
      const member = me && Array.isArray(o.users) ? o.users.find((u: any) => u?.userId === me) : undefined
      const role = typeof member?.role === 'number' ? member.role : undefined
      const permissions = typeof o.permissions === 'number' ? o.permissions : undefined
      if (role !== undefined || permissions !== undefined) out.rights = orgRights(role, permissions)
      return out
    })
  }

  async transcriberProfiles(orgId: string): Promise<TranscriberProfile[]> {
    const r = await this.request(`${this.urls.api}/organizations/${orgId}/transcriber_profiles`)
    return r.map((p: any) => {
      const out: TranscriberProfile = { id: p.id, name: p.config?.name ?? String(p.id) }
      if (Array.isArray(p.config?.languages)) {
        out.languages = p.config.languages.map((l: any) => (typeof l === 'string' ? l : l.candidate))
      }
      return out
    })
  }

  /**
   * All pages of the org's sessions (offset += limit until totalItems or an empty/short page).
   * Hitting the page cap is an error rather than a partial answer.
   */
  private async pagedSessions(orgId: string, params: Record<string, string>, tooManyMsg: string): Promise<Session[]> {
    const out: Session[] = []
    for (let page = 0; page < SEARCH_MAX_PAGES; page++) {
      const q = new URLSearchParams({
        ...params,
        limit: String(SEARCH_PAGE_SIZE),
        offset: String(out.length) // = page * limit, and still correct if the server caps the page size
      })
      // URLSearchParams encodes space as '+'; use %20 for strictness
      const r = await this.request(`${this.urls.api}/organizations/${orgId}/sessions?${q.toString().replace(/\+/g, '%20')}`)
      const items: any[] = r?.sessions ?? []
      out.push(...items.map(toSession))
      const total = typeof r?.totalItems === 'number' ? r.totalItems : null
      // Trust totalItems when present (the server may cap `limit` below ours); otherwise a short page is the last.
      const last = total !== null ? out.length >= total : items.length < SEARCH_PAGE_SIZE
      if (items.length === 0 || last) return out
    }
    throw new Error(tooManyMsg)
  }

  /** Every session whose name starts with `namePrefix` (missing an exact match would create a duplicate). */
  searchSessions(orgId: string, namePrefix: string): Promise<Session[]> {
    return this.pagedSessions(orgId, {
      searchName: namePrefix,
      statusList: 'on_schedule,ready,active,paused,terminated'
    }, 'Trop de sessions correspondent à ce nom.')
  }

  /** The organisation's non-terminated sessions. */
  listSessions(orgId: string): Promise<Session[]> {
    return this.pagedSessions(orgId, { statusList: 'on_schedule,ready,active,paused' }, "Trop de sessions dans l'organisation.")
  }

  async createSession(orgId: string, name: string, profileId: number): Promise<Session> {
    const body = {
      name,
      channels: [{
        transcriberProfileId: profileId, name, translations: [],
        diarization: false, keepAudio: true, compressAudio: true
      }],
      meta: {}, scheduleOn: null, endOn: null, autoStart: true, autoEnd: false,
      visibility: 'organization'
    }
    return toSession(await this.request(`${this.urls.api}/organizations/${orgId}/sessions`, {
      method: 'POST', body: JSON.stringify(body)
    }))
  }

  async getSession(orgId: string, id: string): Promise<Session> {
    return toSession(await this.request(`${this.urls.api}/organizations/${orgId}/sessions/${id}`))
  }

  /** Replaces the session's `meta` (send the whole object: LinTO does not merge it). */
  async patchSessionMeta(orgId: string, id: string, meta: Record<string, unknown>): Promise<void> {
    await this.request(`${this.urls.api}/organizations/${orgId}/sessions/${id}`, {
      method: 'PATCH', body: JSON.stringify({ meta })
    })
  }

  async terminateSession(orgId: string, id: string): Promise<void> {
    await this.request(`${this.urls.api}/organizations/${orgId}/sessions/${id}/stop?force=true&waitFinal=true`, { method: 'PUT' })
  }
}
