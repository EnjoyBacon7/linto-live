import type { MonitorInfo, SavedDisplay } from '../../shared/types'

const baseName = (n: string): string => n.replace(/\(\d+\)\s*$/, '').trim()

/** Find the saved output display in the current monitor list: exact geometry first, then same name + size. */
export function matchDisplay(saved: SavedDisplay, list: MonitorInfo[]): MonitorInfo | null {
  const exact = list.find((m) => m.x === saved.x && m.y === saved.y && m.width === saved.width && m.height === saved.height)
  if (exact) return exact
  const name = baseName(saved.name)
  return list.find((m) => baseName(m.name) === name && m.width === saved.width && m.height === saved.height) ?? null
}
