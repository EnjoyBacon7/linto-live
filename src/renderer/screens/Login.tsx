import { useEffect, useState, type FormEvent } from 'react'
import type { AuthMethod } from '../../shared/types'
import { ipcErrorMessage } from '../ipcError'

export function Login({ onLoggedIn, onCancel }: { onLoggedIn: () => void; onCancel?: () => void }) {
  const [methods, setMethods] = useState<AuthMethod[]>([])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [instance, setInstance] = useState('https://studio.linto.ai')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    window.lintoLive.auth.methods().then((m) => alive && setMethods(m)).catch((e) => alive && setError(ipcErrorMessage(e)))
    window.lintoLive.setup.load().then((d) => alive && setInstance(d.settings.instance)).catch(() => {}) // rejects (Unauthorized) while logged out: keep the default
    return () => { alive = false }
  }, [])

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try { await fn(); onLoggedIn() } catch (e) { setError(ipcErrorMessage(e)) } finally { setBusy(false) }
  }
  const saveInstance = async (): Promise<void> => {
    try {
      await window.lintoLive.setup.save({ instance })
      setMethods(await window.lintoLive.auth.methods())
    } catch (e) { setError(ipcErrorMessage(e)) }
  }
  const submit = (e: FormEvent): void => {
    e.preventDefault()
    void run(() => window.lintoLive.auth.loginLocal(email, password))
  }
  const sso = (m: AuthMethod): void => {
    if (m.path.endsWith('/organization') && !email.trim()) { setError("Saisis d'abord ton email pour utiliser cette connexion."); return }
    void run(() => window.lintoLive.auth.loginSso(m.path, m.path.endsWith('/organization') ? email.trim() : undefined))
  }

  return (
    <form className="card login" onSubmit={submit}>
      <h1>Connexion à LinTO</h1>
      <details className="advanced">
        <summary>Avancé</summary>
        <label>Instance LinTO
          <input value={instance} onChange={(e) => setInstance(e.target.value)} onBlur={() => void saveInstance()} spellCheck={false} />
        </label>
      </details>
      <label>Email
        <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>Mot de passe
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="primary" disabled={busy || !email || !password}>Se connecter</button>
      {methods.length > 0 && <div className="sso">
        {methods.map((m) => (
          <button type="button" key={m.path} disabled={busy} onClick={() => sso(m)}>Se connecter avec {m.name}</button>
        ))}
      </div>}
      {onCancel && <button type="button" className="link" onClick={onCancel}>Annuler</button>}
    </form>
  )
}
