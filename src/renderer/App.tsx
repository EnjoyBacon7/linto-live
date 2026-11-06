import { useEffect, useRef, useState } from 'react'
import type { LiveState } from '../shared/ipc'
import { Login } from './screens/Login'
import { Setup } from './screens/Setup'
import { Live } from './screens/Live'
import './styles.css'

type Screen = 'loading' | 'login' | 'setup' | 'live'
const STARTING: LiveState = { phase: 'starting', stream: 'off', captions: 'connecting', obs: 'running', output: 'off' }

export function App() {
  const [screen, setScreen] = useState<Screen>('loading')
  const [reused, setReused] = useState(false)
  const [state, setState] = useState<LiveState>(STARTING)
  const [loginModal, setLoginModal] = useState(false)
  const [authRequired, setAuthRequired] = useState(false)

  const authEvent = useRef(false)
  useEffect(() => {
    window.lintoLive.auth.status().then((s) => { if (!authEvent.current) setScreen(s.loggedIn ? 'setup' : 'login') }).catch(() => setScreen('login'))
    return window.lintoLive.on('live-state', setState)
  }, [])
  // Auth lost while not live: go back to Login. While live, Live shows a banner instead.
  useEffect(() => window.lintoLive.on('auth-required', () => { authEvent.current = true; setAuthRequired(true); setScreen((s) => (s === 'live' ? s : 'login')) }), [])

  useEffect(() => {
    if (!loginModal) return
    const h = (e: KeyboardEvent): void => { if (e.key === 'Escape') setLoginModal(false) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [loginModal])

  return (
    <div className="app">
      <main>
        {screen === 'loading' && <p className="center">Chargement…</p>}
        {screen === 'login' && <Login onLoggedIn={() => { setAuthRequired(false); setScreen('setup') }} />}
        {screen === 'setup' && <Setup warning={state.warning} onStarted={(r) => { setReused(r); setState(STARTING); setScreen('live') }} />}
        {screen === 'live' && <Live state={state} reused={reused} authRequired={authRequired} onStopped={() => setScreen('setup')} onNeedLogin={() => setLoginModal(true)} onSwitched={setReused} />}
      </main>
      {loginModal && (
        <div className="overlay"><div className="dialog" role="dialog" aria-modal="true" aria-label="Connexion">
          <Login onLoggedIn={() => { setLoginModal(false); setAuthRequired(false) }} onCancel={() => setLoginModal(false)} />
        </div></div>
      )}
      <footer>
        <button type="button" className="link" onClick={() => void window.lintoLive.app.uninstall()}>Désinstaller LinTO Live…</button>
      </footer>
    </div>
  )
}
