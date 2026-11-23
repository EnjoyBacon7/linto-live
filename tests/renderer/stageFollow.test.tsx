// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Stage } from '../../src/renderer/main/Stage'
import { makeApi, withEvents } from './helpers'

const protoDescs = {
  scrollHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight'),
  clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
}
afterEach(() => {
  cleanup()
  for (const [k, d] of Object.entries(protoDescs)) {
    if (d) Object.defineProperty(HTMLElement.prototype, k, d)
    else delete (HTMLElement.prototype as any)[k]
  }
})
const seg = (id: number) => ({ id, text: 't' + id, at: 1000 * id })
function setup(finals: any[]) {
  const api = makeApi({ live: { getTranscript: vi.fn().mockResolvedValue({ finals, partial: null }) } as any })
  const emit = withEvents(api)
  ;(window as any).lintoLive = api
  const r = render(<Stage onAir={true} hasCamera={false} sessionName={null} sessionId={null} banners={null} />)
  return { emit, r }
}

describe('Stage auto-follow', () => {
  it('follows again after the transcript was emptied while scrolled up', async () => {
    const { emit, r } = setup([seg(1), seg(2)])
    await act(async () => { await Promise.resolve() })
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return 1000 } })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 100 } })
    let log = r.container.querySelector('[role=log]') as HTMLElement
    log.scrollTop = 0
    fireEvent.scroll(log)
    expect(screen.queryByText('Revenir au direct')).toBeTruthy()
    act(() => emit('transcript', { kind: 'reset' }))
    expect(r.container.querySelector('[role=log]')).toBeNull()
    act(() => emit('transcript', { kind: 'final', segment: seg(3) }))
    log = r.container.querySelector('[role=log]') as HTMLElement
    expect(log.scrollTop).toBe(1000)
    expect(screen.queryByText('Revenir au direct')).toBeNull()
  })
})
