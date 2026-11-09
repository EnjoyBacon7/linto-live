import { useEffect, useState } from 'react'

const SEGMENTS = 20

/** Segmented level meter (like the macOS Sound input meter): -60 dB (silence) .. 0 dB (clip). */
export function VuMeter() {
  const [db, setDb] = useState(-100)
  useEffect(() => window.lintoLive.on('audio-level', (v) => setDb(Math.max(-100, Math.min(0, v)))), [])
  const lit = Math.round(Math.max(0, Math.min(1, (db + 60) / 60)) * SEGMENTS)
  return (
    <div className="vu" role="meter" aria-label="Niveau audio" aria-valuemin={-100} aria-valuemax={0} aria-valuenow={Math.round(db)}>
      {Array.from({ length: SEGMENTS }, (_, i) => {
        // Last 2 segments (> -6 dB) red, the 4 before (> -18 dB) orange, the rest green.
        const zone = i >= SEGMENTS - 2 ? 'hot' : i >= SEGMENTS - 6 ? 'warm' : 'ok'
        return <span key={i} className={i < lit ? `vu-seg vu-${zone} is-lit` : 'vu-seg'} />
      })}
    </div>
  )
}
