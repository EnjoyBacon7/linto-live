/**
 * Upper bound for one LinTO HTTP request, body included. Without it the only limit is undici's default
 * 300 s headers timeout: a server that accepts the connection but never answers would block Démarrer,
 * Terminer or a stream retry — and Arrêter queued behind them — for five minutes.
 */
export const LINTO_TIMEOUT_MS = 20_000

export const MSG_LINTO_TIMEOUT = `LinTO ne répond pas (délai de ${LINTO_TIMEOUT_MS / 1000} s dépassé). Réessaie dans un instant.`

/** `fetch` with a timeout signal (unless the caller passed its own); a timeout becomes a readable error. */
export async function fetchWithTimeout<T>(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  read: (res: Response) => Promise<T>,
  ms = LINTO_TIMEOUT_MS
): Promise<T> {
  try {
    const res = await fetchFn(url, { ...init, signal: init.signal ?? AbortSignal.timeout(ms) })
    return await read(res)
  } catch (e) {
    if ((e as { name?: unknown })?.name === 'TimeoutError') throw new Error(MSG_LINTO_TIMEOUT, { cause: e })
    throw e
  }
}
