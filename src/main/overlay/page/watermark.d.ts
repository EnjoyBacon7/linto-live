export type WatermarkPart = { type: 'text'; value: string } | { type: 'token'; src: string; alt: string }

export function parseWatermark(content: string, tokens: Record<string, { src: string; alt: string }>): WatermarkPart[]

export interface WatermarkTiming { display: boolean; pinned: boolean; frequency: number; duration: number }
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(t: unknown): void
}

export class WatermarkCycle {
  constructor(onChange: (visible: boolean) => void, timers?: Timers)
  update(w: WatermarkTiming): void
  readonly visible: boolean
}
