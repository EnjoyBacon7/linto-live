import { describe, it, expect, vi, afterEach } from 'vitest'
import { ObsController, type ObsClient } from '../../src/main/obs/controller'

/**
 * A client that behaves like obs-websocket-js 5.0.8 when OBS dies or freezes: the request promise never
 * settles, and a closed socket only emits 'ConnectionClosed' (the library does not reject in-flight requests).
 */
function stuckClient() {
  const handlers = new Map<string, Set<(d: unknown) => void>>()
  const client: ObsClient = {
    call: vi.fn(() => new Promise(() => {})),
    on(evt, cb) {
      if (!handlers.has(evt)) handlers.set(evt, new Set())
      handlers.get(evt)!.add(cb)
    },
    off(evt, cb) {
      handlers.get(evt)?.delete(cb)
    },
    disconnect: vi.fn(async () => {})
  }
  const emit = (evt: string, d?: unknown): void => handlers.get(evt)?.forEach((h) => h(d))
  return { client, emit, handlers }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('ObsController request bounds (#6)', () => {
  it('rejects a request OBS never answers after the call timeout', async () => {
    vi.useFakeTimers()
    const f = stuckClient()
    const c = new ObsController(f.client, { call: 1_000, slowCall: 5_000 })
    const p = c.showLive()
    const seen = expect(p).rejects.toThrow('OBS ne répond pas (SetCurrentProgramScene, 1 s).')
    await vi.advanceTimersByTimeAsync(1_000)
    await seen
  })

  it('gives device requests the longer timeout', async () => {
    vi.useFakeTimers()
    const f = stuckClient()
    const c = new ObsController(f.client, { call: 1_000, slowCall: 5_000 })
    let settled = false
    const p = c.setAudioDevice('mic2').finally(() => (settled = true))
    p.catch(() => {})
    await vi.advanceTimersByTimeAsync(4_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(p).rejects.toThrow('SetInputSettings, 5 s')
  })

  it('rejects requests in flight as soon as the connection closes', async () => {
    const f = stuckClient()
    const c = new ObsController(f.client, { call: 60_000, slowCall: 60_000 })
    const a = c.setAudioDevice('mic2')
    const b = c.screenshot()
    f.emit('ConnectionClosed')
    await expect(a).rejects.toThrow('Connexion à OBS perdue.')
    await expect(b).rejects.toThrow('Connexion à OBS perdue.')
  })

  it('disconnect() rejects requests in flight and stops listening for the close', async () => {
    const f = stuckClient()
    const c = new ObsController(f.client, { call: 60_000, slowCall: 60_000 })
    const a = c.showLive()
    await c.disconnect()
    await expect(a).rejects.toThrow('Connexion à OBS fermée.')
    expect(f.handlers.get('ConnectionClosed')?.size ?? 0).toBe(0)
  })

  it('disconnect() does not wait forever on a frozen OBS', async () => {
    vi.useFakeTimers()
    const f = stuckClient()
    f.client.disconnect = vi.fn(() => new Promise(() => {}))
    const c = new ObsController(f.client)
    const p = c.disconnect()
    const seen = expect(p).rejects.toThrow('OBS ne ferme pas la connexion.')
    await vi.advanceTimersByTimeAsync(3_000)
    await seen
  })

  it('answers and OBS errors pass through unchanged', async () => {
    const f = stuckClient()
    const err = Object.assign(new Error('The output is not running.'), { code: 501 })
    f.client.call = vi.fn(async (req: string) => {
      if (req === 'StopStream') throw err
      return { imageData: 'data:image/jpeg;base64,AAAA' }
    })
    const c = new ObsController(f.client)
    expect(await c.screenshot()).toBe('data:image/jpeg;base64,AAAA')
    expect(await c.stopStream()).toBe(false) // 501 still maps to "no output running"
  })
})
