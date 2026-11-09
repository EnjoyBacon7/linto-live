import { useEffect, useState } from 'react'
import type { LiveState } from '../../shared/ipc'
import { StatusDot, type StatusDotProps } from '../ui/StatusDot'

type Tone = StatusDotProps['tone']
type Item = readonly [string, Tone]

function stream(s: LiveState): Item {
  return ({ off: ['non', 'idle'], starting: ['connexion…', 'warn'], active: ['oui', 'ok'], error: ['erreur', 'bad'], unavailable: ['impossible', 'bad'] } as const)[s.stream]
}
function captions(s: LiveState, onAir: boolean): Item {
  if (s.captions === 'offline') return onAir ? ['coupés', 'bad'] : ['inactifs', 'idle']
  return s.captions === 'live' ? ['actifs', 'ok'] : ['connexion…', 'warn']
}
function obs(s: LiveState): Item {
  return ({ running: ['prêt', 'ok'], restarting: ['redémarrage…', 'warn'], down: ['arrêté', 'bad'] } as const)[s.obs]
}

function Cell({ label, item }: { label: string; item: Item }) {
  return (
    <span className="statusbar-cell">
      <StatusDot tone={item[1]} />
      <span>{label}</span>
      <span className="statusbar-value">{item[0]}</span>
    </span>
  )
}

/** Last transcribed line, from its own event so captions only re-render this element. */
function CaptionLine() {
  const [line, setLine] = useState('')
  useEffect(() => window.lintoLive.on('caption-line', setLine), [])
  return <span className="statusbar-line selectable" title={line || undefined}>{line}</span>
}

/** Bottom status bar: LinTO audio, captions, OBS, then the last transcribed line. */
export function StatusBar({ state, onAir }: { state: LiveState; onAir: boolean }) {
  return (
    <footer className="statusbar" role="status" aria-label="État">
      <Cell label="LinTO reçoit le son" item={stream(state)} />
      <Cell label="Sous-titres" item={captions(state, onAir)} />
      <Cell label="OBS" item={obs(state)} />
      <CaptionLine />
    </footer>
  )
}
