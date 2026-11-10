import { TRANSCRIPT_MAX_SEGMENTS } from '../../shared/transcript'
import type { Transcript, TranscriptSegment, TranscriptUpdate } from '../../shared/types'
import type { CaptionEvent } from './captions'

/** `astart` + `offset` s as ms epoch (how LinTO Studio dates a segment), or null when LinTO did not send them. */
function absolute(astart: CaptionEvent['astart'], offset: CaptionEvent['start']): number | null {
  if (!astart || typeof offset !== 'number' || !Number.isFinite(offset)) return null
  const base = Date.parse(astart)
  return Number.isFinite(base) ? base + offset * 1000 : null
}

/** History of the show's transcription; each change returns the update to send to the renderer (null: none). */
export class TranscriptLog {
  private finals: TranscriptSegment[] = []
  private pending: TranscriptSegment | null = null
  private show: { sessionName?: string; startedAt?: number } = {}

  constructor(private readonly max = TRANSCRIPT_MAX_SEGMENTS, private readonly now: () => number = Date.now) {}

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
    const s = this.segment(e, true)
    if (!s) return null
    this.pending = null
    this.finals.push(s)
    if (this.finals.length > this.max) this.finals.splice(0, this.finals.length - this.max)
    return { kind: 'final', segment: s }
  }

  /** A new show begins (its session name and start time go with the transcript, e.g. for the export). */
  reset(sessionName?: string, startedAt?: number): TranscriptUpdate {
    this.finals = []
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
    return { finals: [...this.finals], partial: this.pending, ...this.show }
  }
}
