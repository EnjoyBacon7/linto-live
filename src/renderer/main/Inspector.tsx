import { useEffect, useState } from 'react'
import type { SetupData } from '../../shared/ipc'
import {
  DEFAULT_QR, DEFAULT_SUBTITLE_FONT_SIZE, SUBTITLE_FONT_SIZE_MAX, SUBTITLE_FONT_SIZE_MIN, type SessionVisibility, type Settings, type SubtitleLanguageOption, type VideoSource, type Watermark
} from '../../shared/types'
import { VuMeter } from '../components/VuMeter'
import { Button } from '../ui/Button'
import { PopUp } from '../ui/PopUp'
import { CameraIcon, CaptionsIcon, MicIcon, RecordIcon } from '../ui/icons'

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
  /** Why the watermark cannot be changed (it is stored on the LinTO session); absent = it can. */
  watermarkBlocked?: string
  /** Subtitle languages of the selected session, the one shown, and its setter (absent languages = no session yet). */
  languages?: SubtitleLanguageOption[]
  language?: string
  onLanguageChange?(v: string): void
  /** Visibility of the selected session on LinTO (the public link needs 'public'). */
  visibility?: SessionVisibility
  onQrSettings?(): void
  /** Which source is on air when a backup is configured (absent otherwise). */
  videoOnAir?: 'primary' | 'backup'
  /** Audio feedback (hear the micro as sent to LinTO and recorded); available only while OBS runs. */
  audioMonitor?: boolean
  audioMonitorAvailable?: boolean
  onAudioMonitorChange?(on: boolean): void
}

