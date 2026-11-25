// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { Stage } from '../../src/renderer/main/Stage'
import { makeApi, withEvents } from './helpers'

afterEach(cleanup)

describe('transcript live region (A-005)', () => {
  it('keeps the in-progress partial out of the announced text', async () => {
    const api = makeApi({ live: { getTranscript: vi.fn().mockResolvedValue({ finals: [{ id: 0, text: 'final', at: 900 }], partial: null }) } as any })
    const emit = withEvents(api)
    ;(window as any).lintoLive = api
    const r = render(<Stage onAir={true} hasCamera={false} sessionName={null} sessionId={null} banners={null} />)
    await act(async () => { await Promise.resolve() })
    act(() => emit('transcript', { kind: 'partial', segment: { id: 1, text: 'bonjour', at: 1000 } }))
    const log = r.container.querySelector('[role=log]')!
    expect(log.getAttribute('aria-live')).toBe('polite')
    const partial = log.querySelector('.is-partial')!
    expect(partial.closest('[aria-hidden=true]')).not.toBeNull()
    const final = log.querySelector('.transcript-segment:not(.is-partial)')!
    expect(final.closest('[aria-hidden=true]')).toBeNull()
  })
})
