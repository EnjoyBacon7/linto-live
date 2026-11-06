/** Runs `shutdown`, capped at `capMs`. On timeout or rejection, calls `killNow` so OBS never outlives us. */
export async function shutdownWithCap(
  shutdown: () => Promise<void>,
  killNow: () => void,
  capMs: number
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const cap = new Promise<'cap'>((r) => {
    timer = setTimeout(() => r('cap'), capMs)
  })
  const run = shutdown().then(
    () => 'ok' as const,
    (err) => {
      console.error('shutdown failed', err)
      return 'failed' as const
    }
  )
  try {
    if ((await Promise.race([run, cap])) !== 'ok') killNow()
  } finally {
    clearTimeout(timer)
  }
}
