import type { Channel, Session } from '../../shared/types'
import { toObsStreamService } from '../obs/streamTarget'
import type { LintoApi } from './api'

export type Resolution =
  | { kind: 'reused' | 'created'; session: Session; channel: Channel; canStream: boolean }
  | { kind: 'terminated'; name: string }

type Api = Pick<LintoApi, 'searchSessions' | 'createSession' | 'getSession'>

function finish(kind: 'reused' | 'created', session: Session): Resolution {
  const channel = session.channels[0]
  if (!channel) throw new Error(`La session « ${session.name} » n'a aucun canal.`)
  return { kind, session, channel, canStream: toObsStreamService(channel.streamEndpoints ?? {}, 'srt') !== null }
}

export async function resolveSession(api: Api, orgId: string, rawName: string, profileId: number): Promise<Resolution> {
  const name = rawName.trim()
  if (!name) throw new Error('Nom de session vide')

  const exact = (await api.searchSessions(orgId, name)).filter((s) => s.name === name)
  const active = exact.filter((s) => s.status !== 'terminated')
  if (active.length > 0) {
    // Most recently created; Array.sort is stable so list order is the fallback when createdAt is missing.
    const best = [...active].sort((a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? '') || 0)[0]
    return finish('reused', await api.getSession(orgId, best.id))
  }
  if (exact.length > 0) return { kind: 'terminated', name }

  // Create response may omit streamEndpoints (assigned on channel setup): refetch only then.
  let created = await api.createSession(orgId, name, profileId)
  if (!created.channels[0]?.streamEndpoints) created = await api.getSession(orgId, created.id)
  return finish('created', created)
}
