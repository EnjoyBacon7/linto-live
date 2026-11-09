import { useEffect, useState } from 'react'
import type { SetupData } from '../../shared/ipc'
import {
  DEFAULT_SUBTITLE_FONT_SIZE, SUBTITLE_FONT_SIZE_MAX, SUBTITLE_FONT_SIZE_MIN, type Settings, type Watermark
} from '../../shared/types'
import { VuMeter } from '../components/VuMeter'
import { Button } from '../ui/Button'
import { PopUp } from '../ui/PopUp'
import { CameraIcon, CaptionsIcon, MicIcon } from '../ui/icons'

/** Watermark of the selected session; `pending` = the session does not exist on LinTO yet. */
export type WatermarkTarget = { watermark: Watermark } | { pending: true } | null

export interface InspectorProps {
  data: SetupData | null
  settings: Settings | null
  /** Profile line: the pending session's profile name, « Défini par la session », or null (nothing selected). */
  profile: string | null
  onChange(patch: Partial<Settings>): void
  /** A show is on air (« Effacer les sous-titres » only means something then). */
  onAir?: boolean
  onClearSubtitles?(): void
  watermark?: WatermarkTarget
  onWatermarkChange?(patch: Partial<Watermark>): void
  onWatermarkSettings?(): void
}

function Check({ label, checked, disabled, onChange }: {
  label: string; checked: boolean; disabled?: boolean; onChange(v: boolean): void
}) {
  return (
    <label className={disabled ? 'check is-disabled' : 'check'}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

/** Font size field: saved only once it is a whole number within range (typing « 4 » on the way to 48 saves nothing). */
function FontSize({ value, disabled, onChange }: { value: number; disabled: boolean; onChange(v: number): void }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const valid = (s: string): number | null => {
    const n = Number(s)
    return s.trim() !== '' && Number.isInteger(n) && n >= SUBTITLE_FONT_SIZE_MIN && n <= SUBTITLE_FONT_SIZE_MAX ? n : null
  }
  return (
    <label className="field inspector-inline">
      <span className="field-label">Taille de la police (px)</span>
      <input className="field-input" type="number" min={SUBTITLE_FONT_SIZE_MIN} max={SUBTITLE_FONT_SIZE_MAX}
        value={draft} disabled={disabled} aria-invalid={valid(draft) === null}
        onChange={(e) => {
          setDraft(e.target.value)
          const n = valid(e.target.value)
          if (n !== null && n !== value) onChange(n)
        }}
        onBlur={() => { if (valid(draft) === null) setDraft(String(value)) }} />
    </label>
  )
}

/** Right pane (inspector): camera, micro + level, transcription profile (read-only here), subtitles. */
export function Inspector(p: InspectorProps) {
  const { data, settings, profile, onChange } = p
  const opts = (items: { id: string; name: string }[] = []) => items.map((d) => ({ value: d.id, label: d.name }))
  const shown = settings?.subtitlesVisible !== false
  const wm = p.watermark && 'watermark' in p.watermark ? p.watermark.watermark : null
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
      <section className="inspector-group" aria-label="Sous-titres">
        <h3 className="inspector-label"><CaptionsIcon size={14} />Sous-titres</h3>
        <Check label="Afficher le sous-titre" checked={shown} disabled={!settings}
          onChange={(v) => onChange({ subtitlesVisible: v })} />
        {shown && (
          <>
            <FontSize value={settings?.subtitleFontSize ?? DEFAULT_SUBTITLE_FONT_SIZE} disabled={!settings}
              onChange={(v) => onChange({ subtitleFontSize: v })} />
            {data?.watermarkEnabled && (
              <div className="inspector-subgroup">
                <Check label="Afficher le filigrane" checked={wm?.display ?? false} disabled={!wm}
                  onChange={(v) => p.onWatermarkChange?.({ display: v })} />
                <Check label="Épingler le filigrane" checked={wm?.pinned ?? false} disabled={!wm?.display}
                  onChange={(v) => p.onWatermarkChange?.({ pinned: v })} />
                <Button className="inspector-control" disabled={!wm} onClick={() => p.onWatermarkSettings?.()}>
                  Paramètres du filigrane…
                </Button>
                {p.watermark && 'pending' in p.watermark && (
                  <p className="inspector-note">Réglable une fois la session créée sur LinTO (au démarrage).</p>
                )}
              </div>
            )}
            <Button className="inspector-control" disabled={!p.onAir} onClick={() => p.onClearSubtitles?.()}>
              Effacer les sous-titres
            </Button>
          </>
        )}
      </section>
    </aside>
  )
}
