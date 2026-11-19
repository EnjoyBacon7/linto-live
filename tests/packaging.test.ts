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
  it('every tray icon is committed (macOS templates, Linux light and dark)', () => {
    const names = ['trayTemplate', 'trayLiveTemplate', 'trayLinux', 'trayLinuxLive', 'trayLinuxDark', 'trayLinuxDarkLive']
    for (const f of names.flatMap((n) => [`${n}.png`, `${n}@2x.png`])) {
      expect(existsSync(join(__dirname, '..', 'resources', 'tray', f))).toBe(true)
    }
  })
  it('Linux: launcher icon in the hicolor sizes (a lone 1024 px icon is never found by GNOME, nor exported by Flatpak)', () => {
    const linux = yml.slice(yml.indexOf('\nlinux:'), yml.indexOf('\nappImage:'))
    expect(linux).toContain('\n  icon: build/icons\n')
    for (const s of [16, 24, 32, 48, 64, 128, 256, 512]) {
      expect(existsSync(join(__dirname, '..', 'build', 'icons', `${s}x${s}.png`))).toBe(true)
    }
  })
  it('Flatpak: may ask the host through flatpak-spawn (v4l2loopback for the virtual camera)', () => {
    const block = yml.slice(yml.indexOf('\nflatpak:'), yml.indexOf('\ndeb:'))
    expect(block).toContain('- --talk-name=org.freedesktop.Flatpak\n')
  })
  it('flips the Electron fuses that harden the packaged app', () => {
    const block = yml.slice(yml.indexOf('\nelectronFuses:'))
    expect(yml).toContain('\nelectronFuses:\n')
    for (const l of [
      'runAsNode: false', 'enableNodeOptionsEnvironmentVariable: false', 'enableNodeCliInspectArguments: false',
      'enableCookieEncryption: true', 'enableEmbeddedAsarIntegrityValidation: true', 'onlyLoadAppFromAsar: true',
      'grantFileProtocolExtraPrivileges: false'
    ]) expect(block).toMatch(new RegExp(`\\n  ${l}\\n`))
  })
})
