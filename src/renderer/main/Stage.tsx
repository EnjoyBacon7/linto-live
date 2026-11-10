import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { applyTranscriptUpdate, clockTime, segmentLabels } from '../../shared/transcript'
import type { Transcript as TranscriptData, TranscriptExportFormat, TranscriptSegment } from '../../shared/types'
import { ipcErrorMessage } from '../ipcError'
import { PopUp, type PopUpOption } from '../ui/PopUp'

export interface StageProps {
  /** A show is on air (changes the empty-state wording only). */
  onAir: boolean
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
 * One segment as on LinTO Studio: time and language in a side column, the speaker above the text where it
 * changes (LinTO only names speakers when the session diarizes).
 */
function Segment({ s, prev, partial }: { s: TranscriptSegment; prev?: TranscriptSegment; partial?: boolean }) {
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
}

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

/** Finalized segments only change on a final: partials (several per second) do not re-render them. */
const Finals = memo(function Finals({ finals }: { finals: TranscriptSegment[] }) {
  return <>{finals.map((s, i) => <Segment key={`${i}-${s.id}`} s={s} prev={finals[i - 1]} />)}</>
})

/** Centre: banners on top, then the live transcript with its history. */
export function Stage({ onAir, banners }: StageProps) {
  const t = useTranscript()
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
      <div className="stage-body">
        {empty ? (
          <p className="stage-placeholder">
            {onAir ? 'En attente de paroles…' : 'La transcription s’affichera ici au démarrage du direct.'}
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
      {!onAir && t.finals.length > 0 && <ExportBar count={t.finals.length} />}
    </section>
  )
}
