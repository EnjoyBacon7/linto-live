// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Stage } from '../../src/renderer/main/Stage'
import { makeApi, withEvents } from './helpers'

afterEach(cleanup)
const seg = (id: number) => ({ id, text: 't' + id, at: 1000 * id })
function setup(finals: any[]) {
  const api = makeApi({ live: { getTranscript: vi.fn().mockResolvedValue({ finals, partial: null }) } as any })
  const emit = withEvents(api)
  ;(window as any).lintoLive = api
  const r = render(<Stage onAir={true} hasCamera={false} sessionName={null} sessionId={null} banners={null} />)
  return { emit, r }
}

describe('Stage transcript rows', () => {
  it('at the view cap, a new final keeps the other rows mounted (same DOM nodes)', async () => {
    const N = 5000
    const { emit, r } = setup(Array.from({ length: N }, (_, i) => seg(i)))
    await act(async () => { await Promise.resolve() })
    const log = r.container.querySelector('[role=log]')!
    const before = Array.from(log.querySelectorAll('.transcript-turn'))
    expect(before.length).toBe(N)
    act(() => emit('transcript', { kind: 'final', segment: seg(N) }))
    const after = Array.from(log.querySelectorAll('.transcript-turn'))
    expect(after.length).toBe(N)
    expect(after.filter((n) => before.includes(n)).length).toBe(N - 1)
  })

  it('rows with the same LinTO id (after a resume) are all rendered', async () => {
    const { r } = setup([seg(1), { ...seg(1), text: 'again', at: 9000 }])
    await act(async () => { await Promise.resolve() })
    expect(r.container.querySelectorAll('.transcript-turn').length).toBe(2)
  })
})
