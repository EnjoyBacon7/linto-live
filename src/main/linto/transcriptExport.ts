import { clockTime, segmentLabels } from '../../shared/transcript'
import type { Transcript, TranscriptExportFormat, TranscriptSegment } from '../../shared/types'

export const EXPORT_FILTERS: Record<TranscriptExportFormat, { name: string; extensions: string[] }> = {
  txt: { name: 'Texte', extensions: ['txt'] },
  srt: { name: 'Sous-titres SubRip', extensions: ['srt'] },
  vtt: { name: 'Sous-titres WebVTT', extensions: ['vtt'] },
  json: { name: 'JSON', extensions: ['json'] }
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')

function localDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** « Conf du lundi - 2026-11-10.srt »: characters no file system accepts become '-'. */
export function exportFileName(t: Transcript, format: TranscriptExportFormat): string {
  const name = (t.sessionName ?? 'Transcription').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim() || 'Transcription'
  const when = t.startedAt ?? t.finals[0]?.at
  return `${when !== undefined ? `${name} - ${localDate(when)}` : name}.${format}`
}

/** Without a known end, a cue lasts until the next segment (at most this long). */
const DEFAULT_CUE_MS = 3000

interface Cue { s: TranscriptSegment; from: number; to: number }

/** Segments as cues timed from the start of the show (subtitle files have no wall-clock time). */
function cues(t: Transcript): Cue[] {
  const f = t.finals
  if (f.length === 0) return []
  // LinTO's clock may be a little ahead of ours: never time a cue before 0.
  const origin = Math.min(t.startedAt ?? f[0].at, f[0].at)
  return f.map((s, i) => {
    const from = s.at - origin
    const next = f[i + 1]?.at
    const end = s.endAt ?? (next !== undefined ? Math.min(next, s.at + DEFAULT_CUE_MS) : s.at + DEFAULT_CUE_MS)
    return { s, from, to: Math.max(from + 1, end - origin) }
  })
}

function cueTime(ms: number, sep: ',' | '.'): string {
  const v = Math.max(0, Math.round(ms))
  const h = Math.floor(v / 3_600_000)
  const m = Math.floor(v / 60_000) % 60
  const s = Math.floor(v / 1000) % 60
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(v % 1000, 3)}`
}

function toTxt(t: Transcript): string {
  const head: string[] = []
  if (t.sessionName) head.push(t.sessionName)
  const when = t.startedAt ?? t.finals[0]?.at
  if (when !== undefined) head.push(`${localDate(when)} ${clockTime(when)}`)
  const lines = t.finals.map((s, i) => {
    const l = segmentLabels(s, t.finals[i - 1])
    const meta = [`[${clockTime(s.at)}]`]
    if (s.locutor) meta.push(s.locutor)
    if (l.lang && s.lang) meta.push(`(${s.lang})`)
    return `${meta.join(' ')} ${s.text}`
  })
  return [...(head.length ? [head.join(' — '), ''] : []), ...lines, ''].join('\n')
}

function toSrt(t: Transcript): string {
  return cues(t).map((c, i) => {
    const text = c.s.locutor ? `${c.s.locutor} : ${c.s.text}` : c.s.text
    return `${i + 1}\n${cueTime(c.from, ',')} --> ${cueTime(c.to, ',')}\n${text}\n`
  }).join('\n')
}

/** WebVTT cue text: '&', '<' and '>' must be escaped; the speaker goes in a voice tag. */
const vttEscape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function toVtt(t: Transcript): string {
  const body = cues(t).map((c) => {
    const text = vttEscape(c.s.text)
    const voiced = c.s.locutor ? `<v ${vttEscape(c.s.locutor)}>${text}` : text
    const lang = c.s.lang ? `<lang ${vttEscape(c.s.lang)}>${voiced}</lang>` : voiced
    return `${cueTime(c.from, '.')} --> ${cueTime(c.to, '.')}\n${lang}\n`
  })
  return ['WEBVTT', '', ...body].join('\n')
}

function toJson(t: Transcript): string {
  const iso = (ms: number | undefined): string | undefined => (ms === undefined ? undefined : new Date(ms).toISOString())
  const segments = cues(t).map((c) => ({
    id: c.s.id,
    start: iso(c.s.at),
    end: iso(c.s.endAt),
    offset: c.from / 1000,
    duration: (c.to - c.from) / 1000,
    lang: c.s.lang,
    speaker: c.s.locutor,
    text: c.s.text
  }))
  return `${JSON.stringify({ session: t.sessionName, startedAt: iso(t.startedAt), segments }, null, 2)}\n`
}

/** The finalized transcript as a file in `format` (an unfinished partial is not part of it). */
export function exportTranscript(t: Transcript, format: TranscriptExportFormat): string {
  switch (format) {
    case 'txt': return toTxt(t)
    case 'srt': return toSrt(t)
    case 'vtt': return toVtt(t)
    case 'json': return toJson(t)
  }
}
