import { TRANSCRIPT_LOG_MAX_SEGMENTS } from '../../shared/transcript'
import type { Transcript, TranscriptSegment, TranscriptUpdate } from '../../shared/types'
import type { CaptionEvent } from './captions'

/** `astart` + `offset` s as ms epoch (how LinTO Studio dates a segment), or null when LinTO did not send them. */
function absolute(astart: CaptionEvent['astart'], offset: CaptionEvent['start']): number | null {
  if (!astart || typeof offset !== 'number' || !Number.isFinite(offset)) return null
  const base = Date.parse(astart)
  return Number.isFinite(base) ? base + offset * 1000 : null
}

/**
 * Identity of a final within a session: LinTO numbers segments per transcription run (`astart`), so the same
 * `segmentId` comes back after the stream stops and resumes. Null without `astart`: such a final is never
 * taken for another one.
 */
function keyOf(e: CaptionEvent): string | null {
  const base = e.astart ? Date.parse(e.astart) : NaN
  return Number.isFinite(base) ? `${base}#${e.segmentId}` : null
}

/** LinTO's markers between transcription runs, not speech. */
const isMarker = (e: CaptionEvent): boolean => e.locutor === 'bot'

/** History of the show's transcription; each change returns the update to send to the renderer (null: none). */
export class TranscriptLog {
  private finals: TranscriptSegment[] = []
  /** keyOf() of each final (same order as `finals`). */
  private keys: (string | null)[] = []
  private known = new Set<string>()
  /** Oldest finals of the show dropped past `max`. */
  private dropped = 0
  private pending: TranscriptSegment | null = null
  private show: { sessionName?: string; startedAt?: number } = {}

  constructor(private readonly max = TRANSCRIPT_LOG_MAX_SEGMENTS, private readonly now: () => number = Date.now) {}

  private segment(e: CaptionEvent, final: boolean): TranscriptSegment | null {
    const text = e.text?.trim() ?? ''
    if (!text) return null
    // Without LinTO's timing, a segment is dated when its first partial arrived.
    const seen = this.pending?.id === e.segmentId ? this.pending.at : this.now()
    const s: TranscriptSegment = { id: e.segmentId, text, at: absolute(e.astart, e.start) ?? seen }
    if (final) s.endAt = Math.max(s.at, absolute(e.astart, e.end) ?? this.now())
    if (e.lang) s.lang = e.lang
    if (e.locutor) s.locutor = e.locutor
    return s
  }

  partial(e: CaptionEvent): TranscriptUpdate | null {
    const s = this.segment(e, false)
    if (!s) return null
    this.pending = s
    return { kind: 'partial', segment: s }
  }

  final(e: CaptionEvent): TranscriptUpdate | null {
    if (isMarker(e)) return null
    const key = keyOf(e)
    // Already there (loaded from LinTO's history while it was being said).
    if (key !== null && this.known.has(key)) return null
    const s = this.segment(e, true)
    if (!s) return null
    this.pending = null
    this.finals.push(s)
    this.keys.push(key)
    if (key !== null) this.known.add(key)
    this.trim()
    return { kind: 'final', segment: s }
  }

  private trim(): void {
    if (this.finals.length <= this.max) return
    const extra = this.finals.length - this.max
    this.finals.splice(0, extra)
    for (const k of this.keys.splice(0, extra)) if (k !== null) this.known.delete(k)
    this.dropped += extra
  }

  /**
   * The captions LinTO stored for the session (oldest first): they come before the finals received live
   * (a final in both counts once), so a resumed or reselected session shows everything said so far.
   */
  history(captions: CaptionEvent[]): TranscriptUpdate {
    const finals: TranscriptSegment[] = []
    const keys: (string | null)[] = []
    const index = new Map<string, number>()
    for (const e of captions) {
      if (isMarker(e)) continue
      const s = this.segment(e, true)
      if (!s) continue
      const key = keyOf(e)
      const at = key === null ? undefined : index.get(key)
      // LinTO may store one segment twice (e.g. a line with the speaker, another with the translations).
      if (at !== undefined) { if (!finals[at]!.locutor && s.locutor) finals[at] = s; continue }
      if (key !== null) index.set(key, finals.length)
      finals.push(s)
      keys.push(key)
    }
    this.finals.forEach((s, i) => {
      const key = this.keys[i] ?? null
      if (key !== null && index.has(key)) return
      finals.push(s)
      keys.push(key)
    })
    this.finals = finals
    this.keys = keys
    this.known = new Set(keys.filter((k): k is string => k !== null))
    this.dropped = 0
    this.trim()
    return { kind: 'snapshot', transcript: this.snapshot() }
  }

  /** A new show begins (its session name and start time go with the transcript, e.g. for the export). */
  reset(sessionName?: string, startedAt?: number): TranscriptUpdate {
    this.finals = []
    this.keys = []
    this.known.clear()
    this.dropped = 0
    this.pending = null
    this.show = {}
    if (sessionName !== undefined) this.show.sessionName = sessionName
    if (startedAt !== undefined) this.show.startedAt = startedAt
    return { kind: 'reset', ...this.show }
  }

  /** Drops the partial (the show stopped: it will never be finalized). */
  endPartial(): TranscriptUpdate | null {
    if (!this.pending) return null
    this.pending = null
    return { kind: 'partial', segment: null }
  }

  snapshot(): Transcript {
    const t: Transcript = { finals: [...this.finals], partial: this.pending, ...this.show }
    if (this.dropped > 0) t.dropped = this.dropped
    return t
  }
}
