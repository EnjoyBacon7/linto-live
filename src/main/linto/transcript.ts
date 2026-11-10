import { TRANSCRIPT_MAX_SEGMENTS } from '../../shared/transcript'
import type { Transcript, TranscriptSegment, TranscriptUpdate } from '../../shared/types'
import type { CaptionEvent } from './captions'

function segment(e: CaptionEvent): TranscriptSegment | null {
  const text = e.text?.trim() ?? ''
  if (!text) return null
  return e.locutor ? { id: e.segmentId, text, locutor: e.locutor } : { id: e.segmentId, text }
}

/** History of the show's transcription; each change returns the update to send to the renderer (null: none). */
export class TranscriptLog {
  private finals: TranscriptSegment[] = []
  private pending: TranscriptSegment | null = null

  constructor(private readonly max = TRANSCRIPT_MAX_SEGMENTS) {}

  partial(e: CaptionEvent): TranscriptUpdate | null {
    const s = segment(e)
    if (!s) return null
    this.pending = s
    return { kind: 'partial', segment: s }
  }

  final(e: CaptionEvent): TranscriptUpdate | null {
    const s = segment(e)
    if (!s) return null
    this.pending = null
    this.finals.push(s)
    if (this.finals.length > this.max) this.finals.splice(0, this.finals.length - this.max)
    return { kind: 'final', segment: s }
  }

  reset(): TranscriptUpdate {
    this.finals = []
    this.pending = null
    return { kind: 'reset' }
  }

  /** Drops the partial (the show stopped: it will never be finalized). */
  endPartial(): TranscriptUpdate | null {
    if (!this.pending) return null
    this.pending = null
    return { kind: 'partial', segment: null }
  }

  snapshot(): Transcript {
    return { finals: [...this.finals], partial: this.pending }
  }
}
