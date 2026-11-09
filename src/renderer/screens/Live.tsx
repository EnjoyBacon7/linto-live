import { useEffect, useState } from 'react'
import type { LiveState } from '../../shared/ipc'
import { ipcErrorMessage } from '../ipcError'

type Tone = 'ok' | 'warn' | 'bad' | 'idle'
function Chip({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  const icon = tone === 'ok' ? '●' : tone === 'warn' ? '▲' : tone === 'bad' ? '✕' : '○'
  return <li className={`chip chip-${tone}`}><span aria-hidden="true">{icon}</span> <strong>{label}</strong> {value}</li>
}

export function Live({ state, reused, authRequired = false, onStopped, onNeedLogin, onSwitched }: {
  state: LiveState; reused: boolean; authRequired?: boolean; onStopped: () => void; onNeedLogin: () => void
  onSwitched?: (reused: boolean) => void
}) {
  const [preview, setPreview] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'stop' | 'terminate' | 'switch' | null>(null)
  const [switchOpen, setSwitchOpen] = useState(false)
  const [newName, setNewName] = useState('')
  useEffect(() => {
    if (!confirming) return
    const h = (e: KeyboardEvent): void => { if (e.key === 'Escape') setConfirming(false) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [confirming])

  useEffect(() => window.lintoLive.on('preview', setPreview), [])

  const guard = async (fn: () => Promise<void>, after?: () => void): Promise<void> => {
    setError(null)
    try { await fn(); after?.() } catch (e) { setError(ipcErrorMessage(e)) }
  }
  const act = async (kind: 'stop' | 'terminate', fn: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(kind)
    await guard(fn, onStopped)
    setBusy(null)
  }
  /** Changer de session: the controller stops the current stream and retargets OBS while staying live. */
  const switchSession = async (): Promise<void> => {
    const n = newName.trim()
    if (busy || !n) return
    setBusy('switch')
    setError(null)
    try {
      const r = await window.lintoLive.live.start(n)
      if (r.ok) { setSwitchOpen(false); setNewName(''); onSwitched?.(r.reused) } else setError(r.message)
    } catch (e) { setError(ipcErrorMessage(e)) } finally { setBusy(null) }
  }
  const name = state.session?.name ?? ''
  const obs = { running: ['En marche', 'ok'], restarting: ['Redémarrage…', 'warn'], down: ['Arrêté', 'bad'] } as const
  const audio = { off: ['Inactif', 'idle'], starting: ['Démarrage…', 'warn'], active: ['Envoyé', 'ok'], error: ['Erreur', 'bad'], unavailable: ['Indisponible', 'bad'] } as const
  const caps = { connecting: ['Connexion…', 'warn'], live: ['Actifs', 'ok'], offline: ['Hors ligne', 'bad'] } as const
  const out = { shown: ['Affichée', 'ok'], off: ['Noire', 'idle'] } as const

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
            <button type="button" className="primary big" disabled={busy !== null} onClick={() => void act('stop', () => window.lintoLive.live.stop())}>{busy === 'stop' ? 'Arrêt…' : 'Arrêter'}</button>
            <button type="button" className="danger" disabled={busy !== null} onClick={() => setConfirming(true)}>{busy === 'terminate' ? 'Fin de session…' : 'Terminer la session'}</button>
            <button type="button" disabled={busy !== null} onClick={() => setSwitchOpen((o) => !o)}>Changer de session</button>
            <button type="button" onClick={() => void guard(() => window.lintoLive.live.showOutputWindow())}>Afficher la fenêtre de sortie</button>
          </div>
          {switchOpen && (
            <form className="switch" onSubmit={(e) => { e.preventDefault(); void switchSession() }}>
              <label>Nom de la nouvelle session
                <input value={newName} autoFocus onChange={(e) => setNewName(e.target.value)} />
              </label>
              <button type="submit" className="primary" disabled={busy !== null || newName.trim() === ''}>{busy === 'switch' ? 'Bascule…' : 'Basculer'}</button>
            </form>
          )}
        </aside>
      </div>
      {confirming && (
        <div className="overlay"><div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-msg">
          <p id="confirm-msg">Terminer définitivement la session « {name} » ? Elle ne pourra plus être reprise.</p>
          <div className="actions">
            <button type="button" autoFocus onClick={() => setConfirming(false)}>Annuler</button>
            <button type="button" className="danger" onClick={() => { setConfirming(false); void act('terminate', () => window.lintoLive.live.terminate()) }}>Terminer définitivement</button>
          </div>
        </div></div>
      )}
    </div>
  )
}
