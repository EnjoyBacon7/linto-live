import { useEffect, useId, useState, type ReactNode } from 'react'
import type { SetupData } from '../../shared/ipc'
import {
  DEFAULT_QR, DEFAULT_SUBTITLE_FONT_SIZE, MIC_GAIN_MAX, MIC_GAIN_MIN, micGainDb, SUBTITLE_FONT_SIZE_MAX, SUBTITLE_FONT_SIZE_MIN, SUBTITLE_LINES_MAX, SUBTITLE_LINES_MIN, subtitleLines, subtitlePosition, SUBTITLE_MAX_WPS_MAX, SUBTITLE_MAX_WPS_STEP, subtitleMaxWordsPerSecond, SUBTITLE_SMOOTHING_MAX, SUBTITLE_SMOOTHING_STEP, subtitleSmoothingMs, type SessionVisibility, type Settings, type SubtitleLanguageOption, type VideoSource, type CaptureKind, type Watermark
} from '../../shared/types'
import { VuMeter } from '../components/VuMeter'
import { Button } from '../ui/Button'
import { CaptureSheet } from './CaptureSheet'
import { PopUp } from '../ui/PopUp'
import { BroadcastIcon, CameraIcon, CaptionsIcon, ChevronRightIcon, LayersIcon, MicIcon, SlidersIcon, WarningIcon } from '../ui/icons'
import { broadcastHost, isBroadcastServer } from '../../shared/broadcast'

/** Watermark of the selected session; `pending` = the session does not exist on LinTO yet. */
export type WatermarkTarget = { watermark: Watermark } | { pending: true } | null

export interface InspectorProps {
  data: SetupData | null
  settings: Settings | null
  /** Profile line: the pending session's profile name, « Défini par la session », or null (nothing selected). */
  profile: string | null
  onChange(patch: Partial<Settings>): void
  /** A show is on air (« Effacer la transcription » only means something then). */
  onAir?: boolean
  /** « Effacer la transcription »: clears the on-air session's transcript on LinTO (as LinTO Studio's button). */
  onClearTranscript?(): void
  /** Why the transcript cannot be cleared here (the user may not manage sessions); absent = it can. */
  clearBlocked?: string
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
  /** Virtual camera (the output offered to other apps as a camera); available only while OBS runs. */
  virtualCam?: boolean
  virtualCamAvailable?: boolean
  /** Why this system has no virtual camera (greys the option out, with this as its tooltip). */
  virtualCamBlocked?: string
  onVirtualCamChange?(on: boolean): void
  /** Opens « Paramètres de diffusion » (server and stream key of the online broadcast). */
  onBroadcastSettings?(): void
}

/** `blockedReason`: why it is unavailable (disables it; tooltip and accessible description). */
export function Check({ label, ariaLabel, checked, disabled, blockedReason, onChange }: {
  label: string; ariaLabel?: string; checked: boolean; disabled?: boolean; blockedReason?: string; onChange(v: boolean): void
}) {
  const reasonId = useId()
  const off = disabled || blockedReason !== undefined
  // The reason sits next to the label, not inside it, so it describes the box without joining its name.
  return (
    <>
      <label className={off ? 'check is-disabled' : 'check'} title={blockedReason}>
        <input type="checkbox" checked={checked} disabled={off} aria-label={ariaLabel}
          {...(blockedReason !== undefined ? { 'aria-describedby': reasonId } : {})}
          onChange={(e) => onChange(e.target.checked)} />
        <span>{label}</span>
      </label>
      {blockedReason !== undefined && <span id={reasonId} className="sr-only">{blockedReason}</span>}
    </>
  )
}

function Radio({ name, label, checked, disabled, onSelect }: {
  name: string; label: string; checked: boolean; disabled?: boolean; onSelect(): void
}) {
  return (
    <label className={disabled ? 'check is-disabled' : 'check'}>
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={(e) => { if (e.target.checked) onSelect() }} />
      <span>{label}</span>
    </label>
  )
}

/* ---------- Collapsible sections ---------- */

const OPEN_KEY = 'linto-live.inspector.open'

