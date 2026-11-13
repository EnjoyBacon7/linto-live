import type { ObsClient } from './controller'

/**
 * obs-websocket-js (5.0.8) has no request timeout, and when the socket closes it drops its listeners without
 * rejecting the requests in flight: a call made while OBS crashes or freezes never settles, and LiveController's
 * serial queue would wait behind it forever. This wrapper bounds every call and rejects the pending ones as soon
 * as the connection closes.
 */
export const OBS_CALL_TIMEOUT_MS = 15_000
/** Requests that may open a capture device (slow on some cameras and capture cards). */
export const OBS_SLOW_CALL_TIMEOUT_MS = 60_000
const SLOW_REQUESTS = new Set(['CreateInput', 'SetInputSettings', 'CreateSceneItem'])

export class ObsCallError extends Error {
  constructor(message: string, readonly requestType: string) {
    super(message)
    this.name = 'ObsCallError'
  }
}

export interface GuardOptions {
  timeoutMs?: number
  slowTimeoutMs?: number
}

export function guardClient(inner: ObsClient, o: GuardOptions = {}): ObsClient {
  const timeoutMs = o.timeoutMs ?? OBS_CALL_TIMEOUT_MS
  const slowTimeoutMs = o.slowTimeoutMs ?? OBS_SLOW_CALL_TIMEOUT_MS
  const pending = new Set<(e: Error) => void>()
  let closed: Error | null = null
  const rejectAll = (e: Error): void => {
    closed = e
    const all = [...pending]
    pending.clear()
    all.forEach((r) => r(e))
  }
  inner.on('ConnectionClosed', () => rejectAll(new Error('Connexion à OBS perdue.')))

  return {
    call(req, data) {
      if (closed) return Promise.reject(new ObsCallError(closed.message, req))
      return new Promise((resolve, reject) => {
        const ms = SLOW_REQUESTS.has(req) ? slowTimeoutMs : timeoutMs
        const fail = (e: Error): void => {
          clearTimeout(timer)
          pending.delete(fail)
          reject(e instanceof ObsCallError ? e : new ObsCallError(e.message, req))
        }
        const timer = setTimeout(() => fail(new Error(`OBS ne répond pas (${req}).`)), ms)
        pending.add(fail)
        inner.call(req, data).then(
          (v) => {
            if (!pending.has(fail)) return // already timed out or closed
            clearTimeout(timer)
            pending.delete(fail)
            resolve(v)
          },
          (e: unknown) => {
            if (!pending.has(fail)) return
            clearTimeout(timer)
            pending.delete(fail)
            reject(e) // OBS's own error (e.g. its request status code): kept as is
          }
        )
      })
    },
    on: (evt, cb) => inner.on(evt, cb),
    off: (evt, cb) => inner.off(evt, cb),
    async disconnect() {
      rejectAll(new Error('Connexion à OBS fermée.'))
      return inner.disconnect()
    }
  }
}
