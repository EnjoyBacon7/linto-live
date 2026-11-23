import {
  app, BrowserWindow, desktopCapturer, dialog, ipcMain, Menu, nativeImage, nativeTheme, net, Notification, protocol, safeStorage, screen, session,
  shell, systemPreferences, Tray
} from 'electron'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import QRCode from 'qrcode'
import { shutdownWithCap } from './shutdown'
import { uninstallTargets, uninstallConfirmDetail, runUninstall, UninstallError } from './uninstall'
import { IPC, checkNewSessionOptions, checkSettingsPatch, type AppCommand, type LiveState, type SetupData, type ShellReport } from '../shared/ipc'
import {
  TRANSCRIPT_EXPORT_FORMATS, UnauthorizedError, type CaptureTargets, type MediaAccess, type Settings, type SessionLookup, type SessionSummary, type TranscriptExportFormat,
  type TranscriptUpdate, type WatermarkConfig
} from '../shared/types'
import { appPaths } from './paths'
import { SettingsStore } from './settings'
import { openBroadcast } from './broadcast/relay'
import { isBroadcastServer } from '../shared/broadcast'
import { ObsProcess } from './obs/process'
import { ObsController } from './obs/controller'
import { lumaOfBgra } from './obs/fallback'
import { obsExecutable } from './obs/locate'
import { MAC_OBS_RUNTIME_DIR, placeObsRuntime } from './obs/runtime'
import { virtualCamPreflight, virtualCamUnavailableReason } from './obs/virtualCam'
import { isWaylandSession, linuxSystemChecks, statusNotifierWatcher } from './systemChecks'
import { LintoApi } from './linto/api'
import { lookupSession } from './linto/sessionResolver'
import { asLintoAction } from './linto/accessMessages'
import { CaptionStream } from './linto/captions'
import { createNameCorrector, parseCommonWords } from './linto/properNouns'
import { EXPORT_FILTERS, exportFileName, exportTranscript } from './linto/transcriptExport'
import { TRANSCRIPT_VIEW_MAX_SEGMENTS, trimTranscript } from '../shared/transcript'
import { loadInstance, STUDIO_WATERMARK_DEFAULTS, type LintoUrls } from './linto/instance'
import { checkWatermark, WATERMARK_META_KEY } from './linto/watermark'
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
import { SubtitlesWindow, electronSubtitlesHost, subtitlesWindowBounds } from './subtitlesWindow'
import { RENDERER_SCHEME, denyAllPermissions, lockNavigation, rendererEntry, rendererFilePath } from './security'
import { loadSetupData, toSessionSummaries } from './setupData'
import {
  TEST_NOTIFICATION, asMediaAccess, deferObsBoot, isMediaPermission, linuxPermissionsStatus, permissionsStatus, privacySettingsUrl, requestMediaAccess,
  type MediaAccessApi
} from './permissions'
import {
  QUIT_DIALOG, WINDOW_SIZE, acquireSingleInstance, closeDuringShow, createQuitGuard, focusWindow, restoreBounds, windowChrome
} from './appLifecycle'
import {
  AUTH_NOTIFICATION, appMenuTemplate, linuxPanelIsDark, notificationFor, recordingSavedNotification, stableStream, trayIconName,
  trayMenuTemplate, trayTooltip,
  type NotificationText, type ShellState
} from './nativeShell'

const SHUTDOWN_CAP_MS = 15_000
const MEDIA_FILTERS = {
  image: { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] },
  video: { name: 'Vidéos', extensions: ['mp4', 'mov', 'mkv', 'webm', 'm4v'] }
} satisfies Record<'image' | 'video', Electron.FileFilter>

let win: BrowserWindow | null = null
/** Module-level so the menu-bar icon is never garbage-collected. */
let tray: Tray | null = null
/** Linux: the desktop runs a StatusNotifierWatcher, so the tray icon is really there (systemChecks.ts). */
let linuxTrayShown = false

