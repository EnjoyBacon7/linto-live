import { useCallback, useEffect, useRef, useState } from 'react'
import type { LiveState, SetupData } from '../../shared/ipc'
import type { SessionSummary, Settings, Watermark } from '../../shared/types'
import { ipcErrorMessage } from '../ipcError'
import { Banner } from '../ui/Banner'
import { Button } from '../ui/Button'
import { Sheet } from '../ui/Sheet'
import { CloseIcon } from '../ui/icons'
import { ConfirmSheet } from '../main/ConfirmSheet'
import { Inspector, type WatermarkTarget } from '../main/Inspector'
import { WatermarkSheet } from '../main/WatermarkSheet'
import { NewSessionSheet } from '../main/NewSessionSheet'
import { NO_STREAM_REASON, STATUS, Sidebar } from '../main/Sidebar'
import { Stage } from '../main/Stage'
import { StatusBar } from '../main/StatusBar'
import { Toolbar, type Busy } from '../main/Toolbar'
import { isOnAir } from '../main/useLive'
import { Login } from './Login'
import '../main/mainWindow.css'

/** Actions reachable from the app menu / tray (Task 7 forwards `evt:command` here). */
export type MainWindowCommand = 'start' | 'stop' | 'new-session' | 'terminate' | 'logout' | 'show-output'
export interface MainWindowCommands {
  run(c: MainWindowCommand): void
  /** Name of the selected (or on-air) session, and whether Démarrer is currently possible. */
  sessionName: string | null
  canStart: boolean
}

export interface MainWindowProps {
  state: LiveState
  /** LinTO asked to log in again while on air (when idle, App shows the Login screen instead). */
  authRequired: boolean
  onReauthenticated(): void
  onLoggedOut(): void
  commands?: { current: MainWindowCommands | null }
}

/** Selected session: an existing one (by name), or a pending new one created on LinTO at Démarrer. */
type Selection = { name: string; pending?: { profileId?: number } }
type SheetState =
  | { kind: 'new' }
  | { kind: 'terminate' }
  | { kind: 'switch'; target: Selection }
  | { kind: 'login' }
  | { kind: 'watermark' }
  | null

const REFRESH_MS = 30_000

