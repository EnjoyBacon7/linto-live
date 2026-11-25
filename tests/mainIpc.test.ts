// Drives the real ipcMain handlers registered by src/main/main.ts. electron is mocked (ipcMain.handle only
// records the handlers; everything else is an inert stub), as are the LiveController and the OBS/overlay
// processes: what is under test is the validation and orchestration written in main().
import { mkdtempSync, rmSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  /** An inert object: any property is another stub, calling or constructing it returns one, never thenable. */
  const stub = (): any => {
    const cache = new Map<PropertyKey, unknown>()
    return new Proxy(function () {}, {
      get: (_t, p) => {
        if (p === 'then' || typeof p === 'symbol') return undefined
        if (!cache.has(p)) cache.set(p, stub())
        return cache.get(p)
      },
      apply: () => stub(),
      construct: () => stub() as object
    })
  }
  return {
    stub,
    handlers: new Map<string, (...a: any[]) => unknown>(),
    ready: [] as Array<() => void>,
    userData: '' as string,
    live: { start: undefined as unknown as ReturnType<typeof vi.fn> }
  }
})

vi.mock('electron', () => {
  class FakeWindow extends (require('node:events').EventEmitter as typeof EventEmitter) {
    webContents = h.stub()
    isDestroyed = (): boolean => false
    isVisible = (): boolean => true
    isFocused = (): boolean => true
    isMinimized = (): boolean => false
    getNormalBounds = (): object => ({ x: 0, y: 0, width: 800, height: 600 })
    loadURL = (): Promise<void> => Promise.resolve()
    setTitle = (): void => {}
  }
  return {
    app: Object.assign(new (require('node:events').EventEmitter)(), {
      setName: () => {},
      setAboutPanelOptions: () => {},
      getPath: () => h.userData,
      getAppPath: () => process.cwd(),
      getVersion: () => '0.0.0',
      isPackaged: false,
      requestSingleInstanceLock: () => true,
      whenReady: () => ({ then: (cb: () => void) => { h.ready.push(cb) } }),
      quit: () => {},
      exit: () => {},
      dock: undefined
    }),
    ipcMain: { handle: (channel: string, fn: (...a: any[]) => unknown) => { h.handlers.set(channel, fn) } },
    BrowserWindow: FakeWindow,
    safeStorage: {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'keychain',
      encryptString: (s: string) => Buffer.from(s),
      decryptString: (b: Buffer) => b.toString()
    },
    screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
    nativeTheme: Object.assign(new (require('node:events').EventEmitter)(), { shouldUseDarkColors: false }),
    Notification: { isSupported: () => false },
    desktopCapturer: h.stub(), dialog: h.stub(), Menu: h.stub(), nativeImage: h.stub(), net: h.stub(), protocol: h.stub(),
    session: h.stub(), shell: h.stub(), systemPreferences: h.stub(), Tray: h.stub()
  }
})

vi.mock('../src/main/live', () => {
  class LiveController extends (require('node:events').EventEmitter as typeof EventEmitter) {
    start = vi.fn(async () => {})
    getState = (): object => ({ phase: 'idle' })
    boot = async (): Promise<void> => {}
    overlayPageUrl = (): string => 'http://127.0.0.1/overlay'
    setPreviewSubscribed = (): void => {}
    setWindowVisible = (): void => {}
    shutdown = async (): Promise<void> => {}
    constructor() {
      super()
      h.live.start = this.start
    }
  }
  return { LiveController }
})
vi.mock('../src/main/systemChecks', async (orig) => ({
  ...(await orig<typeof import('../src/main/systemChecks')>()),
  statusNotifierWatcher: async () => false // no D-Bus lookup on a Linux runner
}))
vi.mock('../src/main/obs/process', () => ({ ObsProcess: class { killNow(): void {} } }))
vi.mock('../src/main/overlay/server', () => ({ OverlayServer: class {} }))
vi.mock('../src/main/linto/instance', async (orig) => ({
  ...(await orig<typeof import('../src/main/linto/instance')>()),
  loadInstance: async () => ({ urls: { instance: '', api: '', auth: '', wsUrl: '', wsPath: '' }, watermark: { enabled: false } })
}))

