import { describe, expect, it } from 'vitest'
import { TranscriptLog } from '../../src/main/linto/transcript'
import { applyTranscriptUpdate } from '../../src/shared/transcript'
import type { Transcript, TranscriptUpdate } from '../../src/shared/types'

describe('TranscriptLog', () => {
  it('keeps finals in order, the latest partial, and trims text', () => {
    const t = new TranscriptLog()
    expect(t.partial({ segmentId: 1, text: ' Bon' })).toEqual({ kind: 'partial', segment: { id: 1, text: 'Bon' } })
    t.final({ segmentId: 1, text: 'Bonjour ', locutor: null })
    t.partial({ segmentId: 2, text: 'à', locutor: 'Bob' })
    expect(t.snapshot()).toEqual({ finals: [{ id: 1, text: 'Bonjour' }], partial: { id: 2, text: 'à', locutor: 'Bob' } })
  })

  it('ignores blank segments', () => {
    const t = new TranscriptLog()
    expect(t.partial({ segmentId: 1, text: '  ' })).toBeNull()
    expect(t.final({ segmentId: 1, text: '' })).toBeNull()
    expect(t.endPartial()).toBeNull()
    expect(t.snapshot()).toEqual({ finals: [], partial: null })
  })

  it('keeps at most `max` finals, dropping the oldest', () => {
    const t = new TranscriptLog(3)
    for (let i = 1; i <= 5; i++) t.final({ segmentId: i, text: `s${i}` })
    expect(t.snapshot().finals.map((s) => s.id)).toEqual([3, 4, 5])
  })

  it('reset empties everything', () => {
    const t = new TranscriptLog()
    t.final({ segmentId: 1, text: 'a' })
    t.partial({ segmentId: 2, text: 'b' })
    expect(t.reset()).toEqual({ kind: 'reset' })
    expect(t.snapshot()).toEqual({ finals: [], partial: null })
  })
})

describe('applyTranscriptUpdate', () => {
  it('replays the log updates into the same transcript', () => {
    const log = new TranscriptLog(2)
    let copy: Transcript = { finals: [], partial: null }
    const apply = (u: TranscriptUpdate | null): void => { if (u) copy = applyTranscriptUpdate(copy, u, 2) }
    apply(log.partial({ segmentId: 1, text: 'a' }))
    apply(log.final({ segmentId: 1, text: 'ab' }))
    apply(log.final({ segmentId: 2, text: 'c' }))
    apply(log.final({ segmentId: 3, text: 'd' }))
    apply(log.partial({ segmentId: 4, text: 'e' }))
    expect(copy).toEqual(log.snapshot())
    apply(log.endPartial())
    expect(copy).toEqual(log.snapshot())
    apply(log.reset())
    expect(copy).toEqual({ finals: [], partial: null })
  })
})
