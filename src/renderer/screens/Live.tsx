import { useEffect, useState } from 'react'
import type { LiveState } from '../../shared/ipc'
import type { MonitorInfo } from '../../shared/types'
import { ipcErrorMessage } from '../ipcError'

type Tone = 'ok' | 'warn' | 'bad' | 'idle'
function Chip({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  const icon = tone === 'ok' ? '●' : tone === 'warn' ? '▲' : tone === 'bad' ? '✕' : '○'
  return <li className={`chip chip-${tone}`}><span aria-hidden="true">{icon}</span> <strong>{label}</strong> {value}</li>
}

export function Live({ state, reused, authRequired = false, onStopped, onNeedLogin }: {
  state: LiveState; reused: boolean; authRequired?: boolean; onStopped: () => void; onNeedLogin: () => void
}) {
  const [preview, setPreview] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [displays, setDisplays] = useState<MonitorInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => window.lintoLive.on('preview', setPreview), [])

  const guard = async (fn: () => Promise<void>, after?: () => void): Promise<void> => {
    setError(null)
    try { await fn(); after?.() } catch (e) { setError(ipcErrorMessage(e)) }
  }
  const openDisplays = async (): Promise<void> => {
    await guard(async () => setDisplays((await window.lintoLive.setup.load()).displays))
  }
  const name = state.session?.name ?? ''
  const obs = { running: ['En marche', 'ok'], restarting: ['Redémarrage…', 'warn'], down: ['Arrêté', 'bad'] } as const
  const audio = { off: ['Inactif', 'idle'], starting: ['Démarrage…', 'warn'], active: ['Envoyé', 'ok'], error: ['Erreur', 'bad'], unavailable: ['Indisponible', 'bad'] } as const
  const caps = { connecting: ['Connexion…', 'warn'], live: ['Actifs', 'ok'], offline: ['Hors ligne', 'bad'] } as const
  const out = { shown: ['Affichée', 'ok'], 'display-missing': ['Écran introuvable', 'bad'], off: ['Noire', 'idle'] } as const

  return (
    <div className="live">
      {authRequired && (
        <div className="banner banner-warn" role="alert">
          <span>Session LinTO expirée — se reconnecter</span>
          <button type="button" onClick={onNeedLogin}>Se reconnecter</button>
        </div>
      )}
      {state.warning && <div className="banner banner-warn" role="alert">{state.warning}</div>}
      {error && <div className="banner banner-bad" role="alert">{error}</div>}
      <div className="live-main">
        <div className="preview">
          {preview ? <img src={preview} alt="Aperçu de la sortie HDMI" /> : <div className="preview-empty">Aperçu en attente…</div>}
        </div>
        <aside className="side">
          <h1>{name} <span className={`badge ${reused ? 'badge-reuse' : 'badge-new'}`}>{reused ? 'reprise' : 'nouvelle'}</span></h1>
          <ul className="chips" aria-label="État">
            <Chip label="OBS" value={obs[state.obs][0]} tone={obs[state.obs][1]} />
            <Chip label="Audio→LinTO" value={audio[state.stream][0]} tone={audio[state.stream][1]} />
            <Chip label="Sous-titres" value={caps[state.captions][0]} tone={caps[state.captions][1]} />
            <Chip label="Sortie HDMI" value={out[state.output][0]} tone={out[state.output][1]} />
          </ul>
          <p className="caption" aria-live="polite">{state.lastLine ?? '—'}</p>
          <div className="actions">
            <button type="button" className="primary big" onClick={() => void guard(() => window.lintoLive.live.stop(), onStopped)}>Arrêter</button>
            <button type="button" className="danger" onClick={() => setConfirming(true)}>Terminer la session</button>
            <button type="button" onClick={() => void openDisplays()}>Changer d'écran</button>
          </div>
          {displays && (
            <label>Nouvel écran
              <select defaultValue="" onChange={(e) => {
                const d = displays[Number(e.target.value)]
                if (d) void guard(() => window.lintoLive.live.changeDisplay({ name: d.name, x: d.x, y: d.y, width: d.width, height: d.height }), () => setDisplays(null))
              }}>
                <option value="" disabled>Choisir…</option>
                {displays.map((d, i) => <option key={i} value={i}>{d.name} ({d.width}×{d.height})</option>)}
              </select>
            </label>
          )}
        </aside>
      </div>
      {confirming && (
        <div className="overlay"><div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-msg">
          <p id="confirm-msg">Terminer définitivement la session « {name} » ? Elle ne pourra plus être reprise.</p>
          <div className="actions">
            <button type="button" autoFocus onClick={() => setConfirming(false)}>Annuler</button>
            <button type="button" className="danger" onClick={() => { setConfirming(false); void guard(() => window.lintoLive.live.terminate(), onStopped) }}>Terminer définitivement</button>
          </div>
        </div></div>
      )}
    </div>
  )
}
