import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { applyTranscriptUpdate, clockTime, segmentLabels } from '../../shared/transcript'
import type { Transcript as TranscriptData, TranscriptExportFormat, TranscriptSegment } from '../../shared/types'
import { ipcErrorMessage } from '../ipcError'
import { PopUp, type PopUpOption } from '../ui/PopUp'

export interface StageProps {
  /** A show is on air (changes the empty-state wording only). */
  onAir: boolean
  /** A camera is chosen: its preview (the OBS program output) shows above the transcript. */
  hasCamera: boolean
  /** Session selected in the sidebar (null: none). The transcript shows only if it belongs to it. */
  sessionName: string | null
  /** Its LinTO id (null: unknown yet): off air, its transcript is loaded from LinTO. */
  sessionId: string | null
  banners: ReactNode
}

const EMPTY: TranscriptData = { finals: [], partial: null }
/** Within this distance of the bottom, the view follows new words. */
const STICK_PX = 40

/**
 * Transcript of the show on air (or of the last one): fetched on mount, then kept up to date by the
 * 'transcript' events. Events received before the fetch answers are already in its snapshot (IPC keeps order).
 */
function useTranscript(): TranscriptData {
  const [t, setT] = useState<TranscriptData>(EMPTY)
  useEffect(() => {
    let alive = true
    const off = window.lintoLive.on('transcript', (u) => setT((cur) => applyTranscriptUpdate(cur, u)))
    window.lintoLive.live.getTranscript()
      .then((snap) => { if (alive) setT(snap) })
      .catch(() => {})
    return () => { alive = false; off() }
  }, [])
  return t
}

/**
 * Off air, the selected session's transcript comes from LinTO (main replaces its copy and sends it as a
 * 'transcript' event). Returns whether it is loading, and the error if it could not be loaded.
 */
function useSessionTranscript(sessionId: string | null, onAir: boolean): { loading: boolean; error: string | null } {
  const [st, setSt] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null })
  useEffect(() => {
    if (onAir || !sessionId) { setSt({ loading: false, error: null }); return }
    let alive = true
    setSt({ loading: true, error: null })
    window.lintoLive.live.viewTranscript(sessionId)
      .then(() => { if (alive) setSt({ loading: false, error: null }) })
      .catch((e) => { if (alive) setSt({ loading: false, error: ipcErrorMessage(e) }) })
    return () => { alive = false }
  }, [sessionId, onAir])
  return st
}

/** Camera preview: main polls OBS for it only while it is displayed. */
function CameraPreview() {
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    const off = window.lintoLive.on('preview', setPreview)
    void window.lintoLive.preview.subscribe().catch(() => {})
    return () => {
      off()
      void window.lintoLive.preview.unsubscribe().catch(() => {})
    }
  }, [])
  return (
    <figure className="stage-preview">
      <div className="stage-frame">
        {preview
          ? <img src={preview} alt="Aperçu de la caméra" draggable={false} />
          : <span className="stage-frame-placeholder">Aperçu en attente…</span>}
      </div>
    </figure>
  )
}

/**
 * One segment as on LinTO Studio: time and language in a side column, the speaker above the text where it
 * changes (LinTO only names speakers when the session diarizes).
 */
const Segment = memo(function Segment({ s, prev, partial }: { s: TranscriptSegment; prev?: TranscriptSegment; partial?: boolean }) {
  const l = segmentLabels(s, prev)
  const time = clockTime(s.at)
  return (
    <div className={l.speaker || l.lang ? 'transcript-turn is-new-turn' : 'transcript-turn'}>
      <div className="transcript-meta">
        {l.time && <time className="transcript-time" dateTime={new Date(s.at).toISOString()}>{time}</time>}
        {l.lang && <span className="transcript-lang">{s.lang}</span>}
      </div>
      <div className="transcript-content">
        {l.speaker && <p className="transcript-speaker">{s.locutor}</p>}
        <p className={partial ? 'transcript-segment is-partial' : 'transcript-segment'}>{s.text}</p>
      </div>
    </div>
  )
})

