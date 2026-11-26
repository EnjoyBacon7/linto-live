import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bandLines, bandPlacement, layoutText, SubtitleModel, windowMetrics, type Layout } from '../../src/main/overlay/page/layout.js'

const fits = (l: string): boolean => l.length <= 20
const empty: Layout = { words: [], cuts: [] }
const SIX = 'un deux trois quatre cinq six'

describe('layoutText', () => {
  it('wraps greedily', () => {
    expect(layoutText(empty, SIX, fits).cuts).toEqual([4])
  })

  it('keeps earlier cuts stable when text grows on the last line', () => {
    const prev = layoutText(empty, SIX, fits)
    expect(layoutText(prev, 'un deux trois quatre cinq sixième sept', fits).cuts[0]).toBe(4)
  })

  it('a correction inside line 2 never moves cut 4', () => {
    const prev = layoutText(empty, SIX, fits)
    expect(layoutText(prev, 'un deux trois quatre CINQ six', fits).cuts).toEqual([4])
  })

  it('a correction inside line 1 recomputes from 0', () => {
    const prev = layoutText(empty, SIX, fits)
    const next = layoutText(prev, 'un DEUX trois quatre cinq six', fits)
    expect(next.words[1]).toBe('DEUX')
    expect(next.cuts).toEqual([4])
    const shortened = layoutText(prev, 'un d t q cinq six', fits)
    expect(shortened.cuts).toEqual([])
  })

  it('never leaves an empty last line when text shrinks to a cut boundary', () => {
    const prev = layoutText(empty, SIX, fits)
    expect(prev.cuts).toEqual([4])
    expect(layoutText(prev, 'un deux trois quatre', fits).cuts).toEqual([])
  })

  it('a correction exactly at the first word of line 2 keeps the cut', () => {
    const prev = layoutText(empty, SIX, fits)
    expect(layoutText(prev, 'un deux trois quatre CINQ six', fits).cuts).toEqual([4])
    expect(layoutText(prev, 'un deux trois quatre cinquante six', fits).cuts).toEqual([4])
  })

  it('drops cuts when text shrinks', () => {
    const prev = layoutText(empty, SIX, fits)
    expect(layoutText(prev, 'un deux', fits).cuts).toEqual([])
  })

  it('puts an overlong word alone on its line and terminates', () => {
    const long = 'x'.repeat(50)
    const l = layoutText(empty, `a ${long} b`, fits)
    expect(l.cuts).toEqual([1, 2])
    expect(l.words).toEqual(['a', long, 'b'])
  })

  it('returns prev for blank text', () => {
    const prev = layoutText(empty, SIX, fits)
    expect(layoutText(prev, '   ', fits)).toBe(prev)
  })
})

describe('SubtitleModel', () => {
  it('starts hidden with empty lines', () => {
    const m = new SubtitleModel(fits)
    expect(m.visible).toBe(false)
    expect(m.lines()).toEqual(['', ''])
  })

  it('shows a partial on the lower line', () => {
    const m = new SubtitleModel(fits)
    m.partial('bonjour')
    expect(m.lines()).toEqual(['', 'bonjour'])
    expect(m.visible).toBe(true)
  })

  it('shows the finalised line above the next partial', () => {
    const m = new SubtitleModel(fits)
    m.final('bonjour à tous')
    m.partial('suite')
    expect(m.lines()).toEqual(['bonjour à tous', 'suite'])
  })

  it('shows lines 2 and 3 of a three-line partial', () => {
    const m = new SubtitleModel(fits)
    m.partial('un deux trois quatre cinq six sept huit neuf dix onze douze')
    expect(m.lines()).toEqual(['cinq six sept huit', 'neuf dix onze douze'])
  })

  it('final with blank text keeps previous', () => {
    const m = new SubtitleModel(fits)
    m.final('bonjour')
    m.final('')
    expect(m.lines()).toEqual(['bonjour', ''])
  })

  it('reset clears everything', () => {
    const m = new SubtitleModel(fits)
    m.final('bonjour')
    m.partial('suite')
    m.reset()
    expect(m.lines()).toEqual(['', ''])
    expect(m.visible).toBe(false)
  })

  it('ignores blank partials', () => {
    const m = new SubtitleModel(fits)
    m.partial('   ')
    expect(m.lines()).toEqual(['', ''])
    expect(m.visible).toBe(false)
  })
})

