import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { existsSync, readdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { shutdownWithCap } from './shutdown'
import { uninstallTargets, runUninstall, UninstallError } from './uninstall'
import { IPC, type LiveState, type SetupData } from '../shared/ipc'
import type { Settings } from '../shared/types'
import { appPaths } from './paths'
import { SettingsStore } from './settings'
import { ObsProcess } from './obs/process'
import { ObsController } from './obs/controller'
import { obsExecutable } from './obs/locate'
import { ensureObsRuntime } from './obs/runtime'
import { LintoApi } from './linto/api'
import { CaptionStream } from './linto/captions'
import { loadInstance, type LintoUrls } from './linto/instance'
import { loginWithPassword, ssoLogin } from './linto/auth'
import { OverlayServer } from './overlay/server'
import { LiveController } from './live'
import { loadSetupData } from './setupData'
import { QUIT_DIALOG, acquireSingleInstance, createQuitGuard, focusWindow } from './appLifecycle'

const SHUTDOWN_CAP_MS = 15_000

let win: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 900,
    height: 640,
    title: 'LinTO Live',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  w.on('page-title-updated', (e) => e.preventDefault())
  if (process.env['ELECTRON_RENDERER_URL']) {
    void w.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void w.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return w
}

function send(channel: string, payload?: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function main(): void {
  const platform = process.platform
  const paths = appPaths(app.getPath('userData'), platform)
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

  live.on('state', (s: LiveState) => send(IPC.evtLiveState, s))
  live.on('preview', (d: string) => send(IPC.evtPreview, d))
  live.on('audio-level', (db: number) => send(IPC.evtAudioLevel, db))
  live.on('auth-required', () => send(IPC.evtAuthRequired))

  const loggedIn = (t: string): void => {
    settings.setToken(t)
    live.resumeCaptions()
  }

  ipcMain.handle(IPC.authMethods, async () => {
    await ensureUrls()
    return api.authMethods()
  })
  ipcMain.handle(IPC.authLoginLocal, async (_e, email: string, pw: string) => {
    await ensureUrls()
    loggedIn(await loginWithPassword(api, email, pw)) // 401 → InvalidCredentialsError
  })
  ipcMain.handle(IPC.authLoginSso, async (_e, path: string, email?: string) => {
    await ensureUrls()
    const method = (await api.authMethods()).find((m) => m.path === path) ?? { path, from: '', name: path }
    if (!win || win.isDestroyed()) throw new Error('Fenêtre principale indisponible')
    loggedIn(await ssoLogin(urls, method, win, email === undefined ? {} : { email }))
  })
  ipcMain.handle(IPC.authLogout, async () => {
    settings.setToken(null)
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
  // SettingsStore validates the instance URL and drops the token when the instance changes.
  ipcMain.handle(IPC.setupSave, (_e, patch: Partial<Settings>) => live.saveSettings(patch))

  ipcMain.handle(IPC.liveStart, async (_e, name: string) => {
    await ensureUrls()
    return live.start(name)
  })
  ipcMain.handle(IPC.liveStop, () => live.stop())
  ipcMain.handle(IPC.liveTerminate, () => live.terminate())
  ipcMain.handle(IPC.liveShowOutput, () => live.showOutputWindow())
  let uninstalling = false
  const shutdownCapped = (): Promise<void> => shutdownWithCap(() => live.shutdown(), () => obs.killNow(), SHUTDOWN_CAP_MS)
  const show = (opts: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> => {
    const parent = win && !win.isDestroyed() ? win : undefined
    return parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts)
  }
  // Closing the app = Arrêter (stop the show, quit OBS, 15 s cap) — confirmed first while live.
  const quitGuard = createQuitGuard({
    phase: () => live.getState().phase,
    ask: async () => (await show(QUIT_DIALOG)).response === 1,
    quit: () => app.quit(),
    shutdown: () => void shutdownCapped().finally(() => app.exit(0))
  })

  ipcMain.handle(IPC.appUninstall, async () => {
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
  })

  app.on('before-quit', (e) => quitGuard.onBeforeQuit(e))

  win = createWindow()
  win.on('close', (e) => quitGuard.onWindowClose(e))
  win.webContents.on('did-finish-load', () => send(IPC.evtLiveState, live.getState()))
  // OBS + overlay start before login so device lists are ready for the setup screen.
  live.boot().catch((err) => console.error('OBS boot failed', err)) // state carries MSG_BOOT_FAILED
}

app.setName('LinTO Live')
// A second instance would start a second OBS on the same profile: it quits before booting anything.
if (acquireSingleInstance(app, () => focusWindow(win))) {
  void app.whenReady().then(main)
  app.on('window-all-closed', () => app.quit())
}
