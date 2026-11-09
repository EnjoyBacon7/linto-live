import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { RENDERER_URL, denyAllPermissions, isOwnPage, lockNavigation, rendererEntry, rendererFilePath } from '../src/main/security'

describe('rendererEntry', () => {
  it('honours ELECTRON_RENDERER_URL only in development', () => {
    expect(rendererEntry(false, 'http://localhost:5173')).toBe('http://localhost:5173')
    expect(rendererEntry(true, 'http://evil.example')).toBe(RENDERER_URL)
    expect(rendererEntry(false, undefined)).toBe(RENDERER_URL)
    expect(rendererEntry(false, '')).toBe(RENDERER_URL)
  })
  it('the bundled page is served from a custom origin (file:// pages get no extra privileges)', () => {
    expect(RENDERER_URL).toBe('app://linto-live/index.html')
  })
})

describe('rendererFilePath', () => {
  const root = '/opt/app/out/renderer'
  it('maps app://linto-live/<path> inside the renderer directory', () => {
    expect(rendererFilePath('app://linto-live/index.html', root)).toBe('/opt/app/out/renderer/index.html')
    expect(rendererFilePath('app://linto-live/assets/index-1.js?x=1#y', root)).toBe('/opt/app/out/renderer/assets/index-1.js')
    expect(rendererFilePath('app://linto-live/assets/a%20b.css', root)).toBe('/opt/app/out/renderer/assets/a b.css')
  })
  it('refuses anything outside it or another host', () => {
    for (const u of [
      'app://linto-live/../main/main.js', 'app://linto-live/%2e%2e/main/main.js', 'app://linto-live/assets/..%2f..%2fmain.js',
      'app://linto-live/..%2F..%2F..%2Fetc/passwd', 'app://linto-live/%2e%2e%2f%2e%2e%2fmain.js'
    ]) {
      const p = rendererFilePath(u, root)
      if (p !== null) expect(p.startsWith(root + '/')).toBe(true)
    }
    expect(rendererFilePath('app://linto-live/..%2F..%2Fmain/main.js', root)).toBeNull()
    expect(rendererFilePath('app://other/index.html', root)).toBeNull()
    expect(rendererFilePath('file:///etc/passwd', root)).toBeNull()
    expect(rendererFilePath('app://linto-live/', root)).toBeNull()
    expect(rendererFilePath('not a url', root)).toBeNull()
  })
})

describe('denyAllPermissions', () => {
  it('refuses every permission request and check', () => {
    let req: ((wc: unknown, p: string, cb: (ok: boolean) => void) => void) | null = null
    let check: ((wc: unknown, p: string) => boolean) | null = null
    denyAllPermissions({
      setPermissionRequestHandler: (h) => (req = h as typeof req),
      setPermissionCheckHandler: (h) => (check = h as typeof check)
    })
    for (const p of ['media', 'notifications', 'geolocation', 'clipboard-read', 'openExternal']) {
      const cb = vi.fn()
      req!(null, p, cb)
      expect(cb).toHaveBeenCalledWith(false)
      expect(check!(null, p)).toBe(false)
    }
  })
})

describe('isOwnPage', () => {
  it('only the page the window was given (same scheme, host and port)', () => {
    expect(isOwnPage('app://linto-live/index.html#x', RENDERER_URL)).toBe(true)
    expect(isOwnPage('app://other/index.html', RENDERER_URL)).toBe(false)
    expect(isOwnPage('https://evil.example/', RENDERER_URL)).toBe(false)
    expect(isOwnPage('file:///etc/passwd', RENDERER_URL)).toBe(false)
    expect(isOwnPage('http://localhost:5173/?a', 'http://localhost:5173')).toBe(true)
    expect(isOwnPage('http://localhost:5174/', 'http://localhost:5173')).toBe(false)
    expect(isOwnPage('garbage', RENDERER_URL)).toBe(false)
  })
})

describe('lockNavigation', () => {
  it('blocks navigation away from the app page and every new window', () => {
    const wc = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn() })
    lockNavigation(wc, RENDERER_URL)
    const away = { preventDefault: vi.fn() }
    wc.emit('will-navigate', away, 'https://evil.example/')
    expect(away.preventDefault).toHaveBeenCalled()
    const reload = { preventDefault: vi.fn() }
    wc.emit('will-navigate', reload, 'app://linto-live/index.html')
    expect(reload.preventDefault).not.toHaveBeenCalled()
    const handler = wc.setWindowOpenHandler.mock.calls[0][0] as (d: { url: string }) => { action: string }
    expect(handler({ url: 'https://evil.example/' })).toEqual({ action: 'deny' })
    expect(handler({ url: RENDERER_URL })).toEqual({ action: 'deny' })
  })
})
