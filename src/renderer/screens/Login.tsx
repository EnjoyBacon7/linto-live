import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { AuthMethod } from '../../shared/types'
import { ipcErrorMessage } from '../ipcError'
import { Button } from '../ui/Button'
import { TextField } from '../ui/TextField'
import logo from '../assets/linto.svg'
import './login.css'

const norm = (u: string): string => u.trim().replace(/\/+$/, '')
const host = (u: string): string => {
  try { return new URL(norm(u)).host || norm(u) } catch { return norm(u) }
}

export interface LoginProps {
  onLoggedIn: () => void
  onCancel?: () => void
  /** Inside a sheet (re-login while live): no logo/title, the sheet provides them. */
  embedded?: boolean
}

export function Login({ onLoggedIn, onCancel, embedded = false }: LoginProps) {
  const [methods, setMethods] = useState<AuthMethod[]>([])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [instance, setInstance] = useState('https://studio.linto.ai')
  const [editingInstance, setEditingInstance] = useState(false)
  const loaded = useRef(norm('https://studio.linto.ai'))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    window.lintoLive.auth.methods().then((m) => alive && setMethods(m)).catch((e) => alive && setError(ipcErrorMessage(e)))
    window.lintoLive.setup.load().then((d) => { if (!alive) return; loaded.current = norm(d.settings.instance); setInstance(d.settings.instance) }).catch(() => {}) // rejects (Unauthorized) while logged out: keep the default
    return () => { alive = false }
  }, [])

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try { await fn(); onLoggedIn() } catch (e) { setError(ipcErrorMessage(e)) } finally { setBusy(false) }
  }
  const saveInstance = async (): Promise<void> => {
    setEditingInstance(false)
    if (norm(instance) === loaded.current) return
    try {
      await window.lintoLive.setup.save({ instance: norm(instance) })
      loaded.current = norm(instance)
      setMethods(await window.lintoLive.auth.methods())
    } catch (e) { setError(ipcErrorMessage(e)) }
  }
  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (busy || !email || !password) return
    void run(() => window.lintoLive.auth.loginLocal(email, password))
  }
  const sso = (m: AuthMethod): void => {
    if (m.path.endsWith('/organization') && !email.trim()) { setError("Saisis d'abord ton email pour utiliser cette connexion."); return }
    void run(() => window.lintoLive.auth.loginSso(m.path, m.path.endsWith('/organization') ? email.trim() : undefined))
  }

  const form = (
    <form className={embedded ? 'login-form is-embedded' : 'login-form'} onSubmit={submit}>
      {!embedded && (
        <div className="login-head">
          <img className="login-logo" src={logo} alt="LinTO" width={64} height={64} draggable={false} />
          <h1 className="login-title">Connexion à LinTO</h1>
        </div>
      )}
      <div className="login-instance">
        {editingInstance ? (
          <TextField
            label="Instance LinTO"
            value={instance}
            autoFocus
            onChange={(e) => setInstance(e.target.value)}
            onBlur={() => void saveInstance()}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
          />
        ) : (
          <p className="secondary">
            <span className="selectable">{host(instance)}</span>
            {' — '}
            <button type="button" className="login-link" onClick={() => setEditingInstance(true)}>Modifier</button>
          </p>
        )}
      </div>
      <TextField label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
      <TextField label="Mot de passe" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <p className="login-error" role="alert">{error}</p>}
      <div className="login-actions">
        {onCancel && <Button size="large" onClick={onCancel}>Annuler</Button>}
        <Button type="submit" variant="primary" size="large" disabled={busy || !email || !password}>Se connecter</Button>
      </div>
      {methods.length > 0 && (
        <>
          <div className="login-or"><span>ou</span></div>
          <div className="login-sso">
            {methods.map((m) => (
              <Button key={m.path} size="large" disabled={busy} onClick={() => sso(m)}>Continuer avec {m.name}</Button>
            ))}
          </div>
        </>
      )}
    </form>
  )

  if (embedded) return form
  return (
    <div className="login-window">
      <div className="login-titlebar drag" />
      <div className="login-scroll">{form}</div>
    </div>
  )
}
