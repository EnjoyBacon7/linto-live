/**
 * Bound on every LinTO request (headers and body): without it a server that accepts the connection but never
 * answers holds Démarrer / Arrêter / Terminer for undici's default 300 s.
 */
export const LINTO_TIMEOUT_MS = 20_000
export const MSG_LINTO_TIMEOUT = 'LinTO ne répond pas (délai dépassé). Réessaie dans un instant.'

/** Runs `f`, turning an AbortSignal.timeout abort into a readable error. */
export async function withTimeout<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f()
  } catch (e) {
    if ((e as { name?: unknown })?.name === 'TimeoutError') throw new Error(MSG_LINTO_TIMEOUT)
    throw e
  }
}
