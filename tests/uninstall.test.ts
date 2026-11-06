import { describe, it, expect } from 'vitest'
import { uninstallTargets, runUninstall, UninstallError } from '../src/main/uninstall'

const H = '/Users/u'
const base = {
  platform: 'darwin' as const,
  home: H,
  userData: `${H}/Library/Application Support/LinTO Live`,
  appId: 'ai.linto.live' as const,
  appName: 'LinTO Live' as const,
  exePath: '/Applications/LinTO Live.app/Contents/MacOS/LinTO Live',
  personalObsInstalled: false,
  desktopFiles: [] as string[]
}

describe('uninstallTargets darwin', () => {
  it('lists exact artefacts incl. OBS plist when no personal OBS', () => {
    const t = uninstallTargets(base)
    expect(t.remove).toEqual([
      `${H}/Library/Application Support/LinTO Live`,
      `${H}/Library/Caches/LinTO Live`,
      `${H}/Library/Caches/ai.linto.live`,
      `${H}/Library/Logs/LinTO Live`,
      `${H}/Library/Preferences/ai.linto.live.plist`,
      `${H}/Library/Saved Application State/ai.linto.live.savedState`,
      `${H}/Library/Preferences/com.obsproject.obs-studio.plist`
    ])
    expect(t.trash).toBe('/Applications/LinTO Live.app')
  })
  it('omits OBS plist when personal OBS installed', () => {
    const t = uninstallTargets({ ...base, personalObsInstalled: true })
    expect(t.remove.some((p) => p.includes('obsproject'))).toBe(false)
    expect(t.remove).toHaveLength(6)
  })
  it('never lists anything outside home', () => {
    for (const p of uninstallTargets(base).remove) expect(p.startsWith(H + '/')).toBe(true)
  })
  it('trash is null in dev (electron in node_modules)', () => {
    const t = uninstallTargets({
      ...base,
      exePath: '/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
    })
    expect(t.trash).toBeNull()
  })
  it('trash is null when the app root is not named LinTO Live.app', () => {
    expect(uninstallTargets({ ...base, exePath: '/Applications/Other.app/Contents/MacOS/x' }).trash).toBeNull()
    expect(uninstallTargets({ ...base, exePath: '/Applications/LinTO Live.app/Contents/MacOS' }).trash).toBeNull()
    expect(uninstallTargets({ ...base, exePath: 'LinTO Live.app/Contents/MacOS/x' }).trash).toBeNull()
  })
  it('works for ~/Applications install', () => {
    const t = uninstallTargets({ ...base, exePath: `${H}/Applications/LinTO Live.app/Contents/MacOS/LinTO Live` })
    expect(t.trash).toBe(`${H}/Applications/LinTO Live.app`)
  })
})

describe('uninstallTargets linux', () => {
  const lin = {
    ...base,
    platform: 'linux' as const,
    userData: `${H}/.config/LinTO Live`,
    exePath: '/tmp/.mount_x/linto-live',
    appImage: `${H}/Apps/LinTO-Live.AppImage`,
    desktopFiles: [`${H}/.local/share/applications/appimagekit-linto-live.desktop`]
  }
  it('lists userData, cache, desktop files; trash = appImage', () => {
    const t = uninstallTargets(lin)
    expect(t.remove).toEqual([
      `${H}/.config/LinTO Live`,
      `${H}/.cache/LinTO Live`,
      `${H}/.local/share/applications/appimagekit-linto-live.desktop`
    ])
    expect(t.trash).toBe(lin.appImage)
  })
  it('trash null without appImage or without .AppImage suffix', () => {
    expect(uninstallTargets({ ...lin, appImage: undefined }).trash).toBeNull()
    expect(uninstallTargets({ ...lin, appImage: `${H}/Apps/foo.sh` }).trash).toBeNull()
  })
})

describe('safety guards', () => {
  const bad = (userData: string, platform: 'darwin' | 'linux' = 'darwin'): void =>
    expect(() => uninstallTargets({ ...base, platform, userData })).toThrow()
  it('throws when userData is home or protected dirs or outside home', () => {
    bad(H)
    bad(H + '/')
    bad(`${H}/Library`)
    bad(`${H}/Library/Application Support`)
    bad(`${H}/.config`, 'linux')
    bad(`${H}/.cache`, 'linux')
    bad(`${H}/.local/share/applications`, 'linux')
    bad('/etc/LinTO Live')
    bad(`${H}/../other/x`)
    bad('relative/path')
    bad('/Users/uevil/x')
  })
  it('throws on bad desktop file paths', () => {
    expect(() =>
      uninstallTargets({ ...base, platform: 'linux', userData: `${H}/.config/LinTO Live`, desktopFiles: ['/etc/passwd'] })
    ).toThrow()
  })
  it('throws on relative or root home', () => {
    expect(() => uninstallTargets({ ...base, home: '/' })).toThrow()
    expect(() => uninstallTargets({ ...base, home: 'Users/u' })).toThrow()
  })
})

describe('runUninstall', () => {
  it('removes all, trashes last', async () => {
    const calls: string[] = []
    await runUninstall(
      { remove: ['/h/a', '/h/b'], trash: '/h/X.app' },
      { rm: async (p) => void calls.push('rm ' + p), trash: async (p) => void calls.push('trash ' + p) }
    )
    expect(calls).toEqual(['rm /h/a', 'rm /h/b', 'trash /h/X.app'])
  })
  it('continues after failure then throws listing failures', async () => {
    const calls: string[] = []
    const err = await runUninstall(
      { remove: ['/h/a', '/h/b'], trash: '/h/X.app' },
      {
        rm: async (p) => {
          calls.push(p)
          if (p === '/h/a') throw new Error('EPERM')
        },
        trash: async (p) => void calls.push('trash ' + p)
      }
    ).catch((e) => e)
    expect(err).toBeInstanceOf(UninstallError)
    expect(err.failed).toEqual(['/h/a'])
    expect(calls).toEqual(['/h/a', '/h/b', 'trash /h/X.app'])
  })
  it('skips trash when null', async () => {
    let n = 0
    await runUninstall({ remove: [], trash: null }, { rm: async () => {}, trash: async () => void n++ })
    expect(n).toBe(0)
  })
})
