import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))

describe('package.json', () => {
  it('declares the author (electron-builder metadata)', () => {
    expect(pkg.author).toBe('LINAGORA')
  })
  it('dist:mac fails early when the bundled OBS.app has not been fetched', () => {
    const s: string = pkg.scripts['dist:mac']
    expect(s.startsWith("test -d vendor/obs/macos/OBS.app || (echo 'Lance npm run fetch:obs:mac' && exit 1)")).toBe(true)
    expect(s.indexOf('test -d')).toBeLessThan(s.indexOf('npm run build'))
  })
})