function readOpen(): Record<string, boolean> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}')
    return v && typeof v === 'object' ? v as Record<string, boolean> : {}
  } catch {
    return {}
  }
}

/** Open/closed state of a section, remembered across launches (a UI preference, not a setting). */
function useOpen(id: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState(() => readOpen()[id] ?? initial)
  const set = (v: boolean): void => {
    setOpen(v)
    try { localStorage.setItem(OPEN_KEY, JSON.stringify({ ...readOpen(), [id]: v })) } catch { /* private mode: not remembered */ }
  }
  return [open, set]
}

/**
 * Disclosure section (like the Finder / Xcode inspector): the header toggles the body; closed, it shows a
 * one-line summary of the current values so nothing is hidden from view, only its controls.
 */
function Section({ id, title, label, icon, summary, attention, accessory, initiallyOpen = true, children }: {
  id: string; title: string
  /** Accessible name of the section (a region); absent = unnamed. */
  label?: string
  icon: ReactNode; summary: string
  /** Something needs a look (shown closed as a warning sign with this text as tooltip). */
  attention?: string
  /** Shown in the header while closed (e.g. the level meter). */
  accessory?: ReactNode
  initiallyOpen?: boolean; children: ReactNode
}) {
  const [open, setOpen] = useOpen(id, initiallyOpen)
  const bodyId = useId()
  return (
    // Named (a landmark region) only when asked: « Micro » would clash with the micro menu's own name.
    <section className={open ? 'insp-section is-open' : 'insp-section'} {...(label ? { 'aria-label': label } : {})}>
      <h3 className="insp-head">
        <button type="button" className="insp-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}
          // Closed: « Titre : résumé » (open, the name comes from the title text, not clashing with « Micro » the menu).
          {...(open ? {} : { 'aria-label': `${title} : ${[summary, attention].filter(Boolean).join('. ')}` })}>
          <ChevronRightIcon size={10} strokeWidth={2} className="insp-chevron" />
          {icon}
          <span className="insp-title">{title}</span>
          {!open && attention && <span className="insp-attention" title={attention}><WarningIcon size={12} /></span>}
          {!open && <span className="insp-summary" title={summary}>{summary}</span>}
        </button>
        {!open && accessory && <span className="insp-accessory">{accessory}</span>}
      </h3>
      <div id={bodyId} className="insp-body" hidden={!open}>{children}</div>
    </section>
  )
}

/** Icon-only button that opens a « Paramètres… » sheet (its name stays the full action for screen readers). */
function SettingsButton({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick(): void }) {
  return (
    <Button variant="plain" className="insp-icon-btn" aria-label={label} title={label} disabled={disabled} onClick={onClick}
      icon={<SlidersIcon size={14} />} />
  )
}

/* ---------- Fields ---------- */

/** Font size field: saved only once it is a whole number within range (typing « 4 » on the way to 48 saves nothing). */
function FontSize({ value, disabled, onChange }: { value: number; disabled: boolean; onChange(v: number): void }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const valid = (s: string): number | null => {
    const n = Number(s)
    return s.trim() !== '' && Number.isInteger(n) && n >= SUBTITLE_FONT_SIZE_MIN && n <= SUBTITLE_FONT_SIZE_MAX ? n : null
  }
  return (
    <label className="insp-row">
      <span className="insp-row-label">Taille</span>
      <span className="insp-size">
        <input className="field-input" type="number" min={SUBTITLE_FONT_SIZE_MIN} max={SUBTITLE_FONT_SIZE_MAX}
          aria-label="Taille de la police (px)" value={draft} disabled={disabled} aria-invalid={valid(draft) === null}
          onChange={(e) => {
            setDraft(e.target.value)
            const n = valid(e.target.value)
            if (n !== null && n !== value) onChange(n)
          }}
          onBlur={() => { if (valid(draft) === null) setDraft(String(value)) }} />
        <span className="insp-unit" aria-hidden="true">px</span>
      </span>
    </label>
  )
}