import { SettingsStore } from '../src/main/settings'

const call = (channel: string, ...args: unknown[]): Promise<unknown> => Promise.resolve().then(() => h.handlers.get(channel)!({}, ...args))

beforeAll(async () => {
  h.userData = mkdtempSync(join(tmpdir(), 'linto-main-ipc-'))
  await import('../src/main/main')
  expect(h.ready).toHaveLength(1)
  h.ready[0]() // app.whenReady().then(main)
})
afterAll(() => rmSync(h.userData, { recursive: true, force: true }))

describe('main.ts ipc handlers: setupSetBroadcast', () => {
  it('registers the handler', () => {
    expect(h.handlers.has('setup:set-broadcast')).toBe(true)
  })

  it('saves a valid server and key', async () => {
    const spy = vi.spyOn(SettingsStore.prototype, 'setBroadcast')
    await call('setup:set-broadcast', 'rtmp://a.rtmp.youtube.com/live2', 'k-1')
    expect(spy).toHaveBeenCalledWith('rtmp://a.rtmp.youtube.com/live2', 'k-1')
    spy.mockRestore()
  })

  it('allows an empty server (broadcast cleared) without a key', async () => {
    const spy = vi.spyOn(SettingsStore.prototype, 'setBroadcast')
    await call('setup:set-broadcast', '  ', undefined)
    expect(spy).toHaveBeenCalledWith('  ', undefined)
    spy.mockRestore()
  })

  it.each([
    ['http scheme', 'http://example.com/live'],
    ['no scheme', 'example.com/live'],
    ['empty host', 'rtmp://'],
    ['space inside', 'rtmp://example.com/li ve'],
    ['not a string', 42]
  ])('refuses a bad server (%s) and saves nothing', async (_label, server) => {
    const spy = vi.spyOn(SettingsStore.prototype, 'setBroadcast')
    await expect(call('setup:set-broadcast', server, 'k')).rejects.toThrow('Adresse de serveur de diffusion invalide.')
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('refuses a stream key that is not a string or longer than 1024 characters', async () => {
    const spy = vi.spyOn(SettingsStore.prototype, 'setBroadcast')
    await expect(call('setup:set-broadcast', 'rtmp://h/live', 123)).rejects.toThrow('Clé de stream invalide.')
    await expect(call('setup:set-broadcast', 'rtmp://h/live', 'x'.repeat(1025))).rejects.toThrow('Clé de stream invalide.')
    expect(spy).not.toHaveBeenCalled()
    await call('setup:set-broadcast', 'rtmp://h/live', 'x'.repeat(1024))
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})

describe('main.ts ipc handlers: liveStart', () => {
  const create = { translations: ['en'], visibility: 'public' }

  it('follows an existing session only when asked and no create options are given', async () => {
    await call('live:start', 'Conf', undefined, true)
    expect(h.live.start).toHaveBeenLastCalledWith('Conf', undefined, true)
    await call('live:start', 'Conf', undefined, false)
    expect(h.live.start).toHaveBeenLastCalledWith('Conf', undefined, false)
    await call('live:start', 'Conf', undefined, 'yes')
    expect(h.live.start).toHaveBeenLastCalledWith('Conf', undefined, false)
  })

  it('never follows when creating a new session, even if follow is true', async () => {
    await call('live:start', 'Conf', create, true)
    expect(h.live.start).toHaveBeenLastCalledWith('Conf', { translations: ['en'], visibility: 'public' }, false)
  })

  it('rejects invalid create options before starting', async () => {
    h.live.start.mockClear()
    await expect(call('live:start', 'Conf', { translations: 'en', visibility: 'public' })).rejects.toThrow('Options de session invalides.')
    await expect(call('live:start', 'Conf', { translations: [], visibility: 'password' })).rejects.toThrow('Options de session invalides.')
    expect(h.live.start).not.toHaveBeenCalled()
  })
})
