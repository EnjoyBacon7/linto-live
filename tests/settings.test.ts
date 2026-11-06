import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, statSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsStore } from '../src/main/settings'
import { appPaths } from '../src/main/paths'

const crypto = {
  encrypt: (s: string) => Buffer.from(s.split('').reverse().join('')),
  decrypt: (b: Buffer) => b.toString().split('').reverse().join('')
}
let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ls-')) })

describe('SettingsStore', () => {
  it('defaults when missing', () => {
    expect(new SettingsStore(appPaths(dir, 'linux'), crypto).get()).toEqual({ instance: 'https://studio.linto.ai' })
  })
  it('round-trips token without plaintext on disk', () => {
    const p = appPaths(dir, 'linux')
    const s = new SettingsStore(p, crypto)
    s.setToken('SECRET-TOKEN')
    const raw = readFileSync(p.settingsFile, 'utf8')
    expect(raw).not.toContain('SECRET-TOKEN')
    expect(raw).toContain('tokenEnc')
    expect(new SettingsStore(p, crypto).getToken()).toBe('SECRET-TOKEN')
    expect(statSync(p.settingsFile).mode & 0o777).toBe(0o600)
    expect(readdirSync(dir)).toEqual(['settings.json'])
    s.setToken(null)
    expect(new SettingsStore(p, crypto).getToken()).toBeNull()
  })
  it('update merges and persists; token not in get()', () => {
    const p = appPaths(dir, 'linux')
    const s = new SettingsStore(p, crypto)
    s.setToken('t')
    s.update({ orgId: 'o', profileId: 3 })
    const s2 = new SettingsStore(p, crypto)
    expect(s2.get()).toEqual({ instance: 'https://studio.linto.ai', orgId: 'o', profileId: 3 })
    expect(s2.getToken()).toBe('t')
  })
  it('corrupt file or undecryptable token => defaults / null', () => {
    const p = appPaths(dir, 'linux')
    writeFileSync(p.settingsFile, '{bad')
    const s = new SettingsStore(p, crypto)
    expect(s.get().instance).toBe('https://studio.linto.ai')
    expect(s.getToken()).toBeNull()
  })
})
