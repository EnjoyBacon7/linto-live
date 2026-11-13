export interface Luma {
  mean: number
  max: number
}

/** Limited-range black (~0.063) passes. Tune only against a real ATEM capture. */
export function isBlack(l: Luma): boolean {
  return l.mean < 0.1 && l.max < 0.2
}

interface Timers {
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}

export interface FallbackMonitorOptions {
  probe(): Promise<string>
  decode(dataUrl: string): Luma | null
  setBackup(on: boolean): Promise<void>
  blackIsAbsent: () => boolean
  primaryIsFile: () => boolean
  onChange?(onBackup: boolean): void
  intervalMs?: number
  switchMs?: number
  timers?: Timers
  now?: () => number
}

/**
 * Decides when to switch the hidden output between the primary and backup
 * sources. A failed setBackup keeps the pending transition (so the next tick
 * retries) and does not call onChange.
 */
export class FallbackMonitor {
  onBackup = false
  private handle: unknown = null
  private busy = false
  private run = 0
  private pendingSince: number | null = null
  private readonly intervalMs: number
  private readonly switchMs: number
  private readonly timers: Timers
  private readonly now: () => number

  constructor(private readonly o: FallbackMonitorOptions) {
    this.intervalMs = o.intervalMs ?? 500
    this.switchMs = o.switchMs ?? 2000
    this.timers = o.timers ?? {
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>)
    }
    this.now = o.now ?? (() => Date.now())
  }

  start(): void {
    if (this.handle !== null) return
    this.onBackup = false
    this.pendingSince = null
    this.busy = false
    const run = ++this.run
    this.o.setBackup(false).catch(() => {})
    this.handle = this.timers.setInterval(() => void this.tick(run), this.intervalMs)
    void this.tick(run)
  }

  stop(): void {
    this.run++
    this.busy = false
    if (this.handle !== null) this.timers.clearInterval(this.handle)
    this.handle = null
  }

  private async isAbsent(): Promise<boolean> {
    try {
      const luma = this.o.decode(await this.o.probe())
      if (!luma) return true
      return !this.o.primaryIsFile() && this.o.blackIsAbsent() && isBlack(luma)
    } catch {
      return true
    }
  }

  private async tick(run: number): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      const absent = await this.isAbsent()
      if (run !== this.run) return
      if (absent === this.onBackup) {
        this.pendingSince = null
        return
      }
      const t = this.now()
      this.pendingSince ??= t
      if (t - this.pendingSince < this.switchMs) return
      try {
        await this.o.setBackup(absent)
      } catch {
        return
      }
      if (run !== this.run) return
      this.onBackup = absent
      this.pendingSince = null
      this.o.onChange?.(absent)
    } finally {
      if (run === this.run) this.busy = false
    }
  }
}
