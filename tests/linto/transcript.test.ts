import { describe, expect, it } from 'vitest'
import { TranscriptLog } from '../../src/main/linto/transcript'
import {
  applyTranscriptUpdate, clockTime, segmentLabels, TRANSCRIPT_LOG_MAX_SEGMENTS, TRANSCRIPT_VIEW_MAX_SEGMENTS, trimTranscript
} from '../../src/shared/transcript'
import type { Transcript, TranscriptSegment, TranscriptUpdate } from '../../src/shared/types'

/** A log whose clock is `clock.t` (ms). */
function log(max?: number) {
  const clock = { t: 1_000 }
  return { clock, t: new TranscriptLog(max, () => clock.t) }
}

describe('TranscriptLog', () => {
  it('keeps finals in order, the latest partial, and trims text', () => {
    const { t } = log()
    expect(t.partial({ segmentId: 1, text: ' Bon' })).toEqual({ kind: 'partial', segment: { id: 1, text: 'Bon', at: 1_000 } })
    t.final({ segmentId: 1, text: 'Bonjour ', locutor: null })
    t.partial({ segmentId: 2, text: 'à', locutor: 'Bob' })
    expect(t.snapshot()).toEqual({
      finals: [{ id: 1, text: 'Bonjour', at: 1_000, endAt: 1_000 }],
      partial: { id: 2, text: 'à', at: 1_000, locutor: 'Bob' }
    })
  })

  it('dates segments with LinTO astart + start/end, and keeps the language', () => {
    const { t } = log()
    const astart = '2026-11-10T09:00:00.000Z'
    const base = Date.parse(astart)
    const u = t.final({ segmentId: 7, text: 'Hello', astart, start: 61.25, end: 63, lang: 'en-US' })
    expect(u).toEqual({ kind: 'final', segment: { id: 7, text: 'Hello', at: base + 61_250, endAt: base + 63_000, lang: 'en-US' } })
  })

  it('without LinTO timing, a segment is dated by its first partial and ends when finalized', () => {
    const { t, clock } = log()
    t.partial({ segmentId: 1, text: 'a' })
    clock.t = 2_000
    expect(t.partial({ segmentId: 1, text: 'ab' })).toMatchObject({ segment: { at: 1_000 } })
    clock.t = 3_500
    expect(t.final({ segmentId: 1, text: 'abc' })).toMatchObject({ segment: { at: 1_000, endAt: 3_500 } })
    expect(t.partial({ segmentId: 2, text: 'd' })).toMatchObject({ segment: { at: 3_500 } })
    // A broken astart falls back to the local clock.
    expect(t.final({ segmentId: 3, text: 'e', astart: 'pas une date', start: 1 })).toMatchObject({ segment: { at: 3_500 } })
  })

  it('ignores blank segments', () => {
    const { t } = log()
    expect(t.partial({ segmentId: 1, text: '  ' })).toBeNull()
    expect(t.final({ segmentId: 1, text: '' })).toBeNull()
    expect(t.endPartial()).toBeNull()
    expect(t.snapshot()).toEqual({ finals: [], partial: null })
  })

  it('keeps at most `max` finals, dropping the oldest', () => {
    const { t } = log(3)
    for (let i = 1; i <= 5; i++) t.final({ segmentId: i, text: `s${i}` })
    expect(t.snapshot().finals.map((s) => s.id)).toEqual([3, 4, 5])
    expect(t.snapshot().dropped).toBe(2)
    t.reset('Next')
    expect(t.snapshot().dropped).toBeUndefined()
  })

  it('keeps far more than the window shows: a 5,001-final show loses nothing (issue #7)', () => {
    expect(TRANSCRIPT_LOG_MAX_SEGMENTS).toBeGreaterThan(TRANSCRIPT_VIEW_MAX_SEGMENTS * 10)
    const t = new TranscriptLog()
    for (let i = 0; i <= TRANSCRIPT_VIEW_MAX_SEGMENTS; i++) t.final({ segmentId: i, text: `phrase ${i}` })
    const snap = t.snapshot()
    expect(snap.finals).toHaveLength(TRANSCRIPT_VIEW_MAX_SEGMENTS + 1)
    expect(snap.finals[0].text).toBe('phrase 0')
    expect(snap.dropped).toBeUndefined()
  })

  it('reset empties everything and records the new show', () => {
    const { t } = log()
    t.final({ segmentId: 1, text: 'a' })
    t.partial({ segmentId: 2, text: 'b' })
    expect(t.reset('Conf', 42)).toEqual({ kind: 'reset', sessionName: 'Conf', startedAt: 42 })
    expect(t.snapshot()).toEqual({ finals: [], partial: null, sessionName: 'Conf', startedAt: 42 })
    expect(t.reset()).toEqual({ kind: 'reset' })
    expect(t.snapshot()).toEqual({ finals: [], partial: null })
  })
})

