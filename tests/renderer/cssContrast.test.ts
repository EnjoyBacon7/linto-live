import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, '../../src/renderer/main/mainWindow.css'), 'utf8')

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
  if (matches.length === 0) throw new Error(`rule not found: ${selector}`)
  return matches.map((m) => m[1]).join('\n')
}

describe('informational text contrast (A-009)', () => {
  it.each(['.inspector-note', '.sidebar-org'])('%s uses --text-2, not --text-3', (sel) => {
    const body = rule(sel)
    expect(body).not.toContain('var(--text-3)')
    expect(body).toContain('var(--text-2)')
  })
})

// ---- A-010 / A-017: accent fill and focus indicator, measured from the theme tokens ----

const theme = readFileSync(join(__dirname, '../../src/renderer/theme.css'), 'utf8')
const darkStart = theme.indexOf('@media (prefers-color-scheme: dark)')
const darkEnd = theme.indexOf('\n}\n', darkStart) // end of the @media block (later rules are platform overrides)

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}
const light = tokens(theme.slice(0, darkStart))
const dark = { ...light, ...tokens(theme.slice(darkStart, darkEnd)) }

function resolve(t: Record<string, string>, v: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(v)
  return m ? resolve(t, t[m[1]]) : v
}
function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

describe.each([['light', light], ['dark', dark]] as const)('%s theme', (_, t) => {
  const c = (name: string) => resolve(t, `var(${name})`)

  it('text on the accent fill meets AA 4.5:1 (A-010)', () => {
    expect(ratio(c('--accent-text'), c('--accent-strong'))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(c('--accent-text'), c('--accent-strong-hover'))).toBeGreaterThanOrEqual(4.5)
  })

  it.each(['--bg-window', '--bg-content', '--bg-sidebar', '--bg-toolbar', '--bg-inspector', '--sheet-bg'])(
    'focus colour is >= 3:1 against %s (A-017)', (bg) => {
      expect(ratio(c('--focus-color'), c(bg))).toBeGreaterThanOrEqual(3)
    })
})

describe('accent fill is used where text sits on it (A-010)', () => {
  it('primary button and highlighted menu item use --accent-strong', () => {
    expect(theme).toMatch(/\.btn-primary\s*\{[^}]*background:\s*var\(--accent-strong\)/)
    expect(rule('.menu-item:hover:not(:disabled),\n.menu-item:focus-visible')).toContain('var(--accent-strong)')
  })
  it('focus ring is opaque (no translucent halo)', () => {
    expect(light['--focus-ring']).toContain('var(--focus-color)')
    expect(light['--focus-ring']).not.toContain('transparent')
  })
})
