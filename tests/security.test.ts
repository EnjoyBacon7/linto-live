import { describe, expect, it } from 'vitest'
import { RENDERER_URL, rendererEntry, rendererFilePath } from '../src/main/security'

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
