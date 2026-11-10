import type { SetupData } from '../shared/ipc'
import { toObsStreamService } from './obs/streamTarget'
import {
  ForbiddenError, UnauthorizedError, type Organization, type Session, type SessionSummary, type Settings, type TranscriberProfile,
  type WatermarkConfig
} from '../shared/types'
import { resolveWatermark } from './linto/watermark'

type Devices = Pick<SetupData, 'videoDevices' | 'audioDevices'>

export interface SetupDeps {
  getSettings(): Settings
  hasToken(): boolean
  organizations(): Promise<Organization[]>
  profiles(orgId: string): Promise<TranscriberProfile[]>
  devices(): Promise<Devices>
  saveSettings(patch: Partial<Settings>): Promise<void>
  onUnauthorized(): void
  /** The instance's watermark feature flag (from its config.js). */
  watermarkEnabled(): boolean
}

/**
 * Org/profile defaults to persist: the single org, and the first profile when the saved one is missing. A saved
 * org the user no longer belongs to (removed, or deleted on LinTO) is forgotten.
 */
export function defaultSelection(
  s: Settings, orgs: Organization[], profiles: TranscriberProfile[]
): Partial<Settings> {
  const patch: Partial<Settings> = {}
  if (orgs.length === 1 && s.orgId !== orgs[0].id) patch.orgId = orgs[0].id
  else if (orgs.length !== 1 && s.orgId !== undefined && !orgs.some((o) => o.id === s.orgId)) patch.orgId = undefined
  if (profiles.length > 0 && !profiles.some((p) => p.id === s.profileId)) patch.profileId = profiles[0].id
  return patch
}

/** The org's transcriber profiles; none when LinTO refuses them (role below « réunion rapide »). */
async function profilesOrNone(d: SetupDeps, orgId: string): Promise<TranscriberProfile[]> {
  try {
    return await d.profiles(orgId)
  } catch (e) {
    if (e instanceof ForbiddenError) return []
    throw e
  }
}

export async function loadSetupData(d: SetupDeps): Promise<SetupData> {
  const devices = await d.devices()
  const watermarkEnabled = d.watermarkEnabled()
  const empty = (): SetupData => ({ settings: d.getSettings(), organizations: [], profiles: [], ...devices, watermarkEnabled })
  if (!d.hasToken()) return empty()
  try {
    const organizations = await d.organizations()
    const s = d.getSettings()
    const orgId = organizations.length === 1 ? organizations[0].id : organizations.some((o) => o.id === s.orgId) ? s.orgId : undefined
    const org = organizations.find((o) => o.id === orgId)
    const profiles = orgId && org?.rights?.readProfiles !== false ? await profilesOrNone(d, orgId) : []
    const patch = defaultSelection(s, organizations, profiles)
    if (Object.keys(patch).length > 0) await d.saveSettings(patch)
    return { settings: d.getSettings(), organizations, profiles, ...devices, watermarkEnabled }
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      d.onUnauthorized()
      return empty()
    }
    throw e
  }
}

/**
 * Sidebar entries: `active` first, then most recently updated. Only sessions the user can stream to:
 * LinTO lists every session of the organisation but hands stream endpoints only to those with the right.
 */
export function toSessionSummaries(sessions: Session[], watermark?: WatermarkConfig): SessionSummary[] {
  return sessions
    .filter((s): s is Session & { status: SessionSummary['status'] } => s.status !== 'terminated')
    .filter((s) => toObsStreamService(s.channels[0]?.streamEndpoints ?? {}) !== null)
    .map((s): SessionSummary => {
      const out: SessionSummary = {
        id: s.id, name: s.name, status: s.status,
        watermark: resolveWatermark(s.meta, watermark)
      }
      if (s.updatedAt) out.updatedAt = s.updatedAt
      return out
    })
    .sort((a, b) =>
      Number(b.status === 'active') - Number(a.status === 'active') ||
      (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
}