export function MainWindow({ state, authRequired, onReauthenticated, onLoggedOut, commands }: MainWindowProps) {
  const [data, setData] = useState<SetupData | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [sel, setSel] = useState<Selection | null>(null)
  const [reused, setReused] = useState<boolean | null>(null)
  const [busy, setBusyState] = useState<Busy>(null)
  const busyRef = useRef<Busy>(null)
  const setBusy = (b: Busy): void => { busyRef.current = b; setBusyState(b) }
  const [error, setError] = useState<string | null>(null)
  const [sheet, setSheet] = useState<SheetState>(null)
  const sheetRef = useRef<SheetState>(null)
  sheetRef.current = sheet
  /** The token is known to be rejected: polling the list would only get 401 again until re-login. */
  const authRequiredRef = useRef(authRequired)
  authRequiredRef.current = authRequired

  const onAir = isOnAir(state)
  const liveName = onAir ? state.session?.name : undefined

  // ---- Data ----
  /** `keepSettings`: a background reload (OBS came up) refreshes the lists only, never an edit in progress. */
  const loadSetup = useCallback(async (keepSettings = false): Promise<SetupData | null> => {
    try {
      const d = await window.lintoLive.setup.load()
      setData(d)
      setSettings((cur) => (keepSettings && cur ? cur : d.settings))
      setLoadError(null)
      return d
    } catch (e) {
      setLoadError(ipcErrorMessage(e))
      return null
    }
  }, [])
  const refresh = useCallback(async (): Promise<SessionSummary[] | null> => {
    try {
      const list = await window.lintoLive.sessions.list()
      setSessions(list)
      setListError(null)
      return list
    } catch (e) {
      setListError(ipcErrorMessage(e))
      return null
    }
  }, [])

  useEffect(() => {
    let alive = true
    void Promise.all([loadSetup(), refresh()]).then(([d, list]) => {
      // Preselect the last session used, if it is still listed.
      const last = d?.settings.lastSessionName
      if (alive && last && list?.some((s) => s.name === last)) setSel((cur) => cur ?? { name: last })
    })
    const t = setInterval(() => { if (!authRequiredRef.current) void refresh() }, REFRESH_MS)
    return () => { alive = false; clearInterval(t) }
  }, [loadSetup, refresh])

  // OBS is still booting at launch (no devices listed yet): reload the lists once it is running.
  const prevObs = useRef<LiveState['obs'] | null>(null)
  useEffect(() => {
    const prev = prevObs.current
    prevObs.current = state.obs
    if (prev !== null && prev !== 'running' && state.obs === 'running') void loadSetup(true)
  }, [state.obs, loadSetup])

  // The selection follows the session on air (start/switch from here, the menu or the tray).
  useEffect(() => {
    if (liveName) setSel((cur) => (cur && !cur.pending && cur.name === liveName ? cur : { name: liveName }))
  }, [liveName])
  // Going on/off air changes session statuses: refresh. Off air, « réutilisée/nouvelle » no longer applies.
  const wasOnAir = useRef(onAir)
  useEffect(() => {
    if (wasOnAir.current === onAir) return
    wasOnAir.current = onAir
    if (!onAir) setReused(null)
    void refresh()
  }, [onAir, refresh])

  // ---- Derived ----
  const summary = sel && !sel.pending ? sessions?.find((s) => s.name === sel.name) : undefined
  const canStream = !!sel && (!!sel.pending || (summary?.canStream ?? true))
  const startHint = !sel ? 'Choisis une session.'
    : !settings?.videoDeviceId ? 'Choisis une caméra.'
    : !settings.audioDeviceId ? 'Choisis un micro.'
    : !canStream ? NO_STREAM_REASON : undefined
  // 'error' = the last start failed: retrying is allowed. Any other phase means a show is starting/running.
  const idle = state.phase === 'idle' || state.phase === 'error'
  const canStart = idle && busy === null && startHint === undefined
  const caption = onAir && reused !== null ? (reused ? 'réutilisée' : 'nouvelle')
    : sel?.pending ? 'nouvelle'
    : summary ? STATUS[summary.status].label.toLowerCase() : null
  const watermarkTarget: WatermarkTarget = sel?.pending ? { pending: true }
    : summary ? { watermark: summary.watermark } : null
  const profile = !sel ? null
    : sel.pending ? (data?.profiles.find((p) => p.id === sel.pending?.profileId)?.name ?? '—')
    : 'Défini par la session'

  // ---- Actions (plain functions: buttons, sheets and menu/tray commands share them) ----
  const startSession = async (target: Selection): Promise<void> => {
    if (busyRef.current) return
    setBusy(onAir ? 'switch' : 'start')
    setError(null)
    try {
      if (target.pending?.profileId !== undefined) await window.lintoLive.setup.save({ profileId: target.pending.profileId })
      const r = await window.lintoLive.live.start(target.name)
      if (r.ok) {
        setReused(r.reused)
        setSel({ name: target.name })
      } else setError(r.message)
    } catch (e) {
      setError(ipcErrorMessage(e))
    } finally {
      setBusy(null)
      void refresh()
    }
  }
  const start = (): void => { if (canStart && sel) void startSession(sel) }
  const stop = async (): Promise<void> => {
    if (busyRef.current || !onAir) return
    setBusy('stop')
    setError(null)
    try {
      await window.lintoLive.live.stop()
      setReused(null)
    } catch (e) {
      setError(ipcErrorMessage(e))
    } finally {
      setBusy(null)
      void refresh()
    }
  }
  // Buttons cannot reach a sheet's background, but menu/tray commands can: never replace an open sheet.
  const askTerminate = (): void => { if (onAir && !busyRef.current && !sheetRef.current) setSheet({ kind: 'terminate' }) }
  const terminate = async (): Promise<void> => {
    setSheet(null)
    if (busyRef.current) return
    setBusy('terminate')
    setError(null)
    try {
      await window.lintoLive.live.terminate()
      setSel(null)
      setReused(null)
    } catch (e) {
      setError(ipcErrorMessage(e))
    } finally {
      setBusy(null)
      void refresh()
    }
  }
  const showOutput = (): void => {
    window.lintoLive.live.showOutputWindow().catch((e) => setError(ipcErrorMessage(e)))
  }
  const openNew = (): void => { if (!busyRef.current && !sheetRef.current) setSheet({ kind: 'new' }) }
  const logout = async (): Promise<void> => {
    if (onAir) return
    try {
      await window.lintoLive.auth.logout()
      onLoggedOut()
    } catch (e) { setError(ipcErrorMessage(e)) }
  }

  const select = (s: SessionSummary): void => {
    if (!onAir) {
      if (sel?.name !== s.name || sel.pending) setReused(null)
      setSel({ name: s.name })
      return
    }
    // On air: clicking another session offers to switch the show to it.
    if (busyRef.current || s.name === liveName || !s.canStream) return
    setSheet({ kind: 'switch', target: { name: s.name } })
  }
  const submitNew = (name: string, profileId: number | undefined): void => {
    const existing = sessions?.find((s) => s.name === name)
    const target: Selection = existing ? { name } : { name, pending: { profileId } }
    if (!onAir) {
      setSheet(null)
      setReused(null)
      setSel(target)
      return
    }
    if (existing && (name === liveName || !existing.canStream)) {
      setSheet(null)
      if (name !== liveName) setError(NO_STREAM_REASON)
      return
    }
    setSheet({ kind: 'switch', target })
  }

  const saveSettings = (patch: Partial<Settings>): void => {
    setSettings((s) => (s ? { ...s, ...patch } : s))
    window.lintoLive.setup.save(patch).catch((e) => setError(ipcErrorMessage(e)))
  }
  /** Saved on the LinTO session (like LinTO Studio); shown at once, rolled back by a refresh on failure. */
  const saveWatermark = (patch: Partial<Watermark>): void => {
    if (!summary) return
    const w: Watermark = { ...summary.watermark, ...patch }
    const id = summary.id
    setSessions((list) => list?.map((x) => (x.id === id ? { ...x, watermark: w } : x)) ?? list)
    window.lintoLive.sessions.setWatermark(id, w).catch((e) => {
      setError(ipcErrorMessage(e))
      void refresh()
    })
  }
  const clearSubtitles = (): void => {
    window.lintoLive.live.clearSubtitles().catch((e) => setError(ipcErrorMessage(e)))
  }
  const switchOrg = async (orgId: string): Promise<void> => {
    if (onAir) return // the show on air belongs to the current organisation
    try {
      await window.lintoLive.setup.save({ orgId })
      setSel(null)
      setSessions(null)
      await Promise.all([loadSetup(), refresh()])
    } catch (e) { setError(ipcErrorMessage(e)) }
  }

  const run = (c: MainWindowCommand): void => {
    switch (c) {
      case 'start': start(); break
      case 'stop': void stop(); break
      case 'new-session': openNew(); break
      case 'terminate': askTerminate(); break
      case 'logout': void logout(); break
      case 'show-output': if (onAir) showOutput(); break
    }
  }
  const title = sel?.name ?? liveName ?? null
  useEffect(() => {
    if (!commands) return
    commands.current = { run, sessionName: title, canStart }
  })
  useEffect(() => () => { if (commands) commands.current = null }, [commands])
  // The app menu and the tray enable their items from this.
  useEffect(() => {
    window.lintoLive.app
      .reportShellState({ loggedIn: true, ...(title ? { sessionName: title } : {}), canStart })
      .catch(() => {})
  }, [title, canStart])

  // ---- Layout ----
  const banners = (
    <>
      {authRequired && onAir && (
        <Banner tone="warn" action={<Button onClick={() => setSheet({ kind: 'login' })}>Se reconnecter</Button>}>
          Session LinTO expirée — le direct continue.
        </Banner>
      )}
      {state.warning && <Banner tone="warn">{state.warning}</Banner>}
      {loadError && (
        <Banner tone="bad" action={<Button onClick={() => void loadSetup()}>Réessayer</Button>}>
          <span className="selectable">{loadError}</span>
        </Banner>
      )}
      {error && (
        <Banner tone="bad" action={
          <Button variant="plain" aria-label="Fermer" title="Fermer" icon={<CloseIcon size={12} />} onClick={() => setError(null)} />
        }>
          <span className="selectable">{error}</span>
        </Banner>
      )}
    </>
  )
  const hasBanner = (authRequired && onAir) || !!state.warning || !!loadError || !!error

  return (
    <div className="main-window">
      <Sidebar
        sessions={sessions}
        error={listError}
        onRetry={() => void refresh()}
        selectedName={sel && !sel.pending ? sel.name : null}
        pendingName={sel?.pending ? sel.name : null}
        onSelect={select}
        onNew={openNew}
        instance={settings?.instance ?? ''}
        organizations={data?.organizations ?? []}
        orgId={settings?.orgId}
        onSwitchOrg={(id) => void switchOrg(id)}
        onLogout={() => void logout()}
        onAir={onAir}
      />
      <div className="content">
        <Toolbar
          title={title}
          caption={caption}
          onAir={onAir}
          startedAt={state.startedAt}
          busy={busy}
          canStart={canStart}
          startHint={startHint}
          onStart={start}
          onStop={() => void stop()}
          onShowOutput={showOutput}
          onTerminate={askTerminate}
        />
        <div className="content-body">
          <Stage hasCamera={!!settings?.videoDeviceId} banners={hasBanner ? banners : null} />
          <Inspector data={data} settings={settings} profile={profile} onChange={saveSettings}
            onAir={onAir} onClearSubtitles={clearSubtitles}
            watermark={watermarkTarget} onWatermarkChange={saveWatermark}
            onWatermarkSettings={() => { if (!sheetRef.current) setSheet({ kind: 'watermark' }) }} />
        </div>
        <StatusBar state={state} onAir={onAir} />
      </div>

      <NewSessionSheet
        open={sheet?.kind === 'new'}
        organizations={onAir ? [] : data?.organizations ?? []}
        orgId={settings?.orgId}
        profiles={data?.profiles ?? []}
        profileId={settings?.profileId}
        onOrgChange={(id) => void switchOrg(id)}
        onSubmit={submitNew}
        onCancel={() => setSheet(null)}
      />
      <ConfirmSheet
        open={sheet?.kind === 'terminate'}
        message={`Terminer définitivement « ${liveName ?? title ?? ''} » ?`}
        confirmLabel="Terminer"
        destructive
        onConfirm={() => void terminate()}
        onCancel={() => setSheet(null)}
      />
      <ConfirmSheet
        open={sheet?.kind === 'switch'}
        message={`Basculer le direct sur « ${sheet?.kind === 'switch' ? sheet.target.name : ''} » ?`}
        confirmLabel="Basculer"
        onConfirm={() => { if (sheet?.kind === 'switch') { const t = sheet.target; setSheet(null); void startSession(t) } }}
        onCancel={() => setSheet(null)}
      />
      <WatermarkSheet
        open={sheet?.kind === 'watermark' && !!summary}
        watermark={summary?.watermark ?? null}
        onApply={(w) => { setSheet(null); saveWatermark(w) }}
        onCancel={() => setSheet(null)}
      />
      <Sheet title="Se reconnecter à LinTO" open={sheet?.kind === 'login'} onClose={() => setSheet(null)} footer={null}>
        <Login
          embedded
          onLoggedIn={() => { setSheet(null); onReauthenticated(); void loadSetup(); void refresh() }}
          onCancel={() => setSheet(null)}
        />
      </Sheet>
    </div>
  )
}