describe('SubtitleModel.lines(n)', () => {
  it('1 line: the text being spoken, else the end of the previous one', () => {
    const m = new SubtitleModel(fits)
    expect(m.lines(1)).toEqual([''])
    m.partial('un deux trois quatre cinq six')
    expect(m.lines(1)).toEqual(['cinq six'])
    m.final('un deux trois quatre cinq six sept')
    expect(m.lines(1)).toEqual(['cinq six sept'])
    m.partial('suite')
    expect(m.lines(1)).toEqual(['suite'])
  })
  it('2 lines (default) as before', () => {
    const m = new SubtitleModel(fits)
    m.final('bonjour à tous')
    m.partial('suite')
    expect(m.lines(2)).toEqual(m.lines())
    expect(m.lines()).toEqual(['bonjour à tous', 'suite'])
  })
  it('3 lines: the previous text fills the lines above the current one', () => {
    const m = new SubtitleModel(fits)
    expect(m.lines(3)).toEqual(['', '', ''])
    m.final('un deux trois quatre cinq six sept huit')
    expect(m.lines(3)).toEqual(['un deux trois quatre', 'cinq six sept huit', ''])
    m.partial('suite')
    expect(m.lines(3)).toEqual(['un deux trois quatre', 'cinq six sept huit', 'suite'])
    m.partial('un deux trois quatre cinq six sept huit neuf dix onze douze')
    expect(m.lines(3)).toEqual(['un deux trois quatre', 'cinq six sept huit', 'neuf dix onze douze'])
  })
})

describe('bandLines', () => {
  it('1..3, anything else is 2', () => {
    expect([1, 2, 3].map(bandLines)).toEqual([1, 2, 3])
    expect([0, 4, 1.5, '1', undefined].map(bandLines)).toEqual([2, 2, 2, 2, 2])
  })
})

describe('caption measurement', () => {
  it('measures with the font the band is drawn with (default size and family stack)', () => {
    const dir = join(__dirname, '../../src/main/overlay/page')
    const css = readFileSync(join(dir, 'overlay.css'), 'utf8')
    const js = readFileSync(join(dir, 'overlay.js'), 'utf8')
    const band = /#band\s*\{([^}]*)\}/.exec(css)![1]!
    const family = /font-family:\s*([^;]+);/.exec(band)![1]!.trim()
    expect(/font-size:\s*([^;]+);/.exec(band)![1]!.trim()).toBe('var(--fs)')
    const cssSize = /--fs:\s*(\d+)px;/.exec(band)![1]
    expect(/let fontSize = (\d+)/.exec(js)![1]).toBe(cssSize)
    expect(/const font = size \+ 'px ([^']+)'/.exec(js)![1]).toBe(family)
  })
})

describe('bandPlacement', () => {
  it('0 = bottom edge, 100 = top edge, clamped; anything else is the bottom', () => {
    expect(bandPlacement(0)).toEqual({ ratio: 0, qrLow: false })
    expect(bandPlacement(100)).toEqual({ ratio: 1, qrLow: true })
    expect(bandPlacement(250).ratio).toBe(1)
    expect(bandPlacement(-3).ratio).toBe(0)
    expect(bandPlacement(undefined)).toEqual({ ratio: 0, qrLow: false })
    expect(bandPlacement('40')).toEqual({ ratio: 0, qrLow: false })
  })
  it('the QR code never overlaps the band, even with the largest font and the most lines', () => {
    const H = 1080, band = 1.2 * 3 * 96, qrTop = 40, qrSize = 240 + 2 * 16
    for (let p = 0; p <= 100; p++) {
      const { ratio, qrLow } = bandPlacement(p)
      const bottom = ratio * (H - band) // CSS: bottom = --pos × (1080 − band height)
      const bandTop = H - bottom - band
      const bandBottom = H - bottom
      const qrY = qrLow ? H - 40 - qrSize : qrTop
      expect(bandBottom <= qrY || bandTop >= qrY + qrSize, `position ${p}`).toBe(true)
    }
  })
  it('the stylesheet places the band from --pos over its travel', () => {
    const css = readFileSync(join(__dirname, '../../src/main/overlay/page/overlay.css'), 'utf8')
    expect(css).toContain('bottom: calc(var(--pos) * (1080px - 1.2 * var(--lines) * var(--fs)));')
    expect(css).toContain('height: calc(1.2 * var(--lines) * var(--fs));')
  })
})

describe('windowMetrics', () => {
  it('police = hauteur / 2,4, largeur utile = largeur − 2 × marge (0,5 × police)', () => {
    expect(windowMetrics(960, 120)).toEqual({ fontSize: 50, lineWidth: 910 })
  })
  it('suit le redimensionnement', () => {
    expect(windowMetrics(1200, 240)).toEqual({ fontSize: 100, lineWidth: 1100 })
  })
  it('ne descend jamais sous 1 px de largeur utile', () => {
    expect(windowMetrics(10, 240).lineWidth).toBe(1)
  })
})
