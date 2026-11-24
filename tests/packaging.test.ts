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

describe('scripts/build-linux-docker.sh', () => {
  const sh = readFileSync(join(__dirname, '..', 'scripts', 'build-linux-docker.sh'), 'utf8')
  it('verifies a pinned SHA-256 of the Node tarball before extracting it', () => {
    expect(sh).toMatch(/^NODE_SHA256=[0-9a-f]{64}$/m)
    expect(sh).toContain('sha256sum -c')
    expect(sh).not.toMatch(/nodejs\.org[^\n]*\n\s*\| tar/)
    expect(sh.indexOf('sha256sum -c')).toBeLessThan(sh.indexOf('tar -xJf'))
  })
})

describe('versions kept in sync across files', () => {
  const read = (f: string): string => readFileSync(join(__dirname, '..', f), 'utf8')
  const one = (f: string, re: RegExp): string => {
    const m = read(f).match(re)
    if (!m) throw new Error(`${re} not found in ${f}`)
    return m[1]!
  }
  it('OBS: the Linux build, the macOS fetch, CI (cache keys) and the notices name the same version', () => {
    const v = one('scripts/build-obs-linux.sh', /^OBS_VERSION="([^"]+)"/m)
    expect(one('scripts/fetch-obs-macos.sh', /^OBS_VERSION="([^"]+)"/m)).toBe(v)
    expect(one('.github/workflows/linux.yml', /^ {2}OBS_VERSION: '([^']+)'/m)).toBe(v)
    expect(one('resources/obs/SOURCE.md', /ships \*\*OBS Studio ([\d.]+)\*\*/)).toBe(v)
    expect(one('README.md', /embarque \*\*OBS Studio ([\d.]+)\*\*/)).toBe(v)
  })
  it('Flatpak: CI installs the runtime and BaseApp versions electron-builder builds against', () => {
    const v = one('.github/workflows/linux.yml', /^ {2}FLATPAK_RUNTIME: '([^']+)'/m)
    expect(one('electron-builder.yml', /^ {2}runtimeVersion: '([^']+)'/m)).toBe(v)
    expect(one('electron-builder.yml', /^ {2}baseVersion: '([^']+)'/m)).toBe(v)
  })
})
