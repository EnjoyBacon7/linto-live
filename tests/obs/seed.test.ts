import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedFiles, writeSeed } from '../../src/main/obs/seed'

const o = { canvas: { width: 1920, height: 1080, fps: 30 } } as const
const dirs: string[] = []
const tmp = async () => {
  const d = await mkdtemp(join(tmpdir(), 'seed-test-'))
  dirs.push(d)
  return d
}
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true })
})

describe('seedFiles', () => {
  const f = seedFiles(o)
  it('global.ini', () => {
    const g = f['global.ini']
    for (const l of [
      'FirstRun=true', 'LastVersion=536936448', 'InfoLastVersion=35188667056128', 'InfoIncrement=999',
      'EnableAutoUpdates=false', 'MacOSPermissionsDialogLastShown=1', 'Pre31Migrated=true'
    ]) expect(g).toContain(l)
    expect(g).not.toContain('[OBSWebSocket]')
  })
  it('user.ini', () => {
    const u = f['user.ini']
    expect(u).toContain('[General]\nFirstRun=true\nConfirmOnExit=false')
    expect(u).toContain('[BasicWindow]')
    for (const l of ['SysTrayEnabled=true', 'SysTrayWhenStarted=true', 'SaveProjectors=false']) expect(u).toContain(l)
  })
  it('basic.ini', () => {
    const b = f['basic/profiles/LinTO Live/basic.ini']
    for (const l of ['BaseCX=1920', 'BaseCY=1080', 'OutputCX=1920', 'OutputCY=1080', 'FPSCommon=30', 'Mode=Simple', 'VBitrate=800', 'ABitrate=128'])
      expect(b).toContain(l)
  })
  it('scene collection', () => {
    const s = JSON.parse(f['basic/scenes/LinTO Live.json'])
    expect(s.name).toBe('LinTO Live')
    expect(s.scene_order).toEqual([{ name: 'LinTO Live' }])
    expect(s.sources.filter((x: { id: string }) => x.id === 'scene')).toHaveLength(1)
    expect(s.sources[0].name).toBe('LinTO Live')
    expect(Object.keys(s).filter((k) => /^(DesktopAudioDevice|AuxAudioDevice)/.test(k))).toEqual([])
  })
  it('websocket config', () => {
    expect(JSON.parse(f['plugin_config/obs-websocket/config.json'])).toEqual({
      first_load: false, server_enabled: true, auth_required: true, alerts_enabled: false
    })
  })
})

describe('writeSeed', () => {
  it('removes .sentinel/run_* and keeps modified files', async () => {
    const d = await tmp()
    await mkdir(join(d, '.sentinel'), { recursive: true })
    await writeFile(join(d, '.sentinel', 'run_123'), '')
    await writeFile(join(d, '.sentinel', 'keep'), '')
    await writeSeed(d, o)
    await expect(access(join(d, '.sentinel', 'run_123'))).rejects.toThrow()
    await access(join(d, '.sentinel', 'keep'))
    const p = join(d, 'basic/profiles/LinTO Live/basic.ini')
    await writeFile(p, 'modified')
    await writeSeed(d, o)
    expect(await readFile(p, 'utf8')).toBe('modified')
  })
  it('always rewrites global.ini [General] keys, preserving other sections', async () => {
    const d = await tmp()
    await writeFile(join(d, 'global.ini'), '[General]\nFirstRun=false\nInfoIncrement=1\nOther=x\n\n[Foo]\nA=1\n')
    await writeSeed(d, o)
    const g = await readFile(join(d, 'global.ini'), 'utf8')
    expect(g).toContain('FirstRun=true')
    expect(g).not.toContain('FirstRun=false')
    expect(g).toContain('InfoIncrement=999')
    expect(g).toContain('Other=x')
    expect(g).toContain('[Foo]\nA=1')
  })
})
