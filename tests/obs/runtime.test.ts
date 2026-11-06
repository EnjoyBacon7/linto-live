import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureObsRuntime } from '../../src/main/obs/runtime'

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