/** Linux window / About icon (macOS uses the bundle's icon). */
const linuxIconPath = (): string =>
  app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'build', 'icon.png')

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
    ...(process.platform === 'linux' ? { icon: linuxIconPath() } : {}),
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
  const flatpak = process.env.FLATPAK_ID !== undefined
  const paths = appPaths(app.getPath('userData'), platform)
  // « À propos » on Linux shows only what is set here (macOS reads the bundle's Info.plist).
  if (platform === 'linux') {
    app.setAboutPanelOptions({
      applicationName: 'LinTO Live',
      applicationVersion: app.getVersion(),
      copyright: '© LINAGORA',
      website: 'https://github.com/EnjoyBacon7/linto-live',
      iconPath: linuxIconPath()
    })
  }
  // Linux without a usable keyring (no gnome-keyring / KWallet, or none unlocked): safeStorage falls
  // back to 'basic_text' and refuses to encrypt. Allow Chromium's fixed-key obfuscation so encryptString
  // does not throw, but nothing secret is persisted with it (token in memory, password not remembered).
  if (platform === 'linux' && !safeStorage.isEncryptionAvailable()) {
    console.warn(`No usable keyring (${safeStorage.getSelectedStorageBackend()}): the LinTO token is kept in memory only`)
    safeStorage.setUsePlainTextEncryption(true)
  }
  const settings = new SettingsStore(
    paths,
    {
      encrypt: (s) => safeStorage.encryptString(s),
      decrypt: (b) => safeStorage.decryptString(b)
    },
    // Without a real keyring the token is only obfuscated: keep it in memory (log in at each launch).
    {
      persistToken: canRememberLogin(
        platform,
        safeStorage.isEncryptionAvailable(),
        platform === 'linux' ? safeStorage.getSelectedStorageBackend() : undefined
      )
    }
  )

  // LintoApi / CaptionStream read their URLs at call time: share one mutable object, filled from
  // <instance>/config.js on first use and refilled when the instance setting changes.
  const urls: LintoUrls = { instance: '', api: '', auth: '', wsUrl: '', wsPath: '' }
  const defaultRecordDir = join(app.getPath('videos'), 'LinTO Live')
  let watermarkCfg: WatermarkConfig = STUDIO_WATERMARK_DEFAULTS
  let urlsFor: string | null = null
  let urlsLoading: Promise<void> | null = null
  const ensureUrls = (): Promise<void> => {
    const inst = settings.get().instance
    if (urlsFor === inst) return Promise.resolve()
    if (!urlsLoading) {
      urlsLoading = loadInstance(inst)
        .then((u) => {
          Object.assign(urls, u.urls)
          watermarkCfg = u.watermark
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
    // OBS's CEF cannot start from inside LinTO Live.app: run an APFS clone, under /Applications so its
    // virtual camera can be activated, else under userData (see runtime.ts).
    try {
      obsExe = placeObsRuntime({
        bundledApp: join(process.resourcesPath, 'obs', 'OBS.app'),
        runtimeDirs: [MAC_OBS_RUNTIME_DIR, join(paths.userData, 'obs-runtime')]
      }, (msg, e) => console.warn(msg, e))
    } catch (e) {
      console.error('OBS runtime copy failed, using the embedded OBS.app', e)
    }
  }
  const obs = new ObsProcess({
    exe: obsExe,
    paths,
    platform
  })
  // EXPERIMENTAL proper-noun correction: the everyday-word list is read on first use only.
  let common: Set<string> | null = null
  const commonWords = (): Set<string> => {
    if (common) return common
    const dir = app.isPackaged ? join(process.resourcesPath, 'proper-nouns') : join(app.getAppPath(), 'resources', 'proper-nouns')
    try {
      common = parseCommonWords(readFileSync(join(dir, 'fr-common-words.txt'), 'utf8'))
    } catch (e) {
      console.error('proper nouns: everyday-word list unreadable', e)
      common = new Set()
    }
    return common
  }
  // Wayland session: screens and windows are captured through the ScreenCast portal (see PORTAL_CAPTURE).
  const portalCapture = platform === 'linux' && isWaylandSession(process.env)
  const live = new LiveController({
    obs,
    controllerFactory: (c) => ObsController.connect(c, { portalCapture }),
    api,
    captions,
    overlay,
    settings,
    platform,
    qrSvg: (url) => QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }),
    decodeLuma: (dataUrl) => lumaOfBgra(nativeImage.createFromDataURL(dataUrl).toBitmap()),
    watermarkConfig: () => watermarkCfg,
    mkdirp: async (dir) => {
      await mkdir(dir, { recursive: true })
    },
    defaultRecordDir,
    nameCorrector: (names) => createNameCorrector(names, commonWords()),
    openBroadcast,
    virtualCam: {
      unavailableReason: virtualCamUnavailableReason(platform),
      preflight: () => virtualCamPreflight(platform, flatpak, undefined, obsExe)
    },
    canCaptureScreen: () => platform !== 'darwin' || systemPreferences.getMediaAccessStatus('screen') === 'granted'
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
    const dark = linuxPanelIsDark(process.env.XDG_CURRENT_DESKTOP, nativeTheme.shouldUseDarkColors)
    const file = join(trayDir, `${trayIconName(phase, platform, dark)}.png`)
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
  // By default only when the user is looking elsewhere: the window shows the same information otherwise.
  const notify = (n: NotificationText, opts: { always?: boolean; onClick?: () => void } = {}): void => {
    if (!Notification.isSupported()) return
    if (!opts.always && win && !win.isDestroyed() && win.isVisible() && win.isFocused()) return
    const note = new Notification({ title: n.title, body: n.body })
    notes.add(note)
    note.on('click', () => {
      notes.delete(note)
      if (opts.onClick) opts.onClick()
      else showWindow()
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
  // A whole transcript goes to the window with its most recent segments only (as getTranscript below).
  live.on('transcript', (u: TranscriptUpdate) => send(IPC.evtTranscript,
    u.kind === 'snapshot' ? { kind: 'snapshot', transcript: trimTranscript(u.transcript, TRANSCRIPT_VIEW_MAX_SEGMENTS) } : u))
  live.on('preview', (d: string) => send(IPC.evtPreview, d))
  live.on('audio-level', (db: number) => send(IPC.evtAudioLevel, db))
  // The window does not say where the file went: always notify, a click shows it in its folder.
  live.on('recording-saved', (path: string) => {
    notify(recordingSavedNotification(path), { always: true, onClick: () => shell.showItemInFolder(path) })
  })
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
      onUnauthorized: () => live.reportUnauthorized(),
      watermarkEnabled: () => watermarkCfg.enabled,
      defaultRecordDir
    })
  })
  ipcMain.handle(IPC.sessionsList, async (): Promise<SessionSummary[]> => {
    const orgId = settings.get().orgId
    if (!orgId) return []
    await ensureUrls()
    try {
      const list = toSessionSummaries(await asLintoAction('list', () => api.listSessions(orgId)), watermarkCfg)
      live.syncWatermarks(list)
      return list
    } catch (e) {
      if (e instanceof UnauthorizedError) live.reportUnauthorized()
      throw e
    }
  })
  ipcMain.handle(IPC.sessionsLookup, async (_e, name: unknown): Promise<SessionLookup> => {
    const orgId = settings.get().orgId
    if (!orgId || typeof name !== 'string') return 'none'
    await ensureUrls()
    try {
      return await lookupSession(api, orgId, name)
    } catch (e) {
      if (e instanceof UnauthorizedError) live.reportUnauthorized()
      throw e
    }
  })
  // Same storage as LinTO Studio: the session's meta['@watermark'] (PATCH replaces the whole meta).
  ipcMain.handle(IPC.sessionsSetWatermark, async (_e, sessionId: unknown, raw: unknown) => {
    const w = checkWatermark(raw)
    const orgId = settings.get().orgId
    if (!orgId || typeof sessionId !== 'string' || !sessionId) throw new Error('Aucune session choisie.')
    await ensureUrls()
    try {
      const s = await asLintoAction('read', () => api.getSession(orgId, sessionId))
      await asLintoAction('modify', () => api.patchSessionMeta(orgId, sessionId, { ...(s.meta ?? {}), [WATERMARK_META_KEY]: w }))
    } catch (e) {
      if (e instanceof UnauthorizedError) live.reportUnauthorized()
      throw e
    }
    live.watermarkChanged(sessionId, w)
  })
  // SettingsStore validates the instance URL and drops the token when the instance changes.
  ipcMain.handle(IPC.setupSave, async (_e, raw: unknown) => {
    await live.saveSettings(checkSettingsPatch(raw))
    syncTitle()
  })

  ipcMain.handle(IPC.setupPickMedia, async (_e, kind: unknown): Promise<string | null> => {
    if (kind !== 'image' && kind !== 'video') throw new Error('Type de fichier inconnu.')
    const opts: Electron.OpenDialogOptions = {
      title: kind === 'image' ? 'Choisir une image' : 'Choisir une vidéo',
      properties: ['openFile'],
      filters: [MEDIA_FILTERS[kind]]
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })

  ipcMain.handle(IPC.setupPickFolder, async (): Promise<string | null> => {
    const opts: Electron.OpenDialogOptions = {
      title: 'Choisir un dossier',
      properties: ['openDirectory', 'createDirectory']
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })

  // macOS: listing screens or windows (and capturing them) needs the screen recording access, asked in LinTO
  // Live's name like the camera (OBS is its child). Without it OBS would wait on it: nothing is asked of OBS then.
  const screenAccess = (): MediaAccess => (platform === 'darwin' ? asMediaAccess(systemPreferences.getMediaAccessStatus('screen')) : 'granted')
  ipcMain.handle(IPC.setupListCapture, async (_e, kind: unknown): Promise<CaptureTargets> => {
    if (kind !== 'screen' && kind !== 'window') throw new Error('Type de capture inconnu.')
    const access = screenAccess()
    if (access !== 'granted') return { ok: false, access }
    if (portalCapture) return { ok: 'portal' }
    return { ok: true, items: await live.listCaptureTargets(kind) }
  })
  ipcMain.handle(IPC.setupRequestScreenAccess, async (): Promise<MediaAccess> => {
    // macOS has no API to ask for it: a first capture attempt shows the prompt (only once, ever).
    if (screenAccess() !== 'granted') {
      await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).catch(() => [])
    }
    return screenAccess()
  })

  ipcMain.handle(IPC.setupSetBroadcast, (_e, server: unknown, key: unknown) => {
    if (typeof server !== 'string' || (server.trim() !== '' && !isBroadcastServer(server.trim()))) {
      throw new Error('Adresse de serveur de diffusion invalide.')
    }
    if (key !== undefined && (typeof key !== 'string' || key.length > 1024)) throw new Error('Clé de stream invalide.')
    settings.setBroadcast(server, key)
  })

  ipcMain.handle(IPC.liveStart, async (_e, name: string, rawCreate?: unknown) => {
    const create = checkNewSessionOptions(rawCreate)
    await ensureUrls()
    return live.start(name, create)
  })
  ipcMain.handle(IPC.liveSetSubtitleLanguage, async (_e, sessionId: unknown, choice: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId || typeof choice !== 'string' || !choice) {
      throw new Error('Langue des sous-titres invalide.')
    }
    await live.setSubtitleLanguage(sessionId, choice)
  })
  ipcMain.handle(IPC.liveStop, () => live.stop())
  ipcMain.handle(IPC.liveTerminate, () => live.terminate())
  ipcMain.handle(IPC.liveShowOutput, () => live.showOutputWindow())
  ipcMain.handle(IPC.liveGetState, () => live.getState())
  // The window shows only the most recent segments (the export reads the full log below).
  ipcMain.handle(IPC.liveGetTranscript, () => trimTranscript(live.getTranscript(), TRANSCRIPT_VIEW_MAX_SEGMENTS))
  ipcMain.handle(IPC.liveViewTranscript, async (_e, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('Session invalide.')
    await ensureUrls()
    return trimTranscript(await live.viewTranscript(sessionId), TRANSCRIPT_VIEW_MAX_SEGMENTS)
  })
  ipcMain.handle(IPC.liveExportTranscript, async (_e, raw: unknown): Promise<{ saved: boolean }> => {
    if (!(TRANSCRIPT_EXPORT_FORMATS as readonly unknown[]).includes(raw)) throw new Error('Format d’export inconnu.')
    const format = raw as TranscriptExportFormat
    const t = live.getTranscript()
    if (t.finals.length === 0) throw new Error('Rien à exporter : la transcription est vide.')
    const opts = {
      title: 'Exporter la transcription',
      defaultPath: join(app.getPath('documents'), exportFileName(t, format)),
      filters: [EXPORT_FILTERS[format]]
    }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return { saved: false }
    await writeFile(r.filePath, exportTranscript(t, format), 'utf8')
    return { saved: true }
  })
  ipcMain.handle(IPC.previewSubscribe, () => live.setPreviewSubscribed(true))
  ipcMain.handle(IPC.previewUnsubscribe, () => live.setPreviewSubscribed(false))
  const subtitles = new SubtitlesWindow({
    host: electronSubtitlesHost(
      (o) => new BrowserWindow(o),
      platform,
      platform === 'linux' ? { icon: linuxIconPath() } : {}
    ),
    url: () => live.overlayPageUrl(),
    bounds: () => subtitlesWindowBounds(
      settings.get().subtitlesWindowBounds,
      screen.getAllDisplays().map((d) => d.workArea),
      screen.getPrimaryDisplay().workArea
    ),
    saveBounds: (b) => settings.update({ subtitlesWindowBounds: b }),
    onChange: (open) => send(IPC.evtSubtitlesWindow, open)
  })
  ipcMain.handle(IPC.subtitlesToggle, () => subtitles.toggle())
  ipcMain.handle(IPC.subtitlesIsOpen, () => subtitles.isOpen())
  ipcMain.handle(IPC.liveClearTranscript, () => live.clearTranscript())
  ipcMain.handle(IPC.liveSetAudioMonitor, (_e, on: unknown) => {
    if (typeof on !== 'boolean') throw new Error('Réglage invalide.')
    return live.setAudioMonitor(on)
  })
  ipcMain.handle(IPC.liveSetVirtualCam, (_e, on: unknown) => {
    if (typeof on !== 'boolean') throw new Error('Réglage invalide.')
    return live.setVirtualCam(on)
  })

  // ---- First-launch page: macOS permissions, Linux system checks ----
  const mediaAccess: MediaAccessApi | null = platform === 'darwin' ? systemPreferences : null
  const permissions = (): ReturnType<typeof permissionsStatus> =>
    permissionsStatus(platform, settings.get().permissionsOnboarded === true, mediaAccess)
  let bootObs: (() => void) | null = null
  ipcMain.handle(IPC.permissionsStatus, async () => {
    if (platform !== 'linux') return permissions()
    const system = await linuxSystemChecks({ flatpak, canRememberLogin: canRemember() })
    return linuxPermissionsStatus(settings.get().permissionsOnboarded === true, system)
  })
  ipcMain.handle(IPC.permissionsRequest, (_e, kind: unknown) => {
    if (!isMediaPermission(kind)) throw new Error('Autorisation inconnue.')
    return mediaAccess ? requestMediaAccess(mediaAccess, kind) : 'granted'
  })
  ipcMain.handle(IPC.permissionsOpenSettings, async (_e, kind: unknown) => {
    const url = platform === 'darwin' ? privacySettingsUrl(kind) : null
    if (!url) throw new Error('Réglage système indisponible.')
    await shell.openExternal(url)
  })
  ipcMain.handle(IPC.permissionsTestNotification, () => {
    notify(TEST_NOTIFICATION, { always: true })
  })
  ipcMain.handle(IPC.permissionsFinish, () => {
    if (settings.get().permissionsOnboarded !== true) settings.update({ permissionsOnboarded: true })
    const boot = bootObs
    bootObs = null
    boot?.()
  })

  let uninstalling = false
  const shutdownCapped = (): Promise<void> => {
    subtitles.close() // saves its bounds (app.exit closes windows without their 'close' event)
    return shutdownWithCap(() => live.shutdown(), () => obs.killNow(), SHUTDOWN_CAP_MS)
  }
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
    // Closing the window during a show keeps it running: hidden, or minimised where no tray brings it back.
    hide: () => {
      if (!win || win.isDestroyed()) return
      if (closeDuringShow(platform, tray !== null && !tray.isDestroyed() && linuxTrayShown)) win.hide()
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
              .filter((f) => (f.includes('linto-live') || f.includes('ai.linto.live')) && f.endsWith('.desktop'))
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
      detail: uninstallConfirmDetail(plan, platform, flatpak),
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
  // The subtitle band closes with the app: an open one would keep it alive with no window to come back to.
  win.on('closed', () => subtitles.close())
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
    // Linux: a left click on the icon brings the window back (macOS opens the menu).
    if (platform === 'linux') tray.on('click', showWindow)
    shellKey = '' // fill the new icon's tooltip and menu
    rebuildShell()
  } catch (e) {
    // Some Linux desktops have no tray: the window stays the entry point.
    console.error('Tray icon unavailable', e)
    tray = null
  }
  // Linux: the icon follows the theme where the panel does (macOS tints its template image itself).
  if (platform === 'linux') {
    nativeTheme.on('updated', () => {
      if (tray && !tray.isDestroyed()) tray.setImage(trayImage(live.getState().phase))
    })
  }
  // Linux: whether the desktop shows the icon (closing the window then hides it, as on macOS).
  if (platform === 'linux' && tray) {
    void statusNotifierWatcher().then((shown) => {
      linuxTrayShown = shown === true
    })
  }
  // OBS + overlay start before login so device lists are ready for the setup screen — after the
  // first-launch permissions page when macOS never asked for the camera or the micro (see permissions.ts).
  const boot = (): void => {
    live.boot().catch((err) => console.error('OBS boot failed', err)) // state carries MSG_BOOT_FAILED
  }
  if (deferObsBoot(permissions())) bootObs = boot
  else boot()
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
