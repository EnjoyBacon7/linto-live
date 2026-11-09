import {
  UnauthorizedError,
  type AuthMethod, type Channel, type Organization, type Session, type SessionStatus, type TranscriberProfile
} from '../../shared/types'
import type { LintoUrls } from './instance'

export { UnauthorizedError }

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
    const res = await this.fetchFn(url, { ...init, headers })
    if (res.status === 401) throw new UnauthorizedError()
    if (!res.ok) throw new Error(`LinTO HTTP ${res.status}: ${await res.text().catch(() => '')}`)
    const text = await res.text()
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

  async organizations(): Promise<Organization[]> {
    const r = await this.request(`${this.urls.api}/organizations`)
    return r.map((o: any) => ({ id: o._id, name: o.name }))
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

  async terminateSession(orgId: string, id: string): Promise<void> {
    await this.request(`${this.urls.api}/organizations/${orgId}/sessions/${id}/stop?force=true&waitFinal=true`, { method: 'PUT' })
  }
}
