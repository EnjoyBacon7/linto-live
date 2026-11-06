import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { join } from 'node:path'
import { IPC, type LiveState, type SetupData } from '../shared/ipc'
import { UnauthorizedError, type SavedDisplay, type Settings } from '../shared/types'
import { appPaths } from './paths'
import { SettingsStore } from './settings'
import { ObsProcess } from './obs/process'
import { ObsController } from './obs/controller'
import { obsExecutable } from './obs/locate'
import { LintoApi } from './linto/api'
import { CaptionStream } from './linto/captions'
import { loadInstance, type LintoUrls } from './linto/instance'
import { loginWithPassword, ssoLogin } from './linto/auth'
import { OverlayServer } from './overlay/server'
import { LiveController } from './live'

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
  const obs = new ObsProcess({
    exe: obsExecutable({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, platform, env: process.env }),
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

  /** Any LinTO 401 outside the password login: let the controller decide (token kept during a show). */
  const guarded = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    } catch (e) {
      if (e instanceof UnauthorizedError) live.reportUnauthorized()
      throw e
    }
  }

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

  ipcMain.handle(IPC.setupLoad, () =>
    guarded(async (): Promise<SetupData> => {
      await ensureUrls()
      const s = settings.get()
      const organizations = await api.organizations()
      const orgId = s.orgId ?? (organizations.length === 1 ? organizations[0].id : undefined)
      const profiles = orgId ? await api.transcriberProfiles(orgId) : []
      const devices = await live.listDevices()
      return { settings: s, organizations, profiles, ...devices }
    })
  )
  ipcMain.handle(IPC.setupSave, async (_e, patch: Partial<Settings>) => {
    const before = settings.get().instance
    await live.saveSettings(patch)
    if (patch.instance !== undefined && patch.instance !== before) settings.setToken(null) // token belongs to the old instance
  })

  ipcMain.handle(IPC.liveStart, async (_e, name: string) => {
    await ensureUrls()
    return live.start(name)
  })
  ipcMain.handle(IPC.liveStop, () => live.stop())
  ipcMain.handle(IPC.liveTerminate, () => live.terminate())
  ipcMain.handle(IPC.liveChangeDisplay, (_e, d: SavedDisplay) => live.changeDisplay(d))
  // IPC.appUninstall: registered by Task 15.

  // Closing the app = Arrêter: stop the show and quit OBS before exiting (15 s cap).
  let quitting = false
  app.on('before-quit', (e) => {
    if (quitting) return
    quitting = true
    e.preventDefault()
    const cap = new Promise<void>((r) => setTimeout(r, SHUTDOWN_CAP_MS))
    void Promise.race([live.shutdown().catch((err) => console.error('shutdown failed', err)), cap]).finally(() =>
      app.exit(0)
    )
  })

  win = createWindow()
  win.webContents.on('did-finish-load', () => send(IPC.evtLiveState, live.getState()))
  // OBS + overlay start before login so device lists are ready for the setup screen.
  live.boot().catch((err) => console.error('OBS boot failed', err))
}

app.setName('LinTO Live')
void app.whenReady().then(main)
app.on('window-all-closed', () => app.quit())
