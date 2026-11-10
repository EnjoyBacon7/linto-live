import { MSG_NO_SESSION_PERMISSION } from '../../shared/rights'
import { ForbiddenError, LintoHttpError, NotFoundError } from '../../shared/types'

/** What the app was doing when LinTO refused: the message names it. */
export type LintoAction = 'list' | 'read' | 'create' | 'modify' | 'terminate'

/** LinTO's messages (studio-api) for the two kinds of 403 the session routes give. */
const ORG_PERMISSION_MISSING = 'Organization does not have the required permission'
const SECURITY_LEVEL_CODE = 'transcriber_profile_security_level'

export const MSG_PROFILE_SECURITY_LEVEL =
  "Ce profil de transcription n'est pas autorisé par le niveau de sécurité de l'organisation : choisis-en un autre."
export const MSG_ORG_ACCESS_LOST = "Tu n'as plus accès à cette organisation sur LinTO."
export const MSG_ORG_GONE = "Cette organisation n'existe plus sur LinTO."
export const MSG_SESSION_GONE = "Cette session n'existe plus sur LinTO."
export const MSG_RESOURCE_DENIED = "LinTO refuse l'accès à cette session : elle appartient à une autre organisation ou n'existe plus."

const ROLE_REFUSED: Record<LintoAction, string> = {
  list: MSG_ORG_ACCESS_LOST,
  read: MSG_ORG_ACCESS_LOST,
  create: "Tu n'as pas le droit de créer une session dans cette organisation (il faut être gestionnaire de réunion).",
  modify: "Tu n'as pas le droit de modifier cette session (il faut être gestionnaire de réunion dans l'organisation).",
  terminate: "Tu n'as pas le droit de terminer cette session (il faut être gestionnaire de réunion dans l'organisation)."
}

/** User-facing text for a LinTO refusal or failure (null: not a LinTO HTTP error, keep the original message). */
export function lintoErrorMessage(e: unknown, action: LintoAction): string | null {
  if (e instanceof ForbiddenError) {
    if (e.code === SECURITY_LEVEL_CODE) return MSG_PROFILE_SECURITY_LEVEL
    if (e.serverMessage === ORG_PERMISSION_MISSING) return MSG_NO_SESSION_PERMISSION
    if (e.status === 401) return action === 'list' ? MSG_ORG_GONE : MSG_RESOURCE_DENIED
    return ROLE_REFUSED[action]
  }
  if (e instanceof NotFoundError) return action === 'list' ? MSG_ORG_GONE : MSG_SESSION_GONE
  if (e instanceof LintoHttpError) {
    if (e.status >= 500) return `LinTO ne répond pas correctement (HTTP ${e.status}). Réessaie dans un instant.`
    return `LinTO a refusé la demande (HTTP ${e.status}${e.serverMessage ? ` : ${e.serverMessage}` : ''}).`
  }
  return null
}

/**
 * Runs a LinTO call and turns its HTTP errors into user-facing ones. An expired token (UnauthorizedError) and
 * non-HTTP errors go through unchanged: the callers ask to log in again on the former.
 */
export async function asLintoAction<T>(action: LintoAction, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    const msg = lintoErrorMessage(e, action)
    if (msg === null) throw e
    throw new Error(msg, { cause: e })
  }
}
