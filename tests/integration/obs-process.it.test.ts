import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { obsExecutable } from '../../src/main/obs/locate'
import { ObsProcess } from '../../src/main/obs/process'
import { appPaths } from '../../src/main/paths'

const run = process.env.LINTO_LIVE_IT === '1' && process.platform === 'darwin'
const realObs = join(homedir(), 'Library', 'Application Support', 'obs-studio')
const mtime = (): number | null => (existsSync(realObs) ? statSync(realObs).mtimeMs : null)

describe.skipIf(!run)('ObsProcess (real OBS)', () => {
  const userData = mkdtempSync(join(tmpdir(), 'linto-live-it-'))
  const paths = appPaths(userData, 'darwin')
  const obs = new ObsProcess({
    exe: obsExecutable({ packaged: false, resourcesPath: '', platform: 'darwin', env: process.env }),
    paths,
    platform: 'darwin'
  })
  afterAll(async () => {
    await obs.stop()
    rmSync(userData, { recursive: true, force: true })
  })

  it('starts, stops cleanly, leaves real OBS config untouched', async () => {
    const before = mtime()
    const conn = await obs.start()
    expect(conn.port).toBeGreaterThan(0)
    await obs.stop()
    expect(mtime()).toBe(before)
    const sentinel = join(paths.obsConfigDir, '.sentinel')
    const leftovers = existsSync(sentinel) ? readdirSync(sentinel).filter((f) => f.startsWith('run_')) : []
    expect(leftovers).toEqual([])
    const ini = readFileSync(join(paths.obsConfigDir, 'basic/profiles/LinTO Live/basic.ini'), 'utf8')
    console.log('--- basic.ini after stop ---\n' + ini)
  }, 60_000)
})
