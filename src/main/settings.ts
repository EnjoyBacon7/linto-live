import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AppPaths } from './paths'
import type { SavedLogin, Settings } from '../shared/types'

export interface TokenCrypto { encrypt(s: string): Buffer; decrypt(b: Buffer): string }
export const DEFAULT_INSTANCE = 'https://studio.linto.ai'

interface Stored extends Settings { tokenEnc?: string; savedLoginEnc?: string }

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

  private load(): Stored {
    try {
      const j = JSON.parse(readFileSync(this.p.settingsFile, 'utf8')) as Stored & { output?: unknown }
      if (j && typeof j === 'object') {
        delete j.output // v1 output display: the output window is now placed freely
        return { ...j, instance: j.instance || DEFAULT_INSTANCE }
      }
    } catch { /* missing or corrupt: defaults */ }
    return { instance: DEFAULT_INSTANCE }
  }

  private save(): void {
    mkdirSync(dirname(this.p.settingsFile), { recursive: true })
    const tmp = `${this.p.settingsFile}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 })
    renameSync(tmp, this.p.settingsFile)
  }

  get(): Settings {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { tokenEnc, savedLoginEnc, ...rest } = this.data
    return { ...rest }
  }

  /** Throws on an invalid instance URL; changing the instance drops the token and the saved login in the same write. */
  update(patch: Partial<Settings>): void {
    const clean = { ...patch }
    if (clean.instance === undefined) delete clean.instance
    else clean.instance = checkInstance(clean.instance)
    const next: Stored = { ...this.data, ...clean }
    if (clean.instance !== undefined && clean.instance !== this.data.instance) {
      delete next.tokenEnc
      delete next.savedLoginEnc
    }
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
}