const LINE_OPTIONS = Array.from({ length: SUBTITLE_LINES_MAX - SUBTITLE_LINES_MIN + 1 }, (_, i) => {
  const n = SUBTITLE_LINES_MIN + i
  return { value: String(n), label: n === 1 ? '1 ligne' : `${n} lignes` }
})

const formatPosition = (v: number): string => (v === 0 ? 'En bas' : v === 100 ? 'En haut' : `${v} %`)

/** Height of the subtitle band in the video (0 bottom … 100 top): each step is applied at once, the preview follows. */
function BandPosition({ value, disabled, onChange }: { value: number; disabled: boolean; onChange(v: number): void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <label className="field band-position">
      <span className="field-label">Position <span className="band-position-value">{formatPosition(draft)}</span></span>
      <input type="range" min={0} max={100} step={1} value={draft} disabled={disabled}
        aria-label="Position du sous-titre dans l’image" aria-valuetext={formatPosition(draft)} title="Double-clic : en bas"
        onChange={(e) => {
          const n = Number(e.target.value)
          setDraft(n)
          if (n !== value) onChange(n)
        }}
        onDoubleClick={() => { setDraft(0); if (value !== 0) onChange(0) }} />
    </label>
  )
}

const formatSmoothing = (ms: number): string =>
  ms === 0 ? 'Direct' : `${(ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} s`

/** Delay the band runs behind LinTO, hiding the words LinTO rewrites within it; 0 = shown at once. */
function Smoothing({ value, disabled, onChange }: { value: number; disabled: boolean; onChange(v: number): void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <label className="field band-position">
      <span className="field-label">Lissage <span className="band-position-value">{formatSmoothing(draft)}</span></span>
      <input type="range" min={0} max={SUBTITLE_SMOOTHING_MAX} step={SUBTITLE_SMOOTHING_STEP} value={draft} disabled={disabled}
        aria-label="Lissage des sous-titres" aria-valuetext={formatSmoothing(draft)}
        title="Plus de retard, lecture plus calme. Double-clic : direct"
        onChange={(e) => {
          const n = Number(e.target.value)
          setDraft(n)
          if (n !== value) onChange(n)
        }}
        onDoubleClick={() => { setDraft(0); if (value !== 0) onChange(0) }} />
    </label>
  )
}

const formatWps = (wps: number): string =>
  wps === 0 ? 'Illimité' : `${wps.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} mots/s`

/** Fastest pace of the words in the band, catching up included (a translation comes a sentence at once); 0 = no limit. */
function MaxWordsPerSecond({ value, disabled, onChange }: { value: number; disabled: boolean; onChange(v: number): void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <label className="field band-position">
      <span className="field-label">Vitesse max. <span className="band-position-value">{formatWps(draft)}</span></span>
      <input type="range" min={0} max={SUBTITLE_MAX_WPS_MAX} step={SUBTITLE_MAX_WPS_STEP} value={draft} disabled={disabled}
        aria-label="Vitesse maximale des sous-titres, en mots par seconde" aria-valuetext={formatWps(draft)}
        title="Les mots n’arrivent jamais plus vite, même pour rattraper un retard. Double-clic : illimité"
        onChange={(e) => {
          const n = Number(e.target.value)
          setDraft(n)
          if (n !== value) onChange(n)
        }}
        onDoubleClick={() => { setDraft(0); if (value !== 0) onChange(0) }} />
    </label>
  )
}

const formatDb = (db: number): string => `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(db)} dB`

/** Micro gain slider: each step is applied (and saved) at once, so the level meter shows its effect while dragging. */
function MicGain({ value, disabled, onChange }: { value: number; disabled: boolean; onChange(v: number): void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <label className="field mic-gain">
      <span className="field-label">Gain <span className="mic-gain-value">{formatDb(draft)}</span></span>
      <input type="range" min={MIC_GAIN_MIN} max={MIC_GAIN_MAX} step={1} value={draft} disabled={disabled}
        aria-label="Gain du micro" aria-valuetext={formatDb(draft)} title="Double-clic : 0 dB"
        onChange={(e) => {
          const n = Number(e.target.value)
          setDraft(n)
          if (n !== value) onChange(n)
        }}
        onDoubleClick={() => { setDraft(0); if (value !== 0) onChange(0) }} />
    </label>
  )
}