const EXPORT_OPTIONS: PopUpOption[] = [
  { value: 'txt', label: 'Texte (.txt)' },
  { value: 'srt', label: 'Sous-titres SubRip (.srt)' },
  { value: 'vtt', label: 'Sous-titres WebVTT (.vtt)' },
  { value: 'json', label: 'JSON (.json)' }
]

/** Once the show has ended: « Exporter » the transcript (native save dialog in main). */
function ExportBar({ count }: { count: number }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(null)
  const run = async (format: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    setNote(null)
    try {
      const r = await window.lintoLive.live.exportTranscript(format as TranscriptExportFormat)
      if (r.saved) setNote({ error: false, text: 'Transcription exportée.' })
    } catch (e) {
      setNote({ error: true, text: ipcErrorMessage(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="transcript-export">
      <span className="transcript-export-label">
        Transcription terminée · {count} segment{count > 1 ? 's' : ''}
      </span>
      {note && (
        <span className={note.error ? 'transcript-export-note is-error' : 'transcript-export-note'} role="status">
          {note.text}
        </span>
      )}
      <PopUp label="Exporter la transcription" value="" placeholder="Exporter…" options={EXPORT_OPTIONS}
        disabled={busy} onChange={(v) => void run(v)} />
    </div>
  )
}

/**
 * Row keys that do not depend on the array index (the oldest final drops at the cap, which shifts every
 * index) nor on `id` (LinTO numbers segments per run: the same id comes back after a resume). One sequence
 * number per segment object, which the transcript copy keeps across updates.
 */
const rowKeys = new WeakMap<TranscriptSegment, number>()
let nextRowKey = 0
function rowKey(s: TranscriptSegment): number {
  let k = rowKeys.get(s)
  if (k === undefined) { k = nextRowKey++; rowKeys.set(s, k) }
  return k
}

/** Finalized segments only change on a final: partials (several per second) do not re-render them. */
const Finals = memo(function Finals({ finals }: { finals: TranscriptSegment[] }) {
  return <>{finals.map((s, i) => <Segment key={rowKey(s)} s={s} prev={finals[i - 1]} />)}</>
})

/** Centre: banners on top, the camera preview (when a camera is chosen), then the live transcript with its history. */
export function Stage({ onAir, hasCamera, sessionName, sessionId, banners }: StageProps) {
  const live = useTranscript()
  const loaded = useSessionTranscript(sessionId, onAir)
  // Main keeps one session's transcript: another one selected shows nothing until LinTO's has loaded.
  const mine = onAir || sessionName === null || live.sessionName === undefined || live.sessionName === sessionName
  const t = mine ? live : EMPTY
  const scroller = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)
  const followingRef = useRef(true)
  const empty = t.finals.length === 0 && !t.partial

  const toBottom = (): void => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }
  // New words: stay at the bottom unless the user scrolled up to read back.
  useLayoutEffect(() => { if (followingRef.current) toBottom() }, [t])
  const onScroll = (): void => {
    const el = scroller.current
    if (!el) return
    const f = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX
    followingRef.current = f
    setFollowing(f)
  }
  const resume = (): void => {
    followingRef.current = true
    setFollowing(true)
    toBottom()
  }

  return (
    <section className="stage" aria-label="Transcription">
      {banners && <div className="stage-banners">{banners}</div>}
      {hasCamera && <CameraPreview />}
      <div className="stage-body">
        {empty ? (
          <p className="stage-placeholder">
            {onAir ? 'En attente de paroles…'
              : loaded.loading ? 'Chargement de la transcription…'
                : loaded.error ? `Transcription indisponible : ${loaded.error}`
                  : 'La transcription s’affichera ici au démarrage du direct.'}
          </p>
        ) : (
          <div ref={scroller} className="transcript selectable" role="log" aria-live="polite" onScroll={onScroll}>
            <Finals finals={t.finals} />
            {t.partial && <Segment s={t.partial} prev={t.finals[t.finals.length - 1]} partial />}
          </div>
        )}
        {!empty && !following && (
          <button type="button" className="transcript-resume" onClick={resume}>Revenir au direct</button>
        )}
      </div>
      {!onAir && t.finals.length > 0 && <ExportBar count={t.finals.length + (t.dropped ?? 0)} />}
    </section>
  )
}
