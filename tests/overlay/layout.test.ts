import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { layoutText, SubtitleModel, type Layout } from '../../src/main/overlay/page/layout.js'

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

describe('caption measurement', () => {
  it('measures with the font the band is drawn with (size and family stack)', () => {
    const dir = join(__dirname, '../../src/main/overlay/page')
    const css = readFileSync(join(dir, 'overlay.css'), 'utf8')
    const js = readFileSync(join(dir, 'overlay.js'), 'utf8')
    const band = /#band\s*\{([^}]*)\}/.exec(css)![1]!
    const family = /font-family:\s*([^;]+);/.exec(band)![1]!.trim()
    const size = /font-size:\s*([^;]+);/.exec(band)![1]!.trim()
    const canvasFont = /ctx\.font\s*=\s*'([^']+)'/.exec(js)![1]
    expect(canvasFont).toBe(`${size} ${family}`)
  })
})
