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

/** Bottom status bar: LinTO audio, captions, OBS, then the last transcribed line. */
export function StatusBar({ state, onAir }: { state: LiveState; onAir: boolean }) {
  return (
    <footer className="statusbar" role="status" aria-label="État">
      <Cell label="LinTO reçoit le son" item={stream(state)} />
      <Cell label="Sous-titres" item={captions(state, onAir)} />
      <Cell label="OBS" item={obs(state)} />
      <span className="statusbar-line selectable" title={state.lastLine}>{state.lastLine ?? ''}</span>
    </footer>
  )
}