describe('applyTranscriptUpdate', () => {
  it('replays the log updates into the same transcript', () => {
    const { t: l } = log(2)
    let copy: Transcript = { finals: [], partial: null }
    const apply = (u: TranscriptUpdate | null): void => { if (u) copy = applyTranscriptUpdate(copy, u, 2) }
    apply(l.reset('Conf', 5))
    apply(l.partial({ segmentId: 1, text: 'a' }))
    apply(l.final({ segmentId: 1, text: 'ab', lang: 'fr-FR' }))
    apply(l.final({ segmentId: 2, text: 'c' }))
    apply(l.final({ segmentId: 3, text: 'd' }))
    apply(l.partial({ segmentId: 4, text: 'e' }))
    expect(copy).toEqual(l.snapshot())
    apply(l.endPartial())
    expect(copy).toEqual(l.snapshot())
    apply(l.reset())
    expect(copy).toEqual({ finals: [], partial: null })
  })
})

describe('trimTranscript / view cap', () => {
  it('keeps the newest finals and counts the dropped ones', () => {
    const f = (id: number): TranscriptSegment => ({ id, text: `s${id}`, at: id })
    const t: Transcript = { finals: [f(1), f(2), f(3)], partial: null, dropped: 4 }
    expect(trimTranscript(t, 5)).toBe(t)
    expect(trimTranscript(t, 2)).toEqual({ finals: [f(2), f(3)], partial: null, dropped: 5 })
  })
  it('the view copy stays capped while tracking what it no longer shows', () => {
    let copy: Transcript = { finals: [], partial: null }
    for (let i = 1; i <= 4; i++) copy = applyTranscriptUpdate(copy, { kind: 'final', segment: { id: i, text: 'x', at: i } }, 2)
    expect(copy.finals.map((s) => s.id)).toEqual([3, 4])
    expect(copy.dropped).toBe(2)
  })
})

describe('clockTime', () => {
  it('formats the local time as HH:MM:SS', () => {
    expect(clockTime(new Date(2026, 10, 10, 9, 5, 7).getTime())).toBe('09:05:07')
  })
})

describe('segmentLabels (LinTO Studio rules)', () => {
  const seg = (p: Partial<TranscriptSegment>): TranscriptSegment => ({ id: 1, text: 'x', at: 0, ...p })

  it('without diarization: time on every segment, language on the first and where it changes', () => {
    const a = seg({ lang: 'fr-FR' })
    const b = seg({ at: 1_000, lang: 'fr-FR' })
    const c = seg({ at: 2_000, lang: 'en-US' })
    expect(segmentLabels(a)).toEqual({ time: true, lang: true, speaker: false })
    expect(segmentLabels(b, a)).toEqual({ time: true, lang: false, speaker: false })
    expect(segmentLabels(c, b)).toEqual({ time: true, lang: true, speaker: false })
  })

  it('with diarization: labels where the speaker changes, the time again after a pause', () => {
    const a = seg({ locutor: 'Alice', lang: 'fr-FR', endAt: 1_000 })
    const b = seg({ at: 2_000, endAt: 3_000, locutor: 'Alice', lang: 'fr-FR' })
    const c = seg({ at: 9_000, endAt: 10_000, locutor: 'Alice', lang: 'fr-FR' })
    const d = seg({ at: 10_500, locutor: 'Bob', lang: 'fr-FR' })
    expect(segmentLabels(b, a)).toEqual({ time: false, lang: false, speaker: false })
    expect(segmentLabels(c, b)).toEqual({ time: true, lang: false, speaker: false })
    expect(segmentLabels(d, c)).toEqual({ time: true, lang: true, speaker: true })
  })
})
