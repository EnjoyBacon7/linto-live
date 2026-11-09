import {
  app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, net, Notification, protocol, safeStorage, screen, session,
  shell, Tray
} from 'electron'
import { existsSync, readdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { shutdownWithCap } from './shutdown'
import { uninstallTargets, runUninstall, UninstallError } from './uninstall'
import { IPC, type AppCommand, type LiveState, type SetupData, type ShellReport } from '../shared/ipc'
import { UnauthorizedError, type Settings, type SessionSummary } from '../shared/types'
import { appPaths } from './paths'
import { SettingsStore } from './settings'
import { ObsProcess } from './obs/process'
import { ObsController } from './obs/controller'
import { obsExecutable } from './obs/locate'
import { ensureObsRuntime } from './obs/runtime'
import { LintoApi } from './linto/api'
import { CaptionStream } from './linto/captions'
import { loadInstance, type LintoUrls } from './linto/instance'
import {
  LEGACY_SSO_DIR,
  applyRemember,
  canRememberLogin,
  clearSsoSession,
  loginWithPassword,
  mainWindowTitle,
  ssoLogin
} from './linto/auth'
import { OverlayServer } from './overlay/server'
import { LiveController } from './live'
import { RENDERER_SCHEME, denyAllPermissions, lockNavigation, rendererEntry, rendererFilePath } from './security'
import { loadSetupData, toSessionSummaries } from './setupData'
import {
  QUIT_DIALOG, WINDOW_SIZE, acquireSingleInstance, createQuitGuard, focusWindow, restoreBounds, windowChrome
} from './appLifecycle'
import {
  AUTH_NOTIFICATION, appMenuTemplate, notificationFor, stableStream, trayIconName, trayMenuTemplate, trayTooltip,
  type NotificationText, type ShellState
} from './nativeShell'

const SHUTDOWN_CAP_MS = 15_000

let win: BrowserWindow | null = null
/** Module-level so the menu-bar icon is never garbage-collected. */
let tray: Tray | null = null

function createWindow(settings: SettingsStore): BrowserWindow {
  const bounds = restoreBounds(
    settings.get().windowBounds,
    screen.getAllDisplays().map((d) => d.workArea),
    { width: WINDOW_SIZE.width, height: WINDOW_SIZE.height }
  )
  const w = new BrowserWindow({
    ...bounds,
    minWidth: WINDOW_SIZE.minWidth,
    minHeight: WINDOW_SIZE.minHeight,
    title: 'LinTO Live',
    ...windowChrome(process.platform, nativeTheme.shouldUseDarkColors),
    // Linux: the taskbar / Alt-Tab icon comes from the window (macOS uses the bundle's icon).
    ...(process.platform === 'linux'
      ? { icon: app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'build', 'icon.png') }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  w.on('page-title-updated', (e) => e.preventDefault())
  // Remember where the window was (normal bounds, even when maximized/fullscreen); written on close
  // and, debounced, after a resize/move so a crash does not lose it.
  let timer: NodeJS.Timeout | undefined
  const saveBounds = (): void => {
    clearTimeout(timer)
    timer = undefined
    if (w.isDestroyed()) return
    try {
      settings.update({ windowBounds: w.getNormalBounds() })
    } catch (e) {
      console.error('Saving the window bounds failed', e)
    }
  }
  const saveSoon = (): void => {
    clearTimeout(timer)
    timer = setTimeout(saveBounds, 1000)
  }
  w.on('resize', saveSoon)
  w.on('move', saveSoon)
  w.on('close', saveBounds)
  // A packaged app ignores ELECTRON_RENDERER_URL: an environment variable must not choose its UI.
  const entry = rendererEntry(app.isPackaged, process.env['ELECTRON_RENDERER_URL'])
  lockNavigation(w.webContents, entry)
  void w.loadURL(entry)
  return w
}

function send(channel: string, payload?: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

/** Serves out/renderer over app://linto-live/ (see security.ts). */
function serveRenderer(): void {
  const root = join(__dirname, '../renderer')
  protocol.handle(RENDERER_SCHEME, (req) => {
    const file = rendererFilePath(req.url, root)
    return file ? net.fetch(pathToFileURL(file).toString()) : new Response('Not found', { status: 404 })
  })
}

function main(): void {
  denyAllPermissions(session.defaultSession)
  // Older versions kept the SSO cookies on disk (persist:linto-sso) in plaintext.
  void rm(join(app.getPath('userData'), ...LEGACY_SSO_DIR), { recursive: true, force: true }).catch(() => {})
  serveRenderer()
  const platform = process.platform
  const paths = appPaths(app.getPath('userData'), platform)
  // Linux without a usable keyring (no gnome-keyring / KWallet, or none unlocked): safeStorage falls
  // back to 'basic_text' and refuses to encrypt, so logging in would fail. Use Chromium's fixed-key
  // obfuscation instead, like Chrome does; settings.json stays 0600 in the user's home.
  if (platform === 'linux' && !safeStorage.isEncryptionAvailable()) {
    console.warn(`No usable keyring (${safeStorage.getSelectedStorageBackend()}): the LinTO token is only obfuscated`)
    safeStorage.setUsePlainTextEncryption(true)
  }
  const settings = new SettingsStore(paths, {
    encrypt: (s) => safeStorage.encryptString(s),
    decrypt: (b) => safeStorage.decryptString(b)
  })

  // LintoApi / CaptionStream read their URLs at call time: share one mutable object, filled from
  // <instance>/config.js on first use and refilled when the instance setting changes.
  const urls: LintoUrls = { instance: '', api: '', auth: '', wsUrl: '', wsPath: '' }
  let urlsFor: string | null = null
  let urlsLoading: Promise<void> | null = null
  const ensureUrls = (): Promise<void> => {
    const inst = settings.get().instance
    if (urlsFor === inst) return Promise.resolve()
    if (!urlsLoading) {
      urlsLoading = loadInstance(inst)
        .then((u) => {
          Object.assign(urls, u)
          urlsFor = inst
        })
        .finally(() => (urlsLoading = null))
    }
    return urlsLoading.then(() => (urlsFor === inst ? undefined : ensureUrls()))
  }

  const token = (): string | null => settings.getToken()
  const api = new LintoApi(urls, token)
  const captions = new CaptionStream(urls, token)
  const overlay = new OverlayServer({ pageDir: join(app.getAppPath(), 'out/main/overlay-page') })
  let obsExe = obsExecutable({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, platform, env: process.env })
  if (app.isPackaged && platform === 'darwin') {
    // OBS's CEF cannot start from inside LinTO Live.app: run an APFS clone under userData (see runtime.ts).
    try {
      obsExe = ensureObsRuntime({
        bundledApp: join(process.resourcesPath, 'obs', 'OBS.app'),
        runtimeDir: join(paths.userData, 'obs-runtime')
      })
    } catch (e) {
      console.error('OBS runtime copy failed, using the embedded OBS.app', e)
    }
  }
  const obs = new ObsProcess({
    exe: obsExe,
    paths,
    platform
  })
  const live = new LiveController({
    obs,
    controllerFactory: (c) => ObsController.connect(c),
    api,
    captions,
    overlay,
    settings,
    platform
  })

  // ---- Native shell: app menu, menu-bar icon, notifications ----
  let report: ShellReport = { loggedIn: false, canStart: false }
  const shellState = (): ShellState => {
    const s = live.getState()
    const name = (s.phase !== 'idle' && s.phase !== 'error' ? s.session?.name : undefined) ?? report.sessionName
    return { platform, loggedIn: report.loggedIn, phase: s.phase, canStart: report.canStart, ...(name ? { sessionName: name } : {}) }
  }
  const trayDir = app.isPackaged ? join(process.resourcesPath, 'tray') : join(app.getAppPath(), 'resources', 'tray')
  const trayImage = (phase: LiveState['phase']): Electron.NativeImage => {
    const file = join(trayDir, `${trayIconName(phase, platform)}.png`)
    const img = nativeImage.createFromPath(file) // @2x picked up automatically
    if (img.isEmpty()) console.error('Tray icon missing:', file)
    if (platform === 'darwin') img.setTemplateImage(true)
    return img
  }
  const showWindow = (): void => focusWindow(win)
  let shellKey = ''
  const rebuildShell = (): void => {
    const st = shellState()
    const key = JSON.stringify(st)
    if (key === shellKey) return
    shellKey = key
    Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate(st, runCommand)))
    if (tray && !tray.isDestroyed()) {
      tray.setImage(trayImage(st.phase))
      tray.setToolTip(trayTooltip(st))
      tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate(st, runCommand)))
    }
  }
  // Shown notifications are kept referenced until clicked or closed, or their 'click' may never fire (GC).
  const notes = new Set<Notification>()
  // Only when the user is looking elsewhere: the window shows the same information otherwise.
  const notify = (n: NotificationText): void => {
    if (!Notification.isSupported()) return
    if (win && !win.isDestroyed() && win.isVisible() && win.isFocused()) return
    const note = new Notification({ title: n.title, body: n.body })
    notes.add(note)
    note.on('click', () => {
      notes.delete(note)
      showWindow()
    })
    note.on('close', () => notes.delete(note))
    note.show()
  }

  let prevState = live.getState()
  let lastStableStream = prevState.stream
  live.on('state', (s: LiveState) => {
    send(IPC.evtLiveState, s)
    const n = notificationFor(prevState, s, lastStableStream)
    lastStableStream = stableStream(lastStableStream, s)
    prevState = s
    if (n) notify(n)
    rebuildShell()
  })
  live.on('caption-line', (line: string) => send(IPC.evtCaptionLine, line))
  live.on('preview', (d: string) => send(IPC.evtPreview, d))
  live.on('audio-level', (db: number) => send(IPC.evtAudioLevel, db))
  live.on('auth-required', () => {
    send(IPC.evtAuthRequired)
    notify(AUTH_NOTIFICATION)
  })
  ipcMain.handle(IPC.shellState, (_e, r: ShellReport) => {
    report = {
      loggedIn: r?.loggedIn === true,
      canStart: r?.canStart === true,
      ...(typeof r?.sessionName === 'string' && r.sessionName ? { sessionName: r.sessionName } : {})
    }
    rebuildShell()
    syncTitle()
  })

  // The login screen's title names the instance (password managers match on it).
  const syncTitle = (): void => {
    if (win && !win.isDestroyed()) win.setTitle(mainWindowTitle(report.loggedIn, settings.get().instance))
  }
  const canRemember = (): boolean =>
    canRememberLogin(
      platform,
      safeStorage.isEncryptionAvailable(),
      platform === 'linux' ? safeStorage.getSelectedStorageBackend() : undefined
    )

  const loggedIn = (t: string): void => {
    settings.setToken(t)
    live.resumeCaptions()
  }

  ipcMain.handle(IPC.authMethods, async () => {
    await ensureUrls()
    return api.authMethods()
  })
  ipcMain.handle(IPC.authLoginLocal, async (_e, email: string, pw: string, remember?: boolean) => {
    await ensureUrls()
    loggedIn(await loginWithPassword(api, email, pw)) // 401 → InvalidCredentialsError
    // Only a password LinTO accepted is kept.
    applyRemember(settings, canRemember(), email, pw, typeof remember === 'boolean' ? remember : undefined)
  })
  ipcMain.handle(IPC.authSavedLogin, async () => {
    const ok = canRemember()
    return { canRemember: ok, login: ok ? settings.getSavedLogin() : null }
  })
  ipcMain.handle(IPC.authLoginSso, async (_e, path: string, email?: string) => {
    await ensureUrls()
    const method = (await api.authMethods()).find((m) => m.path === path) ?? { path, from: '', name: path }
    if (!win || win.isDestroyed()) throw new Error('Fenêtre principale indisponible')
    loggedIn(await ssoLogin(urls, method, win, email === undefined ? {} : { email }))
  })
  ipcMain.handle(IPC.authLogout, async () => {
    settings.setToken(null)
    settings.setSavedLogin(null) // logging out means « forget me » too (shared control-room machines)
    await clearSsoSession().catch((e) => console.error('Clearing the SSO session failed', e))
  })
  ipcMain.handle(IPC.authStatus, async () => ({ loggedIn: settings.getToken() !== null }))

  ipcMain.handle(IPC.setupLoad, async (): Promise<SetupData> => {
    await ensureUrls()
    return loadSetupData({
      getSettings: () => settings.get(),
      hasToken: () => settings.getToken() !== null,
      organizations: () => api.organizations(),
      profiles: (orgId) => api.transcriberProfiles(orgId),
      devices: () => live.listDevices(),
      saveSettings: (p) => live.saveSettings(p),
      // Clears a stale token (unless a show is live) and asks the UI to log in.
      onUnauthorized: () => live.reportUnauthorized()
    })
  })
  ipcMain.handle(IPC.sessionsList, async (): Promise<SessionSummary[]> => {
    const orgId = settings.get().orgId
    if (!orgId) return []
    await ensureUrls()
    try {
      return toSessionSummaries(await api.listSessions(orgId))
    } catch (e) {
      if (e instanceof UnauthorizedError) live.reportUnauthorized()
      throw e
    }
  })
  // SettingsStore validates the instance URL and drops the token when the instance changes.
  ipcMain.handle(IPC.setupSave, async (_e, patch: Partial<Settings>) => {
    await live.saveSettings(patch)
    syncTitle()
  })

  ipcMain.handle(IPC.liveStart, async (_e, name: string) => {
    await ensureUrls()
    return live.start(name)
  })
  ipcMain.handle(IPC.liveStop, () => live.stop())
  ipcMain.handle(IPC.liveTerminate, () => live.terminate())
  ipcMain.handle(IPC.liveShowOutput, () => live.showOutputWindow())
  ipcMain.handle(IPC.liveGetState, () => live.getState())
  ipcMain.handle(IPC.previewSubscribe, () => live.setPreviewSubscribed(true))
  ipcMain.handle(IPC.previewUnsubscribe, () => live.setPreviewSubscribed(false))
  let uninstalling = false
  const shutdownCapped = (): Promise<void> => shutdownWithCap(() => live.shutdown(), () => obs.killNow(), SHUTDOWN_CAP_MS)
  const show = (opts: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> => {
    // The window may be hidden (closed during a show): bring it back so the dialog is seen.
    if (win && !win.isDestroyed() && !win.isVisible()) showWindow()
    const parent = win && !win.isDestroyed() ? win : undefined
    return parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts)
  }
  // Closing the app = Arrêter (stop the show, quit OBS, 15 s cap) — confirmed first while live.
  const quitGuard = createQuitGuard({
    phase: () => live.getState().phase,
    ask: async () => (await show(QUIT_DIALOG)).response === 1,
    quit: () => app.quit(),
    shutdown: () => void shutdownCapped().finally(() => app.exit(0)),
    // Closing the window during a show keeps it running. Linux: minimised, not hidden — a Tray object
    // exists even where the desktop shows no tray (GNOME without the AppIndicator extension), and a
    // hidden window would then be unreachable.
    hide: () => {
      if (!win || win.isDestroyed()) return
      if (platform === 'darwin') win.hide()
      else win.minimize()
    }
  })

  const uninstall = async (): Promise<void> => {
    if (uninstalling) return
    if (!app.isPackaged) {
      await show({ type: 'info', message: 'Désinstallation indisponible en mode développement.', buttons: ['OK'] })
      return
    }
    const home = homedir()
    let plan: ReturnType<typeof uninstallTargets>
    try {
      const appsDir = join(home, '.local/share/applications')
      const desktopFiles =
        platform === 'linux' && existsSync(appsDir)
          ? readdirSync(appsDir)
              .filter((f) => f.includes('linto-live') && f.endsWith('.desktop'))
              .map((f) => join(appsDir, f))
          : []
      plan = uninstallTargets({
        platform,
        home,
        userData: app.getPath('userData'),
        appId: 'ai.linto.live',
        appName: 'LinTO Live',
        exePath: app.getPath('exe'),
        ...(process.env.APPIMAGE ? { appImage: process.env.APPIMAGE } : {}),
        personalObsInstalled: existsSync('/Applications/OBS.app') || existsSync(join(home, 'Applications/OBS.app')),
        desktopFiles
      })
    } catch (err) {
      await show({ type: 'error', message: 'Désinstallation annulée par sécurité.', detail: String(err), buttons: ['OK'] })
      return
    }
    const { response } = await show({
      type: 'warning',
      message: 'Supprimer LinTO Live et toutes ses données ?',
      detail: 'Cette action est définitive.',
      buttons: ['Annuler', 'Désinstaller'],
      defaultId: 0,
      cancelId: 0
    })
    if (response !== 1) return
    uninstalling = true
    quitGuard.markQuitting() // shutdown is done explicitly below; ignore close/before-quit
    await shutdownCapped() // stop the show and OBS (killed on timeout/failure) before touching userData
    // No late IPC may re-create userData once it is deleted.
    if (win && !win.isDestroyed()) win.destroy()
    win = null
    try {
      await runUninstall(plan, {
        rm: (p) => rm(p, { recursive: true, force: true }),
        trash: (p) => shell.trashItem(p)
      })
    } catch (err) {
      const failed = err instanceof UninstallError ? err.failed : [String(err)]
      await show({
        type: 'error',
        message: 'Certains éléments n’ont pas pu être supprimés.',
        detail: failed.join('\n'),
        buttons: ['OK']
      })
    }
    app.exit(0)
  }
  ipcMain.handle(IPC.appUninstall, uninstall)

  const failed = (what: string) => (err: unknown): void => {
    console.error(what, err)
    void show({ type: 'error', message: what, detail: err instanceof Error ? err.message : String(err), buttons: ['OK'] })
  }
  /** App menu / tray: main carries out what needs no window; the rest goes to the renderer like a button click. */
  function runCommand(c: AppCommand): void {
    switch (c) {
      case 'stop': live.stop().catch(failed('Arrêt impossible.')); return
      case 'show-output': live.showOutputWindow().catch(failed('Impossible d’afficher la fenêtre de sortie.')); return
      case 'show-window': showWindow(); return
      case 'uninstall': void uninstall(); return
      case 'quit': app.quit(); return
      default:
        // Sheets (Nouvelle session, Terminer) and the login screen need the window in front.
        if (c !== 'start') showWindow()
        send(IPC.evtCommand, c)
    }
  }

  app.on('before-quit', (e) => quitGuard.onBeforeQuit(e))

  win = createWindow(settings)
  win.on('close', (e) => quitGuard.onWindowClose(e))
  win.webContents.on('did-finish-load', () => send(IPC.evtLiveState, live.getState()))
  // A reloaded (or crashed) page re-subscribes when its preview mounts.
  win.webContents.on('did-start-loading', () => live.setPreviewSubscribed(false))
  win.webContents.on('render-process-gone', () => live.setPreviewSubscribed(false))
  // No OBS screenshots nor audio levels for a window nobody sees.
  win.on('hide', () => live.setWindowVisible(false))
  win.on('minimize', () => live.setWindowVisible(false))
  win.on('show', () => live.setWindowVisible(!win?.isMinimized()))
  win.on('restore', () => live.setWindowVisible(true))
  app.on('activate', showWindow) // Dock click brings back a window hidden during a show

  rebuildShell()
  try {
    tray = new Tray(trayImage(live.getState().phase))
    shellKey = '' // fill the new icon's tooltip and menu
    rebuildShell()
  } catch (e) {
    // Some Linux desktops have no tray: the window stays the entry point.
    console.error('Tray icon unavailable', e)
    tray = null
  }
  // OBS + overlay start before login so device lists are ready for the setup screen.
  live.boot().catch((err) => console.error('OBS boot failed', err)) // state carries MSG_BOOT_FAILED
}

app.setName('LinTO Live')
// Before 'ready': the renderer's origin behaves like https (secure context, fetch, CSP 'self').
protocol.registerSchemesAsPrivileged([
  { scheme: RENDERER_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
])
// A second instance would start a second OBS on the same profile: it quits before booting anything.
if (acquireSingleInstance(app, () => focusWindow(win))) {
  void app.whenReady().then(main)
  app.on('window-all-closed', () => app.quit())
}