/** EXPERIMENTAL: expected proper nouns, one per line; saved when the field loses focus. */
function ProperNouns({ value, disabled, onChange }: { value: string[]; disabled: boolean; onChange(v: string[]): void }) {
  const joined = value.join('\n')
  const [draft, setDraft] = useState(joined)
  useEffect(() => setDraft(joined), [joined])
  const parse = (s: string): string[] => s.split('\n').map((l) => l.trim()).filter(Boolean)
  return (
    <>
      <textarea className="field-input proper-nouns" rows={4} value={draft} disabled={disabled} spellCheck={false}
        aria-label="Noms propres attendus (un par ligne)" placeholder={'Un nom par ligne\nLinagora\nSaint-Brieuc'}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const next = parse(draft)
          if (next.join('\n') !== joined) onChange(next)
        }} />
      <p className="inspector-note">Expérimental : les mots de LinTO qui se prononcent comme l’un de ces noms sont remplacés.</p>
    </>
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

const CAPTURE_LABEL: Record<CaptureKind, string> = { screen: 'Écran', window: 'Fenêtre' }

const encodeSource = (s: VideoSource | undefined): string => {
  if (!s || s.kind === 'none') return 'none'
  if (s.kind === 'device') return `device:${s.id}`
  if (s.kind === 'image' || s.kind === 'video') return `file:${s.path}`
  return `${s.kind}:${s.id}`
}

const sourceName = (s: VideoSource | undefined, devices: { id: string; name: string }[]): string | null => {
  if (!s || s.kind === 'none') return null
  if (s.kind === 'device') return devices.find((d) => d.id === s.id)?.name ?? null
  if (s.kind === 'image' || s.kind === 'video') return baseName(s.path)
  return `${CAPTURE_LABEL[s.kind]} : ${s.name}`
}

/** Video source menu: Aucune, each device, the current file or capture (kept selectable), then the pickers. */
function SourcePopUp({ label, source, devices, disabled, onChange }: {
  label: string; source: VideoSource | undefined; devices: { id: string; name: string }[]; disabled: boolean
  onChange(s: VideoSource): void
}) {
  const [capture, setCapture] = useState<CaptureKind | null>(null)
  const current = source && source.kind !== 'none' && source.kind !== 'device'
    ? [{ value: encodeSource(source), label: sourceName(source, devices) ?? '' }] : []
  const options = [
    { value: 'none', label: 'Aucune' },
    ...devices.map((d) => ({ value: `device:${d.id}`, label: d.name })),
    ...current,
    { value: 'pick:screen', label: 'Écran…' },
    { value: 'pick:window', label: 'Fenêtre…' },
    { value: 'pick:image', label: 'Image…' },
    { value: 'pick:video', label: 'Vidéo…' }
  ]
  const change = (v: string): void => {
    if (v === 'none') onChange({ kind: 'none' })
    else if (v.startsWith('device:')) onChange({ kind: 'device', id: v.slice(7) })
    else if (v === 'pick:screen' || v === 'pick:window') setCapture(v === 'pick:screen' ? 'screen' : 'window')
    else if (v.startsWith('pick:')) {
      const kind = v === 'pick:image' ? 'image' : 'video'
      void window.lintoLive.setup.pickMedia(kind).then((path) => { if (path) onChange({ kind, path }) }, () => {})
    }
  }
  return (
    <>
      <PopUp label={label} className="inspector-control" value={encodeSource(source)} placeholder="Choisir…"
        options={options} disabled={disabled} onChange={change} />
      <CaptureSheet kind={capture} onCancel={() => setCapture(null)}
        onPick={(t) => { const kind = capture!; setCapture(null); onChange({ kind, id: t.id, name: t.name }) }} />
    </>
  )
}

const PENDING_NOTE = 'Réglable une fois la session créée sur LinTO (au démarrage).'

