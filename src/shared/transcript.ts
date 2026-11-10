import type { Transcript, TranscriptSegment, TranscriptUpdate } from './types'

/** Finalized segments kept for the main window (a long day of speech is a few thousand). */
export const TRANSCRIPT_MAX_SEGMENTS = 5000

/** Applies an update to a transcript (the renderer's copy). */
export function applyTranscriptUpdate(t: Transcript, u: TranscriptUpdate, max = TRANSCRIPT_MAX_SEGMENTS): Transcript {
  switch (u.kind) {
    case 'reset': {
      const r: Transcript = { finals: [], partial: null }
      if (u.sessionName !== undefined) r.sessionName = u.sessionName
      if (u.startedAt !== undefined) r.startedAt = u.startedAt
      return r
    }
    case 'partial': return { ...t, partial: u.segment }
    case 'final': {
      const finals = t.finals.length >= max ? [...t.finals.slice(t.finals.length - max + 1), u.segment] : [...t.finals, u.segment]
      return { ...t, finals, partial: null }
    }
  }
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')

/** Local wall-clock time of a segment, HH:MM:SS (as LinTO Studio shows it). */
export function clockTime(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** A pause longer than this within one speaker's turn shows the time again (as on LinTO Studio). */
const PAUSE_MS = 5000

/**
 * Which labels a segment shows, with LinTO Studio's rules: the time on every segment unless the same
 * diarized speaker goes on (in the same language, without a long pause); the language and the speaker where
 * they change.
 */
export function segmentLabels(s: TranscriptSegment, prev?: TranscriptSegment): { time: boolean; lang: boolean; speaker: boolean } {
  const speaker = s.locutor ?? null
  const prevSpeaker = prev?.locutor ?? null
  const lang = s.lang ?? null
  const prevLang = prev?.lang ?? null
  const changed = speaker !== prevSpeaker || lang !== prevLang
  const pause = !!prev && s.at - (prev.endAt ?? prev.at) > PAUSE_MS
  return {
    time: !prev || !speaker || changed || pause,
    lang: !!lang && changed,
    speaker: !!speaker && speaker !== prevSpeaker
  }
}
