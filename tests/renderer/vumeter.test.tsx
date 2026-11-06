// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { VuMeter } from '../../src/renderer/components/VuMeter'
import { makeApi } from './helpers'

afterEach(() => { cleanup() })

it('reflects audio-level events', () => {
  let cb: (db: number) => void = () => {}
  const api = makeApi()
  ;(api.on as unknown as ReturnType<typeof vi.fn>).mockImplementation((evt: string, f: (db: number) => void) => { if (evt === 'audio-level') cb = f; return () => {} })
  window.lintoLive = api
  render(<VuMeter />)
  act(() => cb(-50))
  expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('-50')
})