/**
 * Right pane (inspector), in collapsible sections that summarise themselves when closed:
 * Vidéo, Micro, Transcription (profile, subtitles, proper nouns), Incrustations (watermark, QR code),
 * Enregistrement et diffusion (one choice: OBS has a single output for both).
 */
export function Inspector(p: InspectorProps) {
  const { data, settings, profile, onChange } = p
  const opts = (items: { id: string; name: string }[] = []) => items.map((d) => ({ value: d.id, label: d.name }))
  const shown = settings?.subtitlesVisible !== false
  const wm = p.watermark && 'watermark' in p.watermark ? p.watermark.watermark : null
  const wmPending = !!p.watermark && 'pending' in p.watermark
  const qr = { ...DEFAULT_QR, ...settings?.qr }
  const languages = p.languages ?? [{ value: 'original', label: 'Langue originale' }]
  const language = p.languages?.some((l) => l.value === p.language) ? p.language! : 'original'
  const wmEditable = !!wm && p.watermarkBlocked === undefined
  const fontSize = settings?.subtitleFontSize ?? DEFAULT_SUBTITLE_FONT_SIZE
  // The broadcast wins when both are set (OBS has one output for them): the inspector shows it that way.
  const broadcasting = settings?.broadcastEnabled === true
  const recording = settings?.recordEnabled === true && !broadcasting
  const recordDir = settings?.recordDir || data?.defaultRecordDir
  const hasServer = isBroadcastServer(settings?.broadcastServer)
  const host = hasServer ? broadcastHost(settings!.broadcastServer!) : null
  const showWatermark = !!data?.watermarkEnabled && shown
  const qrNotPublic = qr.display && p.visibility !== undefined && p.visibility !== 'public'
    ? 'Le public devra se connecter à LinTO pour ouvrir ce lien : rendre la session publique dans LinTO Studio.' : undefined

  const videoDevices = data?.videoDevices ?? []
  const primary = sourceName(settings?.primarySource, videoDevices)
  const backup = sourceName(settings?.backupSource, videoDevices)
  const videoSummary = [primary ?? 'Aucune', backup ? `secours : ${backup}` : ''].filter(Boolean).join(' · ')
  const micSummary = data?.audioDevices.find((d) => d.id === settings?.audioDeviceId)?.name ?? 'Aucun'
  const transcriptionSummary = [
    profile, shown ? `${languages.find((l) => l.value === language)?.label ?? ''} · ${fontSize} px` : 'Sous-titres masqués'
  ].filter(Boolean).join(' · ')
  const overlays = [showWatermark && wm?.display ? 'Filigrane' : '', qr.display ? 'QR code' : ''].filter(Boolean)
  const outputSummary = [
    broadcasting ? `Diffusion · ${host ?? 'aucun serveur'}` : recording ? 'Enregistrement' : 'Désactivés',
    p.virtualCam ? 'Caméra virtuelle' : ''
  ].filter(Boolean).join(' · ')

  return (
    <aside className="inspector" aria-label="Réglages">
      <Section id="video" title="Vidéo" icon={<CameraIcon size={14} />} summary={videoSummary}>
        {/* Optional: without a source the app is a plain LinTO client (audio only, transcript here). */}
        <SourcePopUp label="Source principale" source={settings?.primarySource} devices={videoDevices}
          disabled={!data} onChange={(v) => onChange({ primarySource: v })} />
        <SourcePopUp label="Source de secours" source={settings?.backupSource} devices={videoDevices}
          disabled={!data} onChange={(v) => onChange({ backupSource: v })} />
        <Check label="Écran noir = source absente" checked={settings?.blackIsAbsent !== false}
          disabled={!settings || !settings.backupSource || settings.backupSource.kind === 'none'}
          onChange={(v) => onChange({ blackIsAbsent: v })} />
        {p.videoOnAir && (
          <p className="inspector-note">À l’antenne : {p.videoOnAir === 'backup' ? 'secours' : 'principale'}</p>
        )}
      </Section>

      <Section id="mic" title="Micro" icon={<MicIcon size={14} />} summary={micSummary} accessory={<VuMeter compact />}>
        <PopUp label="Micro" className="inspector-control" value={settings?.audioDeviceId ?? ''} placeholder="Choisir…"
          options={opts(data?.audioDevices)} disabled={!data} onChange={(v) => onChange({ audioDeviceId: v })} />
        <VuMeter />
        <MicGain value={micGainDb(settings ?? {})} disabled={!settings} onChange={(v) => onChange({ micGainDb: v })} />
        <Check label="Écouter le retour audio" checked={p.audioMonitor === true}
          disabled={!p.onAudioMonitorChange || (!p.audioMonitor && !p.audioMonitorAvailable)}
          onChange={(v) => p.onAudioMonitorChange?.(v)} />
      </Section>

      <Section id="transcription" title="Transcription" label="Sous-titres" icon={<CaptionsIcon size={14} />}
        summary={transcriptionSummary}>
        <div className="insp-row">
          <span className="insp-row-label">Profil</span>
          <span className={profile ? 'inspector-value insp-ellipsis' : 'inspector-value is-empty'} title={profile ?? undefined}>{profile ?? '—'}</span>
        </div>
        <Check label="Afficher le sous-titre" checked={shown} disabled={!settings}
          onChange={(v) => onChange({ subtitlesVisible: v })} />
        {shown && (
          <>
            <label className="insp-row">
              <span className="insp-row-label">Langue</span>
              <PopUp label="Langue affichée" className="inspector-control" value={language}
                options={languages} disabled={!p.languages} onChange={(v) => p.onLanguageChange?.(v)} />
            </label>
            {!data?.watermarkEnabled && wmPending && <p className="inspector-note">{PENDING_NOTE}</p>}
            <FontSize value={fontSize} disabled={!settings} onChange={(v) => onChange({ subtitleFontSize: v })} />
            <label className="insp-row">
              <span className="insp-row-label">Lignes</span>
              <PopUp label="Nombre de lignes du sous-titre" className="inspector-control" value={String(subtitleLines(settings ?? {}))}
                options={LINE_OPTIONS} disabled={!settings} onChange={(v) => onChange({ subtitleLines: Number(v) })} />
            </label>
            <BandPosition value={subtitlePosition(settings ?? {})} disabled={!settings} onChange={(v) => onChange({ subtitlePosition: v })} />
            <Smoothing value={subtitleSmoothingMs(settings ?? {})} disabled={!settings} onChange={(v) => onChange({ subtitleSmoothingMs: v })} />
            <MaxWordsPerSecond value={subtitleMaxWordsPerSecond(settings ?? {})} disabled={!settings} onChange={(v) => onChange({ subtitleMaxWordsPerSecond: v })} />
          </>
        )}
        <Check label="Corriger les noms propres" checked={settings?.properNounsEnabled === true} disabled={!settings}
          onChange={(v) => onChange({ properNounsEnabled: v })} />
        {settings?.properNounsEnabled === true && (
          <ProperNouns value={settings.properNouns ?? []} disabled={false} onChange={(v) => onChange({ properNouns: v })} />
        )}
        {shown && (
          <Button className="inspector-control" disabled={!p.onAir}
            blockedReason={p.clearBlocked} onClick={() => p.onClearTranscript?.()}>
            Effacer la transcription…
          </Button>
        )}
      </Section>

      <Section id="overlays" title="Incrustations" label="Incrustations" icon={<LayersIcon size={14} />} initiallyOpen={false}
        summary={overlays.length ? overlays.join(', ') : 'Aucune'} {...(qrNotPublic ? { attention: qrNotPublic } : {})}>
        {showWatermark && (
          <div className="insp-item">
            <div className="insp-item-head">
              <span className="insp-item-title">Filigrane</span>
              <SettingsButton label="Paramètres du filigrane…" disabled={!wmEditable} onClick={() => p.onWatermarkSettings?.()} />
            </div>
            <div className="insp-checks">
              <Check label="Afficher" ariaLabel="Afficher le filigrane" checked={wm?.display ?? false} disabled={!wmEditable}
                onChange={(v) => p.onWatermarkChange?.({ display: v })} />
              <Check label="Épingler" ariaLabel="Épingler le filigrane" checked={wm?.pinned ?? false} disabled={!wmEditable || !wm?.display}
                onChange={(v) => p.onWatermarkChange?.({ pinned: v })} />
            </div>
            {wm && p.watermarkBlocked && <p className="inspector-note">{p.watermarkBlocked}</p>}
            {wmPending && <p className="inspector-note">{PENDING_NOTE}</p>}
          </div>
        )}
        <div className="insp-item">
          <div className="insp-item-head">
            <span className="insp-item-title">QR code</span>
            <SettingsButton label="Paramètres du QR code…" disabled={!settings} onClick={() => p.onQrSettings?.()} />
          </div>
          <div className="insp-checks">
            <Check label="Afficher" ariaLabel="Afficher le QR code" checked={qr.display} disabled={!settings}
              onChange={(v) => onChange({ qr: { ...qr, display: v } })} />
            <Check label="Épingler" ariaLabel="Épingler le QR code" checked={qr.pinned} disabled={!settings || !qr.display}
              onChange={(v) => onChange({ qr: { ...qr, pinned: v } })} />
          </div>
          {qrNotPublic && <p className="inspector-note">{qrNotPublic}</p>}
        </div>
      </Section>

      <Section id="output" title="Enregistrement et diffusion" label="Enregistrement et diffusion" icon={<BroadcastIcon size={14} />} initiallyOpen={false}
        summary={outputSummary}>
        {/* One OBS output for both: a single choice. */}
        <fieldset className="insp-radios">
          <legend className="sr-only">Pendant le direct</legend>
          <Radio name="output" label="Ni enregistrer ni diffuser" checked={!recording && !broadcasting} disabled={!settings}
            onSelect={() => onChange({ recordEnabled: false, broadcastEnabled: false })} />
          <section className="insp-item" aria-label="Enregistrement">
            <Radio name="output" label="Enregistrer le direct" checked={recording} disabled={!settings}
              onSelect={() => onChange({ recordEnabled: true, broadcastEnabled: false })} />
            <div className="insp-detail">
              <span className="inspector-value inspector-path" title={recordDir}>
                {recordDir && <MiddleEllipsis text={recordDir} />}
              </span>
              <Button className="insp-small-btn" disabled={!settings} title="Dossier des enregistrements" onClick={() => {
                void window.lintoLive.setup.pickFolder().then((dir) => { if (dir) onChange({ recordDir: dir }) }, () => {})
              }}>
                Choisir…
              </Button>
            </div>
          </section>
          <section className="insp-item" aria-label="Diffusion en ligne">
            <Radio name="output" label="Diffuser en ligne" checked={broadcasting} disabled={!settings || (!broadcasting && !hasServer)}
              onSelect={() => onChange({ broadcastEnabled: true, recordEnabled: false })} />
            <div className="insp-detail">
              <span className={hasServer ? 'inspector-value inspector-path' : 'inspector-value inspector-path is-empty'}
                title={hasServer ? settings!.broadcastServer : undefined}>
                {host ?? 'Aucun serveur'}
                {hasServer && !settings?.broadcastKeySet ? ' (sans clé)' : ''}
              </span>
              <SettingsButton label="Paramètres de diffusion…" disabled={!settings} onClick={() => p.onBroadcastSettings?.()} />
            </div>
          </section>
        </fieldset>
        {p.onAir && <p className="inspector-note">S’applique au prochain Démarrer.</p>}
        {/* Independent of the radios: OBS's virtual camera is an output of its own, applied at once. */}
        <Check label="Caméra virtuelle" checked={p.virtualCam === true}
          disabled={!p.onVirtualCamChange || (!p.virtualCam && !p.virtualCamAvailable)}
          {...(p.virtualCamBlocked && !p.virtualCam ? { blockedReason: p.virtualCamBlocked } : {})}
          onChange={(v) => p.onVirtualCamChange?.(v)} />
      </Section>
    </aside>
  )
}
