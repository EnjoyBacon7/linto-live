import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  partitions: [] as string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ses: null as null | Record<string, any>,
  windows: [] as unknown[]
}))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class FakeWindow extends EventEmitter {
    webContents = new EventEmitter()
    destroyed = false
    constructor(public opts: unknown) {
      super()
      h.windows.push(this)
    }
    loadURL = vi.fn(async () => {})
    isDestroyed = (): boolean => this.destroyed
    destroy = (): void => {
      this.destroyed = true
    }
  }
  return {
    BrowserWindow: FakeWindow,
    session: {
      fromPartition: (p: string) => {
        h.partitions.push(p)
        return h.ses
      }
    }
  }
})

import { clearSsoSession, ssoLogin } from '../../src/main/linto/auth'

const urls = { instance: 'https://studio.linto.ai', api: '', auth: 'https://studio.linto.ai/cm-api/auth', wsUrl: '', wsPath: '' }
const method = { path: 'oidc', from: '', name: 'SSO' }
type Win = EventEmitter & { webContents: EventEmitter; opts: { webPreferences: { partition: string } } }
const lastWin = (): Win => h.windows[h.windows.length - 1] as Win
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  h.partitions.length = 0
  h.windows.length = 0
  h.ses = {
    fetch: vi.fn(),
    clearStorageData: vi.fn(async () => {}),
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn()
  }
})

describe('SSO browser storage', () => {
  it('uses an in-memory partition (nothing written to disk)', async () => {
    const p = ssoLogin(urls, method, {} as never)
    await flush()
    expect(h.partitions.every((x) => !x.startsWith('persist:'))).toBe(true)
    expect(lastWin().opts.webPreferences.partition).toBe(h.partitions[0])
    lastWin().emit('closed')
    await expect(p).rejects.toThrow('cancelled')
  })

  it('clears the SSO cookies and storage once the token is obtained', async () => {
    const p = ssoLogin(urls, method, {} as never)
    await flush()
    lastWin().webContents.emit('will-redirect', { preventDefault: vi.fn() }, 'https://studio.linto.ai/login/oidc?token=T')
    await expect(p).resolves.toBe('T')
    expect(h.ses!.clearStorageData).toHaveBeenCalled()
  })

  it('clears them too when the login is cancelled', async () => {
    const p = ssoLogin(urls, method, {} as never)
    await flush()
    lastWin().emit('closed')
    await expect(p).rejects.toThrow()
    expect(h.ses!.clearStorageData).toHaveBeenCalled()
  })

  it('clearSsoSession (logout) clears the SSO partition', async () => {
    await clearSsoSession()
    expect(h.partitions).toHaveLength(1)
    expect(h.ses!.clearStorageData).toHaveBeenCalled()
  })
})
