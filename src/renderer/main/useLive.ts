import { useEffect, useState } from 'react'
import type { LiveState } from '../../shared/ipc'

export const IDLE_STATE: LiveState = { phase: 'idle', stream: 'off', captions: 'offline', obs: 'running', output: 'off' }

/** Latest LiveState pushed by main (main also re-sends it on every page load). */
export function useLiveState(): LiveState {
  const [state, setState] = useState<LiveState>(IDLE_STATE)
  useEffect(() => window.lintoLive.on('live-state', setState), [])
  return state
}

/**
 * A show is on air: live, being stopped, or switching to another session (phase 'starting' while a
 * session is already on air). A first start ('starting' without session) is not "on air" yet.
 */
export function isOnAir(s: LiveState): boolean {
  return s.phase === 'live' || s.phase === 'stopping' || (s.phase === 'starting' && !!s.session)
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** mm:ss, or h:mm:ss past an hour. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** Elapsed time since `startedAt`, re-rendered every second. */
export function useElapsed(startedAt: number | undefined): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (startedAt === undefined) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [startedAt])
  return startedAt === undefined ? formatElapsed(0) : formatElapsed(now - startedAt)
}
