import type { SetupData } from '../shared/ipc'
import { UnauthorizedError, type Organization, type Settings, type TranscriberProfile } from '../shared/types'

type Devices = Pick<SetupData, 'videoDevices' | 'audioDevices'>

export interface SetupDeps {
  getSettings(): Settings
  hasToken(): boolean
  organizations(): Promise<Organization[]>
  profiles(orgId: string): Promise<TranscriberProfile[]>
  devices(): Promise<Devices>
  saveSettings(patch: Partial<Settings>): Promise<void>
  onUnauthorized(): void
}

/** Org/profile defaults to persist: the single org, and the first profile when the saved one is missing. */
export function defaultSelection(
  s: Settings, orgs: Organization[], profiles: TranscriberProfile[]
): Partial<Settings> {
  const patch: Partial<Settings> = {}
  if (orgs.length === 1 && s.orgId !== orgs[0].id) patch.orgId = orgs[0].id
  if (profiles.length > 0 && !profiles.some((p) => p.id === s.profileId)) patch.profileId = profiles[0].id
  return patch
}

export async function loadSetupData(d: SetupDeps): Promise<SetupData> {
  const devices = await d.devices()
  const empty = (): SetupData => ({ settings: d.getSettings(), organizations: [], profiles: [], ...devices })
  if (!d.hasToken()) return empty()
  try {
    const organizations = await d.organizations()
    const s = d.getSettings()
    const orgId = organizations.length === 1 ? organizations[0].id : organizations.some((o) => o.id === s.orgId) ? s.orgId : undefined
    const profiles = orgId ? await d.profiles(orgId) : []
    const patch = defaultSelection(s, organizations, profiles)
    if (Object.keys(patch).length > 0) await d.saveSettings(patch)
    return { settings: d.getSettings(), organizations, profiles, ...devices }
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      d.onUnauthorized()
      return empty()
    }
    throw e
  }
}
