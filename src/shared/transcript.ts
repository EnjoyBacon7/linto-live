import type { Transcript, TranscriptUpdate } from './types'

/** Finalized segments kept for the main window (a long day of speech is a few thousand). */
export const TRANSCRIPT_MAX_SEGMENTS = 5000

/** Applies an update to a transcript (the renderer's copy). */
export function applyTranscriptUpdate(t: Transcript, u: TranscriptUpdate, max = TRANSCRIPT_MAX_SEGMENTS): Transcript {
  switch (u.kind) {
    case 'reset': return { finals: [], partial: null }
    case 'partial': return { finals: t.finals, partial: u.segment }
    case 'final': {
      const finals = t.finals.length >= max ? [...t.finals.slice(t.finals.length - max + 1), u.segment] : [...t.finals, u.segment]
      return { finals, partial: null }
    }
  }
}
