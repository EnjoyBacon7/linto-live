export interface Layout {
  words: string[]
  /** Word index where lines 2..n start, ascending. */
  cuts: number[]
}

export function layoutText(prev: Layout, text: string, fits: (line: string) => boolean): Layout

export class SubtitleModel {
  constructor(fits: (line: string) => boolean)
  partial(text: string): void
  final(text: string): void
  /** New measuring function (font size changed): lays the shown text out again. */
  setFits(fits: (line: string) => boolean): void
  reset(): void
  /** [upper, lower]; '' when absent. */
  lines(): [string, string]
  get visible(): boolean
}
