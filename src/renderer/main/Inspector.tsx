import type { SetupData } from '../../shared/ipc'
import type { Settings } from '../../shared/types'
import { VuMeter } from '../components/VuMeter'
import { PopUp } from '../ui/PopUp'
import { CameraIcon, CaptionsIcon, MicIcon } from '../ui/icons'

export interface InspectorProps {
  data: SetupData | null
  settings: Settings | null
  /** Profile line: the pending session's profile name, « Défini par la session », or null (nothing selected). */
  profile: string | null
  onChange(patch: Partial<Settings>): void
}

/** Right pane (inspector): camera, micro + level, transcription profile (read-only here). */
export function Inspector({ data, settings, profile, onChange }: InspectorProps) {
  const opts = (items: { id: string; name: string }[] = []) => items.map((d) => ({ value: d.id, label: d.name }))
  return (
    <aside className="inspector" aria-label="Réglages">
      <section className="inspector-group">
        <h3 className="inspector-label"><CameraIcon size={14} />Caméra</h3>
        <PopUp label="Caméra" className="inspector-control" value={settings?.videoDeviceId ?? ''} placeholder="Choisir…"
          options={opts(data?.videoDevices)} disabled={!data} onChange={(v) => onChange({ videoDeviceId: v })} />
      </section>
      <section className="inspector-group">
        <h3 className="inspector-label"><MicIcon size={14} />Micro</h3>
        <PopUp label="Micro" className="inspector-control" value={settings?.audioDeviceId ?? ''} placeholder="Choisir…"
          options={opts(data?.audioDevices)} disabled={!data} onChange={(v) => onChange({ audioDeviceId: v })} />
        <VuMeter />
      </section>
      <section className="inspector-group">
        <h3 className="inspector-label"><CaptionsIcon size={14} />Profil de transcription</h3>
        <p className={profile ? 'inspector-value' : 'inspector-value is-empty'}>{profile ?? '—'}</p>
      </section>
    </aside>
  )
}
