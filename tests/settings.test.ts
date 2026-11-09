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
  it('without a real keychain the token stays in memory only, and an old stored one is dropped', () => {
    const p = appPaths(dir, 'linux')
    new SettingsStore(p, crypto).setToken('OLD-TOKEN')
    const s = new SettingsStore(p, crypto, { persistToken: false })
    expect(s.getToken()).toBeNull()
    expect(readFileSync(p.settingsFile, 'utf8')).not.toContain('tokenEnc')
    s.setToken('SECRET-TOKEN')
    expect(s.getToken()).toBe('SECRET-TOKEN')
    expect(readFileSync(p.settingsFile, 'utf8')).not.toContain('tokenEnc')
    s.setToken(null)
    expect(s.getToken()).toBeNull()
  })
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
  it('loads a v1 file with a legacy output display and drops the key', () => {
    const p = appPaths(dir, 'linux')
    writeFileSync(p.settingsFile, '{"instance":"https://x.linto.ai","orgId":"o","output":{"name":"HDMI","x":0,"y":0,"width":1920,"height":1080}}')
    const s = new SettingsStore(p, crypto)
    expect(s.get()).toEqual({ instance: 'https://x.linto.ai', orgId: 'o' })
    expect(s.get()).not.toHaveProperty('output')
    s.update({ profileId: 2 })
    expect(readFileSync(p.settingsFile, 'utf8')).not.toContain('HDMI')
  })
  it('corrupt file or undecryptable token => defaults / null', () => {
    const p = appPaths(dir, 'linux')
    writeFileSync(p.settingsFile, '{bad')
    const s = new SettingsStore(p, crypto)
    expect(s.get().instance).toBe('https://studio.linto.ai')
    expect(s.getToken()).toBeNull()
  })
})

describe('SettingsStore instance', () => {
  it('changing the instance clears the token in the same write', () => {
    const p = appPaths(dir, 'linux')
    const s = new SettingsStore(p, crypto)
    s.setToken('T')
    s.update({ orgId: 'o' })
    expect(s.getToken()).toBe('T')
    s.update({ instance: 'https://studio.linto.ai' })
    expect(s.getToken()).toBe('T')
    s.update({ instance: 'https://autre.example.org/' })
    expect(s.get().instance).toBe('https://autre.example.org')
    expect(s.getToken()).toBeNull()
    expect(readFileSync(p.settingsFile, 'utf8')).not.toContain('tokenEnc')
  })
  it('rejects non-https instances except localhost', () => {
    const s = new SettingsStore(appPaths(dir, 'linux'), crypto)
    s.setToken('T')
    expect(() => s.update({ instance: 'http://evil.example.org' })).toThrow(/https/)
    expect(() => s.update({ instance: 'pas une url' })).toThrow()
    expect(() => s.update({ instance: 'file:///etc' })).toThrow()
    expect(s.get().instance).toBe('https://studio.linto.ai')
    expect(s.getToken()).toBe('T')
    s.update({ instance: 'http://localhost:8080' })
    expect(s.get().instance).toBe('http://localhost:8080')
    s.update({ instance: 'http://127.0.0.1:8080' })
    expect(s.get().instance).toBe('http://127.0.0.1:8080')
  })
  it('persists windowBounds', () => {
    const p = appPaths(dir, 'linux')
    const s = new SettingsStore(p, crypto)
    s.update({ windowBounds: { x: 10, y: 20, width: 1100, height: 720 } })
    expect(new SettingsStore(p, crypto).get().windowBounds).toEqual({ x: 10, y: 20, width: 1100, height: 720 })
    expect(statSync(p.settingsFile).mode & 0o777).toBe(0o600)
  })
})

describe('SettingsStore saved login', () => {
  it('round-trips email + password encrypted, never in get() nor in plain text on disk', () => {
    const p = appPaths(dir, 'linux')
    const s = new SettingsStore(p, crypto)
    expect(s.getSavedLogin()).toBeNull()
    s.setSavedLogin({ email: 'moi@linagora.com', password: 'S3cret-pw' })
    const raw = readFileSync(p.settingsFile, 'utf8')
    expect(raw).not.toContain('S3cret-pw')
    expect(raw).not.toContain('moi@linagora.com')
    expect(raw).toContain('savedLoginEnc')
    expect(s.get()).not.toHaveProperty('savedLoginEnc')
    expect(new SettingsStore(p, crypto).getSavedLogin()).toEqual({ email: 'moi@linagora.com', password: 'S3cret-pw' })
    s.setSavedLogin(null)
    expect(new SettingsStore(p, crypto).getSavedLogin()).toBeNull()
    expect(readFileSync(p.settingsFile, 'utf8')).not.toContain('savedLoginEnc')
  })
  it('undecryptable or malformed saved login => null', () => {
    const p = appPaths(dir, 'linux')
    writeFileSync(p.settingsFile, JSON.stringify({ instance: 'https://studio.linto.ai', savedLoginEnc: Buffer.from('}{').toString('base64') }))
    expect(new SettingsStore(p, crypto).getSavedLogin()).toBeNull()
    const broken = { encrypt: crypto.encrypt, decrypt: () => { throw new Error('keychain locked') } }
    const s = new SettingsStore(p, broken)
    s.setSavedLogin({ email: 'a', password: 'b' })
    expect(s.getSavedLogin()).toBeNull()
  })
  it('changing the instance forgets the saved login (it belongs to the old instance)', () => {
    const p = appPaths(dir, 'linux')
    const s = new SettingsStore(p, crypto)
    s.setSavedLogin({ email: 'a@b.c', password: 'pw' })
    s.update({ instance: 'https://studio.linto.ai/' })
    expect(s.getSavedLogin()).toEqual({ email: 'a@b.c', password: 'pw' })
    s.update({ instance: 'https://autre.example.org' })
    expect(s.getSavedLogin()).toBeNull()
  })
})
