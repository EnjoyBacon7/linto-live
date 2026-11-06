import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AppPaths } from './paths'
import type { Settings } from '../shared/types'

export interface TokenCrypto { encrypt(s: string): Buffer; decrypt(b: Buffer): string }
export const DEFAULT_INSTANCE = 'https://studio.linto.ai'

interface Stored extends Settings { tokenEnc?: string }

export class SettingsStore {
  private data: Stored

  constructor(private p: AppPaths, private crypto: TokenCrypto) {
    this.data = this.load()
  }

  private load(): Stored {
    try {
      const j = JSON.parse(readFileSync(this.p.settingsFile, 'utf8')) as Stored
      if (j && typeof j === 'object') return { ...j, instance: j.instance || DEFAULT_INSTANCE }
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
    const { tokenEnc, ...rest } = this.data
    return { ...rest }
  }

  update(patch: Partial<Settings>): void {
    this.data = { ...this.data, ...patch }
    this.save()
  }

  getToken(): string | null {
    if (!this.data.tokenEnc) return null
    try {
      return this.crypto.decrypt(Buffer.from(this.data.tokenEnc, 'base64'))
    } catch {
      return null
    }
  }

  setToken(t: string | null): void {
    if (t === null) delete this.data.tokenEnc
    else this.data.tokenEnc = this.crypto.encrypt(t).toString('base64')
    this.save()
  }
}
