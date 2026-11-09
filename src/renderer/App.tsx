import { useEffect, useRef, useState } from 'react'
import { Login } from './screens/Login'
import { MainWindow, type MainWindowCommands } from './screens/MainWindow'
import { isOnAir, useLiveState } from './main/useLive'
import './theme.css'

type Screen = 'loading' | 'login' | 'main'

export function App({ commands }: { commands?: { current: MainWindowCommands | null } }) {
  const [screen, setScreen] = useState<Screen>('loading')
  const ownCommands = useRef<MainWindowCommands | null>(null)
  const cmds = commands ?? ownCommands
  const state = useLiveState()
  const onAir = isOnAir(state)
  const [authRequired, setAuthRequired] = useState(false)

  const authEvent = useRef(false)
  useEffect(() => {
    window.lintoLive.auth.status()
      .then((s) => { if (!authEvent.current) setScreen(s.loggedIn ? 'main' : 'login') })
      .catch(() => setScreen('login'))
  }, [])
  useEffect(() => window.lintoLive.on('auth-required', () => { authEvent.current = true; setAuthRequired(true) }), [])
  // App menu / tray commands carried out by the main window (ignored while it is not shown).
  useEffect(() => window.lintoLive.on('command', (c) => {
    if (c === 'start' || c === 'stop' || c === 'new-session' || c === 'terminate' || c === 'logout' || c === 'show-output') {
      cmds.current?.run(c)
    }
  }), [cmds])
  // Outside the main window the menus only offer what needs no account (MainWindow reports the rest).
  useEffect(() => {
    if (screen === 'login') window.lintoLive.app.reportShellState({ loggedIn: false, canStart: false }).catch(() => {})
  }, [screen])
  // Auth lost while not on air: back to Login. On air, MainWindow shows a banner and keeps the show running.
  useEffect(() => { if (authRequired && !onAir) setScreen('login') }, [authRequired, onAir])

  if (screen === 'loading') return <div className="app-loading drag" />
  if (screen === 'login') return <Login onLoggedIn={() => { setAuthRequired(false); setScreen('main') }} />
  return (
    <MainWindow
      state={state}
      authRequired={authRequired}
      onReauthenticated={() => setAuthRequired(false)}
      onLoggedOut={() => setScreen('login')}
      commands={cmds}
    />
  )
}
