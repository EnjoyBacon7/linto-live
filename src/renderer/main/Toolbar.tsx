import { Button } from '../ui/Button'
import { StatusDot } from '../ui/StatusDot'
import { DisplayIcon, PlayIcon, StopIcon } from '../ui/icons'
import { useElapsed } from './useLive'

export type Busy = 'start' | 'stop' | 'terminate' | 'switch' | null

export interface ToolbarProps {
  title: string | null
  caption: string | null
  onAir: boolean
  startedAt?: number
  busy: Busy
  canStart: boolean
  /** Why Démarrer is disabled (tooltip). */
  startHint?: string
  onStart(): void
  onStop(): void
  /** OBS is attached: the output window (projector) can be opened, on or off air. */
  canShowOutput: boolean
  onShowOutput(): void
  onTerminate(): void
  /** Why Terminer is unavailable (the user may not terminate sessions here); absent = available. */
  terminateBlocked?: string
}

function LivePill({ startedAt }: { startedAt?: number }) {
  const elapsed = useElapsed(startedAt)
  return (
    <span className="live-pill">
      <StatusDot tone="live" pulse className="live-pill-dot" />
      <span>{`EN DIRECT ${elapsed}`}</span>
    </span>
  )
}

/** Unified title bar/toolbar of the content area: session name + main actions. Draggable, controls excluded. */
export function Toolbar(p: ToolbarProps) {
  const outputButton = (
    <Button size="large" className="btn-icon" aria-label="Afficher la fenêtre de sortie" title="Afficher la fenêtre de sortie"
      icon={<DisplayIcon />} disabled={!p.canShowOutput} onClick={p.onShowOutput} />
  )
  return (
    <div className="toolbar drag" role="toolbar" aria-label="Barre d'outils">
      <div className="toolbar-title">
        {p.title ? (
          <>
            <span className="toolbar-name">{p.title}</span>
            {p.caption && <span className="toolbar-caption">{p.caption}</span>}
          </>
        ) : (
          <span className="toolbar-name is-empty">Aucune session choisie</span>
        )}
      </div>
      <div className="toolbar-actions">
        {p.onAir ? (
          <>
            <LivePill startedAt={p.startedAt} />
            <Button size="large" icon={<StopIcon size={12} />} disabled={p.busy !== null} onClick={p.onStop}>
              {p.busy === 'stop' ? 'Arrêt…' : 'Arrêter'}
            </Button>
            {outputButton}
            <Button size="large" variant="destructive" disabled={p.busy !== null || p.terminateBlocked !== undefined}
              title={p.terminateBlocked} onClick={p.onTerminate}>
              {p.busy === 'terminate' ? 'Fin de session…' : 'Terminer…'}
            </Button>
          </>
        ) : (
          <>
            {outputButton}
            <Button size="large" variant="primary" icon={<PlayIcon size={12} />} disabled={!p.canStart || p.busy !== null}
              title={p.canStart ? undefined : p.startHint} onClick={p.onStart}>
              {p.busy === 'start' ? 'Démarrage…' : 'Démarrer'}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