export function Check({ label, checked, disabled, onChange }: {
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

/** Path cut in the middle (CSS only truncates the end): the tail (folder name) stays visible. */
function MiddleEllipsis({ text }: { text: string }) {
  const tail = Math.min(18, Math.floor(text.length / 2))
  return (
    <>
      <span className="path-head">{text.slice(0, text.length - tail)}</span>
      <span className="path-tail">{text.slice(text.length - tail)}</span>
    </>
  )
}

const baseName = (path: string): string => path.split(/[/\\]/).filter(Boolean).pop() ?? path

const encodeSource = (s: VideoSource | undefined): string =>
  !s || s.kind === 'none' ? 'none' : s.kind === 'device' ? `device:${s.id}` : `file:${s.path}`

/** Video source menu: Aucune, each device, the current file (kept selectable), then the pickers. */
function SourcePopUp({ label, source, devices, disabled, onChange }: {
  label: string; source: VideoSource | undefined; devices: { id: string; name: string }[]; disabled: boolean
  onChange(s: VideoSource): void
}) {
  const options = [
    { value: 'none', label: 'Aucune' },
    ...devices.map((d) => ({ value: `device:${d.id}`, label: d.name })),
    ...(source && (source.kind === 'image' || source.kind === 'video')
      ? [{ value: `file:${source.path}`, label: baseName(source.path) }] : []),
    { value: 'pick:image', label: 'Image…' },
    { value: 'pick:video', label: 'Vidéo…' }
  ]
  const change = (v: string): void => {
    if (v === 'none') onChange({ kind: 'none' })
    else if (v.startsWith('device:')) onChange({ kind: 'device', id: v.slice(7) })
    else if (v.startsWith('pick:')) {
      const kind = v === 'pick:image' ? 'image' : 'video'
      void window.lintoLive.setup.pickMedia(kind).then((path) => { if (path) onChange({ kind, path }) }, () => {})
    }
  }
  return <PopUp label={label} className="inspector-control" value={encodeSource(source)} placeholder="Choisir…"
    options={options} disabled={disabled} onChange={change} />
}

/** Right pane (inspector): camera (optional), micro + level, transcription profile (read-only here), subtitles. */
export function Inspector(p: InspectorProps) {
  const { data, settings, profile, onChange } = p
  const opts = (items: { id: string; name: string }[] = []) => items.map((d) => ({ value: d.id, label: d.name }))
  const shown = settings?.subtitlesVisible !== false
  const wm = p.watermark && 'watermark' in p.watermark ? p.watermark.watermark : null
  const qr = { ...DEFAULT_QR, ...settings?.qr }
  const language = p.languages?.some((l) => l.value === p.language) ? p.language! : 'original'
  const wmEditable = !!wm && p.watermarkBlocked === undefined
  return (
    <aside className="inspector" aria-label="Réglages">
      <section className="inspector-group">
        <h3 className="inspector-label"><CameraIcon size={14} />Vidéo</h3>
        {/* Optional: without a source the app is a plain LinTO client (audio only, transcript here). */}
        <SourcePopUp label="Source principale" source={settings?.primarySource} devices={data?.videoDevices ?? []}
          disabled={!data} onChange={(v) => onChange({ primarySource: v })} />
        <SourcePopUp label="Source de secours" source={settings?.backupSource} devices={data?.videoDevices ?? []}
          disabled={!data} onChange={(v) => onChange({ backupSource: v })} />
        <Check label="Écran noir = source absente" checked={settings?.blackIsAbsent !== false}
          disabled={!settings || !settings.backupSource || settings.backupSource.kind === 'none'}
          onChange={(v) => onChange({ blackIsAbsent: v })} />
        {p.videoOnAir && (
          <p className="inspector-note">À l’antenne : {p.videoOnAir === 'backup' ? 'secours' : 'principale'}</p>
        )}
      </section>
      <section className="inspector-group">
        <h3 className="inspector-label"><MicIcon size={14} />Micro</h3>
        <PopUp label="Micro" className="inspector-control" value={settings?.audioDeviceId ?? ''} placeholder="Choisir…"
          options={opts(data?.audioDevices)} disabled={!data} onChange={(v) => onChange({ audioDeviceId: v })} />
        <VuMeter />
        <Check label="Écouter le retour audio" checked={p.audioMonitor === true}
          disabled={!p.onAudioMonitorChange || (!p.audioMonitor && !p.audioMonitorAvailable)}
          onChange={(v) => p.onAudioMonitorChange?.(v)} />
        {p.audioMonitor && (
          <p className="inspector-note">
            Le son envoyé à LinTO et enregistré est joué sur la sortie audio du système : utilisez un casque (sur
            haut-parleurs, le micro le reprend et provoque un larsen).
          </p>
        )}
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
            <label className="field inspector-inline">
              <span className="field-label">Langue affichée</span>
              <PopUp label="Langue affichée" value={language}
                options={p.languages ?? [{ value: 'original', label: 'Langue originale' }]} disabled={!p.languages}
                onChange={(v) => p.onLanguageChange?.(v)} />
            </label>
            {!data?.watermarkEnabled && p.watermark && 'pending' in p.watermark && (
              <p className="inspector-note">Réglable une fois la session créée sur LinTO (au démarrage).</p>
            )}
            <FontSize value={settings?.subtitleFontSize ?? DEFAULT_SUBTITLE_FONT_SIZE} disabled={!settings}
              onChange={(v) => onChange({ subtitleFontSize: v })} />
            {data?.watermarkEnabled && (
              <div className="inspector-subgroup">
                <Check label="Afficher le filigrane" checked={wm?.display ?? false} disabled={!wmEditable}
                  onChange={(v) => p.onWatermarkChange?.({ display: v })} />
                <Check label="Épingler le filigrane" checked={wm?.pinned ?? false} disabled={!wmEditable || !wm?.display}
                  onChange={(v) => p.onWatermarkChange?.({ pinned: v })} />
                <Button className="inspector-control" disabled={!wmEditable} onClick={() => p.onWatermarkSettings?.()}>
                  Paramètres du filigrane…
                </Button>
                {wm && p.watermarkBlocked && <p className="inspector-note">{p.watermarkBlocked}</p>}
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
        <div className="inspector-subgroup">
          <Check label="Afficher le QR code" checked={qr.display} disabled={!settings}
            onChange={(v) => onChange({ qr: { ...qr, display: v } })} />
          <Check label="Épingler le QR code" checked={qr.pinned} disabled={!settings || !qr.display}
            onChange={(v) => onChange({ qr: { ...qr, pinned: v } })} />
          <Button className="inspector-control" disabled={!settings} onClick={() => p.onQrSettings?.()}>
            Paramètres du QR code…
          </Button>
          {qr.display && p.visibility !== undefined && p.visibility !== 'public' && (
            <p className="inspector-note">
              Le public devra se connecter à LinTO pour ouvrir ce lien : rendre la session publique dans LinTO Studio.
            </p>
          )}
        </div>
      </section>
      <section className="inspector-group" aria-label="Enregistrement">
        <h3 className="inspector-label"><RecordIcon size={14} />Enregistrement</h3>
        <Check label="Enregistrer le direct" checked={settings?.recordEnabled === true} disabled={!settings}
          onChange={(v) => onChange({ recordEnabled: v })} />
        {p.onAir && <p className="inspector-note">S’applique au prochain Démarrer.</p>}
        <p className={settings?.recordDir ? 'inspector-value inspector-path' : 'inspector-value inspector-path is-empty'}
          title={settings?.recordDir}>
          {settings?.recordDir ? <MiddleEllipsis text={settings.recordDir} /> : 'Vidéos (Films sur macOS) › LinTO Live'}
        </p>
        <Button className="inspector-control" disabled={!settings} onClick={() => {
          void window.lintoLive.setup.pickFolder().then((dir) => { if (dir) onChange({ recordDir: dir }) }, () => {})
        }}>
          Choisir…
        </Button>
      </section>
    </aside>
  )
}
