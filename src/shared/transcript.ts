import type { Transcript, TranscriptSegment, TranscriptUpdate } from './types'

/**
 * Finalized segments main keeps for the export: at the rate measured on LinTO (one every 3-5 s, see
 * spikes/RESULTS.md) about 4 days of continuous speech, ~20 MB.
 */
export const TRANSCRIPT_LOG_MAX_SEGMENTS = 100_000
/** Finalized segments the window displays (the export still has them all). */
export const TRANSCRIPT_VIEW_MAX_SEGMENTS = 5000

/** Appends a final, dropping the oldest ones past `max` (counted in `dropped`). */
function pushFinal(t: Transcript, s: TranscriptSegment, max: number): Transcript {
  return trimTranscript({ ...t, finals: [...t.finals, s], partial: null }, max)
}

/** `t` with at most `max` finals: the oldest ones go, counted in `dropped`. */
export function trimTranscript(t: Transcript, max: number): Transcript {
  const extra = t.finals.length - max
  if (extra <= 0) return t
  return { ...t, finals: t.finals.slice(extra), dropped: (t.dropped ?? 0) + extra }
}

/** Applies an update to a transcript (the renderer's copy). */
export function applyTranscriptUpdate(t: Transcript, u: TranscriptUpdate, max = TRANSCRIPT_VIEW_MAX_SEGMENTS): Transcript {
  switch (u.kind) {
    case 'reset': {
      const r: Transcript = { finals: [], partial: null }
      if (u.sessionName !== undefined) r.sessionName = u.sessionName
      if (u.startedAt !== undefined) r.startedAt = u.startedAt
      return r
    }
    case 'partial': return { ...t, partial: u.segment }
    case 'final': return pushFinal(t, u.segment, max)
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
