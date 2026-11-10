/**
 * LinTO Studio's access rules for what LinTO Live does (studio-api: lib/dao/organization/roles.js,
 * permissions.js and routes/proxy/sessions/session.js). The server enforces them; the app reads them to
 * explain and disable what would be refused, rather than failing on a raw 403.
 *
 * - list / read sessions, caption socket: MEMBER (others' private sessions are hidden below MEETING_MANAGER);
 * - transcriber profiles: QUICK_MEETING;
 * - create, modify (watermark), terminate a session: MEETING_MANAGER, and the organisation's SESSION permission.
 */
export const ORG_ROLE = {
  MEMBER: 1,
  UPLOADER: 2,
  QUICK_MEETING: 3,
  MEETING_MANAGER: 4,
  MAINTAINER: 5,
  ADMIN: 6
} as const

/** Bits of an organisation's `permissions`. */
export const ORG_PERMISSION = {
  UPLOAD: 1,
  SUMMARY: 2,
  MICROPHONE: 4,
  BOT: 8,
  SESSION: 16
} as const

/** What the user may do with the sessions of an organisation; `reason` says why not (user-facing). */
export interface OrgRights {
  /** Create a session, change its settings (watermark) and terminate it. */
  manageSessions: boolean
  /** Read the transcriber profiles (needed to create a session). */
  readProfiles: boolean
  reason?: string
}

export const MSG_ROLE_TOO_LOW =
  "Ton rôle dans l'organisation ne permet pas de créer, modifier ni terminer des sessions (il faut être gestionnaire de réunion)."
export const MSG_NO_SESSION_PERMISSION = "Les sessions ne sont pas activées pour cette organisation (réglage de l'administrateur LinTO)."

/**
 * Rights from the user's role in the organisation and the organisation's permissions. Unknown values
 * (older server, user not found in the list) grant everything: LinTO still decides, the app only explains.
 */
export function orgRights(role: number | undefined, permissions: number | undefined): OrgRights {
  const knownRole = typeof role === 'number' && Number.isFinite(role)
  const knownPerms = typeof permissions === 'number' && Number.isFinite(permissions)
  const roleOk = !knownRole || role >= ORG_ROLE.MEETING_MANAGER
  const permOk = !knownPerms || (permissions & ORG_PERMISSION.SESSION) === ORG_PERMISSION.SESSION
  const out: OrgRights = {
    manageSessions: roleOk && permOk,
    readProfiles: !knownRole || role >= ORG_ROLE.QUICK_MEETING
  }
  if (!roleOk) out.reason = MSG_ROLE_TOO_LOW
  else if (!permOk) out.reason = MSG_NO_SESSION_PERMISSION
  return out
}
