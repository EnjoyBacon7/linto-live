import { describe, expect, it } from 'vitest'
import { matchDisplay } from '../../src/main/obs/monitors'
import type { MonitorInfo } from '../../src/shared/types'

const m = (index: number, name: string, x: number, y: number, width = 1920, height = 1080): MonitorInfo => ({ index, name, x, y, width, height })

describe('matchDisplay', () => {
  it('matches by geometry when index changed', () => {
    const saved = { name: 'HDMI(1)', x: 1920, y: 0, width: 1920, height: 1080 }
    expect(matchDisplay(saved, [m(0, 'Built-in(0)', 0, 0, 1512, 982), m(2, 'Other(2)', 1920, 0)])).toMatchObject({ index: 2 })
  })
  it('matches by name and size when moved', () => {
    const saved = { name: 'HDMI(1)', x: 1920, y: 0, width: 1920, height: 1080 }
    expect(matchDisplay(saved, [m(0, 'Built-in(0)', 0, 0), m(1, 'HDMI(3)', 3000, 0)])).toMatchObject({ index: 1 })
  })
  it('returns null when display gone', () => {
    const saved = { name: 'HDMI(1)', x: 1920, y: 0, width: 1920, height: 1080 }
    expect(matchDisplay(saved, [m(0, 'Built-in(0)', 0, 0, 1512, 982)])).toBeNull()
  })
})
