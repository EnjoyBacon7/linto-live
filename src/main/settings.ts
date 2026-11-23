import { readFileSync, writeSync, renameSync, mkdirSync, openSync, fsyncSync, closeSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AppPaths } from './paths'
import type { SavedLogin, Settings } from '../shared/types'

export interface TokenCrypto { encrypt(s: string): Buffer; decrypt(b: Buffer): string }
export const DEFAULT_INSTANCE = 'https://studio.linto.ai'

interface Stored extends Settings { tokenEnc?: string; savedLoginEnc?: string; broadcastKeyEnc?: string }

const DEV_HOSTS = new Set(['localhost', '127.0.0.1'])

/** LinTO instance must be https (http only for localhost dev servers). Returns it without trailing slashes. */
export function checkInstance(raw: string): string {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    throw new Error(`Adresse d'instance invalide : ${raw}`)
  }
  const ok = u.protocol === 'https:' || (u.protocol === 'http:' && DEV_HOSTS.has(u.hostname))
  if (!ok) throw new Error(`L'adresse de l'instance doit commencer par https:// (${raw})`)
  return raw.trim().replace(/\/+$/, '')
}

export class SettingsStore {
  private data: Stored
  /** Token held in memory only (persistToken false). */
  private memToken: string | null = null

  /**
   * persistToken false (Linux without a real keyring, where safeStorage only obfuscates with a fixed
   * key): the token is never written to disk; the user logs in again at each launch.
   */
  constructor(
    private p: AppPaths,
    private crypto: TokenCrypto,
    private o: { persistToken?: boolean } = {}
  ) {
    this.data = this.load()
    if (this.o.persistToken === false && this.data.tokenEnc) {
      delete this.data.tokenEnc
      this.save()
    }
  }

  /** Keeps an unreadable settings file next to the original, so the next save() does not destroy it. */
  private setAsideCorrupt(reason: unknown): void {
    const aside = `${this.p.settingsFile}.corrupt-${Date.now()}`
    try {
      renameSync(this.p.settingsFile, aside)
      console.warn(`settings.json is unreadable (${String(reason)}); kept as ${aside}, using defaults`)
    } catch (e) {
      console.warn('settings.json is unreadable and could not be set aside', e)
    }
  }

  private load(): Stored {
    if (!existsSync(this.p.settingsFile)) return { instance: DEFAULT_INSTANCE }
    try {
      const j = JSON.parse(readFileSync(this.p.settingsFile, 'utf8')) as Stored & { output?: unknown; videoDeviceId?: string }
      if (j && typeof j === 'object') {
        delete j.output // v1 output display: the output window is now placed freely
        if ('videoDeviceId' in j) {
          // v0.3 camera id: becomes the main video source.
          if (!j.primarySource) j.primarySource = j.videoDeviceId ? { kind: 'device', id: j.videoDeviceId } : { kind: 'none' }
          delete j.videoDeviceId
        }
        return { ...j, instance: j.instance || DEFAULT_INSTANCE }
      }
      this.setAsideCorrupt('not an object')
    } catch (e) {
      this.setAsideCorrupt(e)
    }
    return { instance: DEFAULT_INSTANCE }
  }

  private save(): void {
    mkdirSync(dirname(this.p.settingsFile), { recursive: true })
    const tmp = `${this.p.settingsFile}.tmp`
    // fsync before the rename: after a power cut the renamed file must not be empty or truncated.
    const fd = openSync(tmp, 'w', 0o600)
    try {
      writeSync(fd, JSON.stringify(this.data, null, 2))
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(tmp, this.p.settingsFile)
  }

  get(): Settings {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { tokenEnc, savedLoginEnc, broadcastKeyEnc, broadcastKeySet, ...rest } = this.data
    return broadcastKeyEnc ? { ...rest, broadcastKeySet: true } : { ...rest }
  }

  /**
   * Throws on an invalid instance URL; changing the instance drops the token and the saved login in the same
   * write, changing the broadcast server drops its stream key (see setBroadcast).
   */
  update(patch: Partial<Settings>): void {
    const clean = { ...patch }
    delete clean.broadcastKeySet // derived from the stored key
    if (clean.instance === undefined) delete clean.instance
    else clean.instance = checkInstance(clean.instance)
    const next: Stored = { ...this.data, ...clean }
    if (clean.instance !== undefined && clean.instance !== this.data.instance) {
      delete next.tokenEnc
      delete next.savedLoginEnc
    }
    if (clean.broadcastServer !== undefined && clean.broadcastServer !== this.data.broadcastServer) delete next.broadcastKeyEnc
    this.data = next
    this.save()
  }

  getToken(): string | null {
    if (this.o.persistToken === false) return this.memToken
    if (!this.data.tokenEnc) return null
    try {
      return this.crypto.decrypt(Buffer.from(this.data.tokenEnc, 'base64'))
    } catch {
      return null
    }
  }

  setToken(t: string | null): void {
    if (this.o.persistToken === false) {
      this.memToken = t
      return
    }
    if (t === null) delete this.data.tokenEnc
    else this.data.tokenEnc = this.crypto.encrypt(t).toString('base64')
    this.save()
  }

  getSavedLogin(): SavedLogin | null {
    if (!this.data.savedLoginEnc) return null
    try {
      const v = JSON.parse(this.crypto.decrypt(Buffer.from(this.data.savedLoginEnc, 'base64'))) as Partial<SavedLogin>
      return typeof v?.email === 'string' && typeof v.password === 'string' ? { email: v.email, password: v.password } : null
    } catch {
      return null
    }
  }

  setSavedLogin(l: SavedLogin | null): void {
    if (l === null) delete this.data.savedLoginEnc
    else this.data.savedLoginEnc = this.crypto.encrypt(JSON.stringify({ email: l.email, password: l.password })).toString('base64')
    this.save()
  }

  /**
   * Stream key of the online broadcast, encrypted like the saved login (with no OS keychain, safeStorage only
   * obfuscates it: OBS itself keeps stream keys in clear text).
   */
  getBroadcastKey(): string | null {
    if (!this.data.broadcastKeyEnc) return null
    try {
      return this.crypto.decrypt(Buffer.from(this.data.broadcastKeyEnc, 'base64'))
    } catch {
      return null
    }
  }

  /**
   * Sets the broadcast server and its stream key in one write. A key belongs to its server: a new server
   * without a new key forgets the old one (it must never be sent to another server, as the LinTO token is
   * dropped with its instance). `key` absent: kept if the server is unchanged; blank: forgotten. No server
   * (''): no key, and the broadcast is turned off.
   */
  setBroadcast(server: string, key?: string): void {
    const s = server.trim()
    const k = key?.trim()
    const next: Stored = { ...this.data }
    if (s) next.broadcastServer = s
    else {
      delete next.broadcastServer
      next.broadcastEnabled = false
    }
    if (!s || k === '' || (k === undefined && s !== this.data.broadcastServer)) delete next.broadcastKeyEnc
    else if (k) next.broadcastKeyEnc = this.crypto.encrypt(k).toString('base64')
    this.data = next
    this.save()
  }
}
