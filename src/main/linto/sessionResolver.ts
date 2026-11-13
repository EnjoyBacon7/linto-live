import type { Channel, Session, SessionLookup } from '../../shared/types'
import { streamBlocker, type StreamBlocker } from '../obs/streamTarget'
import type { LintoApi } from './api'
import { asLintoAction } from './accessMessages'

export const MSG_NO_PROFILE =
  "Aucun profil de transcription disponible dans cette organisation : impossible d'y créer une session."

export type Resolution =
  | { kind: 'reused' | 'created'; session: Session; channel: Channel; canStream: boolean; blocker: StreamBlocker | null }
  | { kind: 'terminated'; name: string }

type Api = Pick<LintoApi, 'searchSessions' | 'createSession' | 'getSession'>

function finish(kind: 'reused' | 'created', session: Session): Resolution {
  const channel = session.channels[0]
  if (!channel) throw new Error(`La session « ${session.name} » n'a aucun canal.`)
  const blocker = streamBlocker(channel.streamEndpoints ?? {})
  return { kind, session, channel, canStream: blocker === null, blocker }
}

/** Exact-name matches: the session Démarrer would reuse (most recently created non-terminated one), if any. */
async function findExisting(api: Pick<Api, 'searchSessions'>, orgId: string, name: string) {
  const exact = (await asLintoAction('list', () => api.searchSessions(orgId, name))).filter((s) => s.name === name)
  const active = exact.filter((s) => s.status !== 'terminated')
  // Most recently created; Array.sort is stable so list order is the fallback when createdAt is missing.
  const best = [...active].sort((a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? '') || 0)[0]
  return { best, anyExact: exact.length > 0 }
}

/**
 * The session Démarrer goes live on: an existing one with this exact name, else a new one with `profileId`
 * (only needed then: reusing a session works without access to the transcriber profiles).
 */
export async function resolveSession(api: Api, orgId: string, rawName: string, profileId: number | undefined): Promise<Resolution> {
  const name = rawName.trim()
  if (!name) throw new Error('Nom de session vide')

  const { best, anyExact } = await findExisting(api, orgId, name)
  if (best) return finish('reused', await asLintoAction('read', () => api.getSession(orgId, best.id)))
  if (anyExact) return { kind: 'terminated', name }
  if (profileId === undefined) throw new Error(MSG_NO_PROFILE)

  // Create response may omit streamEndpoints (assigned on channel setup): refetch only then.
  let created = await asLintoAction('create', () => api.createSession(orgId, name, profileId))
  if (!created.channels[0]?.streamEndpoints) created = await asLintoAction('read', () => api.getSession(orgId, created.id))
  return finish('created', created)
}

/**
 * What « Nouvelle session » with this name would hit: nothing (a new session), a session the user can stream
 * to, one they cannot (LinTO gives stream endpoints only to those with the right), one that only offers RTMP
 * (not supported, see streamTarget), or only terminated ones.
 */
export async function lookupSession(
  api: Pick<Api, 'searchSessions' | 'getSession'>, orgId: string, rawName: string
): Promise<SessionLookup> {
  const name = rawName.trim()
  if (!name) return 'none'
  const { best, anyExact } = await findExisting(api, orgId, name)
  if (best) {
    const channel = (await asLintoAction('read', () => api.getSession(orgId, best.id))).channels[0]
    if (!channel) return 'forbidden'
    return streamBlocker(channel.streamEndpoints ?? {}) ?? 'usable'
  }
  return anyExact ? 'terminated' : 'none'
}
