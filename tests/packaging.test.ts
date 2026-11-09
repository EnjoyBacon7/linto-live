import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))

describe('package.json', () => {
  it('declares the author (electron-builder metadata)', () => {
    expect(pkg.author).toBe('LINAGORA')
  })
  it('dist:mac fails early when the bundled OBS.app has not been fetched', () => {
    const s: string = pkg.scripts['dist:mac']
    expect(s.startsWith("test -d vendor/obs/macos/OBS.app || (echo 'Lance npm run fetch:obs:mac' && exit 1)")).toBe(true)
    expect(s.indexOf('test -d')).toBeLessThan(s.indexOf('npm run build'))
  })
})

describe('electron-builder.yml', () => {
  const yml = readFileSync(join(__dirname, '..', 'electron-builder.yml'), 'utf8')
  it('ships the tray icons on every platform (shared extraResources, before the per-OS sections)', () => {
    const shared = yml.slice(yml.indexOf('\nextraResources:'), yml.indexOf('\nmac:'))
    expect(shared).toContain('- from: resources/tray\n    to: tray')
  })
  it('the four tray icons are committed', () => {
    for (const f of ['trayTemplate.png', 'trayTemplate@2x.png', 'trayLiveTemplate.png', 'trayLiveTemplate@2x.png']) {
      expect(existsSync(join(__dirname, '..', 'resources', 'tray', f))).toBe(true)
    }
  })
})
