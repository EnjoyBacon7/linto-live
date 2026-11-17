import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureObsRuntime, inApplicationsFolder, placeObsRuntime } from '../../src/main/obs/runtime'

let root: string
let bundled: string
let runtimeDir: string

function makeBundle(dir: string, sig: string): void {
  mkdirSync(join(dir, 'Contents', 'MacOS'), { recursive: true })
  mkdirSync(join(dir, 'Contents', '_CodeSignature'), { recursive: true })
  writeFileSync(join(dir, 'Contents', 'MacOS', 'OBS'), 'bin-' + sig)
  writeFileSync(join(dir, 'Contents', '_CodeSignature', 'CodeResources'), sig)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'obs-runtime-'))
  bundled = join(root, 'LinTO Live.app', 'Contents', 'Resources', 'obs', 'OBS.app')
  runtimeDir = join(root, 'userData', 'obs-runtime')
  makeBundle(bundled, 'v1')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('ensureObsRuntime', () => {
  it('copies the embedded OBS.app outside any .app bundle and returns its executable', () => {
    const exe = ensureObsRuntime({ bundledApp: bundled, runtimeDir })
    expect(exe).toBe(join(runtimeDir, 'OBS.app', 'Contents', 'MacOS', 'OBS'))
    expect(readFileSync(exe, 'utf8')).toBe('bin-v1')
  })

  it('keeps symlinks as symlinks (framework layout)', () => {
    symlinkSync('MacOS', join(bundled, 'Contents', 'Link'))
    ensureObsRuntime({ bundledApp: bundled, runtimeDir })
    expect(lstatSync(join(runtimeDir, 'OBS.app', 'Contents', 'Link')).isSymbolicLink()).toBe(true)
  })

  it('reuses an up-to-date copy', () => {
    const exe = ensureObsRuntime({ bundledApp: bundled, runtimeDir })
    writeFileSync(join(runtimeDir, 'OBS.app', 'marker'), 'x')
    expect(ensureObsRuntime({ bundledApp: bundled, runtimeDir })).toBe(exe)
    expect(existsSync(join(runtimeDir, 'OBS.app', 'marker'))).toBe(true)
  })

  it('replaces the copy when the embedded OBS changes', () => {
    ensureObsRuntime({ bundledApp: bundled, runtimeDir })
    writeFileSync(join(runtimeDir, 'OBS.app', 'marker'), 'x')
    rmSync(bundled, { recursive: true })
    makeBundle(bundled, 'v2')
    const exe = ensureObsRuntime({ bundledApp: bundled, runtimeDir })
    expect(readFileSync(exe, 'utf8')).toBe('bin-v2')
    expect(existsSync(join(runtimeDir, 'OBS.app', 'marker'))).toBe(false)
  })

  it('throws when the embedded OBS.app is missing', () => {
    rmSync(bundled, { recursive: true })
    expect(() => ensureObsRuntime({ bundledApp: bundled, runtimeDir })).toThrow()
  })
})

describe('placeObsRuntime', () => {
  it('uses the first directory and removes copies left in the later ones', () => {
    const apps = join(root, 'Applications', '.LinTO Live')
    ensureObsRuntime({ bundledApp: bundled, runtimeDir }) // copy left by an older version
    const exe = placeObsRuntime({ bundledApp: bundled, runtimeDirs: [apps, runtimeDir] })
    expect(exe).toBe(join(apps, 'OBS.app', 'Contents', 'MacOS', 'OBS'))
    expect(existsSync(join(runtimeDir, 'OBS.app'))).toBe(false)
  })

  it('falls back to the next directory when one cannot be written', () => {
    const blocker = join(root, 'not-a-dir')
    writeFileSync(blocker, '')
    const log = vi.fn()
    const exe = placeObsRuntime({ bundledApp: bundled, runtimeDirs: [join(blocker, 'sub'), runtimeDir] }, log)
    expect(exe).toBe(join(runtimeDir, 'OBS.app', 'Contents', 'MacOS', 'OBS'))
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('throws when no directory works', () => {
    rmSync(bundled, { recursive: true })
    expect(() => placeObsRuntime({ bundledApp: bundled, runtimeDirs: [runtimeDir] })).toThrow()
  })

  it('tells whether an OBS executable sits under /Applications', () => {
    expect(inApplicationsFolder('/Applications/.LinTO Live/OBS.app/Contents/MacOS/OBS')).toBe(true)
    expect(inApplicationsFolder('/Users/u/Library/Application Support/LinTO Live/obs-runtime/OBS.app/Contents/MacOS/OBS')).toBe(false)
    expect(inApplicationsFolder('/ApplicationsX/OBS.app/Contents/MacOS/OBS')).toBe(false)
  })
})
