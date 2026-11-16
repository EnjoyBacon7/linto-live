import { describe, expect, it } from 'vitest'
import { exportFileName, exportTranscript } from '../../src/main/linto/transcriptExport'
import type { Transcript } from '../../src/shared/types'

const T0 = new Date(2026, 10, 10, 14, 0, 0).getTime()

const transcript: Transcript = {
  sessionName: 'Conf/du lundi',
  startedAt: T0,
  finals: [
    { id: 1, text: 'Bonjour à tous', at: T0 + 1_500, endAt: T0 + 3_000, lang: 'fr-FR', locutor: 'Alice' },
    { id: 2, text: 'Welcome <everyone> & co', at: T0 + 65_000, endAt: T0 + 67_250, lang: 'en-US', locutor: 'Alice' },
    { id: 3, text: 'Sans fin connue', at: T0 + 3_600_000, lang: 'en-US' }
  ],
  partial: { id: 4, text: 'pas fini', at: T0 + 3_601_000 }
}

describe('exportTranscript', () => {
  it('txt: wall-clock time, speaker, language where it changes', () => {
    expect(exportTranscript(transcript, 'txt')).toBe([
      'Conf/du lundi — 2026-11-10 14:00:00',
      '',
      '[14:00:01] Alice (fr-FR) Bonjour à tous',
      '[14:01:05] Alice (en-US) Welcome <everyone> & co',
      '[15:00:00] (en-US) Sans fin connue',
      ''
    ].join('\n'))
  })

  it('srt: cues timed from the start of the show; no partial', () => {
    expect(exportTranscript(transcript, 'srt')).toBe([
      '1', '00:00:01,500 --> 00:00:03,000', 'Alice : Bonjour à tous', '',
      '2', '00:01:05,000 --> 00:01:07,250', 'Alice : Welcome <everyone> & co', '',
      '3', '01:00:00,000 --> 01:00:03,000', 'Sans fin connue', ''
    ].join('\n'))
  })

  it('vtt: escaped text with voice and language tags', () => {
    const vtt = exportTranscript(transcript, 'vtt')
    expect(vtt.startsWith('WEBVTT\n\n00:00:01.500 --> 00:00:03.000\n<lang fr-FR><v Alice>Bonjour à tous</lang>\n')).toBe(true)
    expect(vtt).toContain('<v Alice>Welcome &lt;everyone&gt; &amp; co')
    expect(vtt).not.toContain('pas fini')
  })

  it('json: ISO dates, offsets and every field', () => {
    const j = JSON.parse(exportTranscript(transcript, 'json'))
    expect(j.session).toBe('Conf/du lundi')
    expect(j.startedAt).toBe(new Date(T0).toISOString())
    expect(j.segments).toHaveLength(3)
    expect(j.segments[0]).toEqual({
      id: 1, start: new Date(T0 + 1_500).toISOString(), end: new Date(T0 + 3_000).toISOString(),
      offset: 1.5, duration: 1.5, lang: 'fr-FR', speaker: 'Alice', text: 'Bonjour à tous'
    })
  })

  it('never times a cue before 0 when LinTO dates a segment before the local start', () => {
    const t: Transcript = { startedAt: T0, finals: [{ id: 1, text: 'tôt', at: T0 - 800, endAt: T0 + 200 }], partial: null }
    expect(exportTranscript(t, 'srt')).toContain('00:00:00,000 --> 00:00:01,000')
  })
})

describe('exportTranscript: dropped segments are flagged', () => {
  const short: Transcript = { sessionName: 'Conf', startedAt: T0, dropped: 12, finals: [transcript.finals[0]], partial: null }
  it('txt, vtt and json say how many segments are missing; an untruncated export does not', () => {
    expect(exportTranscript(short, 'txt')).toContain("les 12 premiers segments de la session n'ont pas été conservés")
    expect(exportTranscript(short, 'vtt')).toMatch(/^WEBVTT\n\nNOTE Transcription incomplète/)
    expect(JSON.parse(exportTranscript(short, 'json')).droppedSegments).toBe(12)
    expect(JSON.parse(exportTranscript(transcript, 'json'))).not.toHaveProperty('droppedSegments')
    expect(exportTranscript(transcript, 'txt')).not.toContain('incomplète')
  })
})

describe('exportFileName', () => {
  it('session name and local date, file-system safe', () => {
    expect(exportFileName(transcript, 'srt')).toBe('Conf-du lundi - 2026-11-10.srt')
    expect(exportFileName({ finals: [], partial: null }, 'txt')).toBe('Transcription.txt')
  })
})
