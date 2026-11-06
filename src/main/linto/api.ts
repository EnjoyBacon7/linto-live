import {
  UnauthorizedError,
  type AuthMethod, type Channel, type Organization, type Session, type SessionStatus, type TranscriberProfile
} from '../../shared/types'
import type { LintoUrls } from './instance'

export { UnauthorizedError }

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

  async searchSessions(orgId: string, namePrefix: string): Promise<Session[]> {
    const q = new URLSearchParams({
      searchName: namePrefix,
      statusList: 'on_schedule,ready,active,paused,terminated',
      limit: '50'
    })
    // URLSearchParams encodes space as '+'; use %20 for strictness
    const r = await this.request(`${this.urls.api}/organizations/${orgId}/sessions?${q.toString().replace(/\+/g, '%20')}`)
    return (r.sessions ?? []).map(toSession)
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
