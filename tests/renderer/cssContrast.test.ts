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
