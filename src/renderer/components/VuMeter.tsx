import { useEffect, useState } from 'react'

export function VuMeter() {
  const [db, setDb] = useState(-100)
  useEffect(() => window.lintoLive.on('audio-level', (v) => setDb(Math.max(-100, Math.min(0, v)))), [])
  // Perceptual-ish scale: -60 dB (silence) .. 0 dB (clip)
  const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100))
  const level = db > -6 ? 'hot' : db > -18 ? 'ok' : 'low'
  return (
    <div className="vu" role="meter" aria-label="Niveau audio" aria-valuemin={-100} aria-valuemax={0} aria-valuenow={Math.round(db)}>
      <div className={`vu-bar vu-${level}`} style={{ width: `${pct}%` }} />
    </div>
  )
}
