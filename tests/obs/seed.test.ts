import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedFiles, writeSeed } from '../../src/main/obs/seed'

const o = { canvas: { width: 1920, height: 1080, fps: 30 }, platform: 'darwin' } as const
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
    for (const l of ['SysTrayEnabled=true', 'SysTrayWhenStarted=true', 'SaveProjectors=false', 'ProjectorAlwaysOnTop=true']) expect(u).toContain(l)
  })
  it('user.ini without the OBS tray icon (Linux)', () => {
    const u = seedFiles({ ...o, platform: 'linux' })['user.ini']
    for (const l of ['SysTrayEnabled=false', 'SysTrayWhenStarted=false', 'SaveProjectors=false', 'ProjectorAlwaysOnTop=true']) expect(u).toContain(l)
  })
  it('basic.ini: full HD canvas and output, Advanced output mode', () => {
    const b = f['basic/profiles/LinTO Live/basic.ini']
    for (const l of ['BaseCX=1920', 'BaseCY=1080', 'OutputCX=1920', 'OutputCY=1080', 'FPSType=0', 'FPSCommon=30', '[Output]\nMode=Advanced'])
      expect(b).toContain(l)
  })
  it('basic.ini: the stream (LinTO only uses its audio) is rescaled to 640×360, the mic is on track 1', () => {
    const b = f['basic/profiles/LinTO Live/basic.ini']
    for (const l of ['Rescale=true', 'RescaleRes=640x360', 'RescaleFilter=3', 'TrackIndex=1', 'Track1Bitrate=128']) expect(b).toContain(l)
  })
  it('basic.ini: records the full-resolution output to MKV with its own encoder, track 1 only', () => {
    const b = f['basic/profiles/LinTO Live/basic.ini']
    for (const l of ['RecType=Standard', 'RecFormat2=mkv', 'RecTracks=1', 'RecRescale=false', 'RecRescaleFilter=0']) expect(b).toContain(l)
  })
  it('basic.ini: hardware H.264 (VideoToolbox) on macOS, x264 on Linux, for both encoders', () => {
    const mac = f['basic/profiles/LinTO Live/basic.ini']
    expect(mac).toMatch(/^Encoder=com\.apple\.videotoolbox\.videoencoder\.ave\.avc$/m)
    expect(mac).toContain('RecEncoder=com.apple.videotoolbox.videoencoder.ave.avc\n')
    const linux = seedFiles({ ...o, platform: 'linux' })['basic/profiles/LinTO Live/basic.ini']
    expect(linux).toMatch(/^Encoder=obs_x264$/m)
    expect(linux).toContain('RecEncoder=obs_x264\n')
    expect(linux).not.toContain('videotoolbox')
  })
  it('encoder settings: cheap stream (200 kbps), ~6000 kbps recording; x264 presets on Linux', () => {
    const dir = 'basic/profiles/LinTO Live/'
    expect(JSON.parse(f[dir + 'streamEncoder.json'])).toMatchObject({ rate_control: 'CBR', bitrate: 200, keyint_sec: 2 })
    expect(JSON.parse(f[dir + 'recordEncoder.json'])).toMatchObject({ rate_control: 'CBR', bitrate: 6000, keyint_sec: 2 })
    const linux = seedFiles({ ...o, platform: 'linux' })
    expect(JSON.parse(linux[dir + 'streamEncoder.json'])).toMatchObject({ rate_control: 'CBR', bitrate: 200, preset: 'ultrafast' })
    expect(JSON.parse(linux[dir + 'recordEncoder.json'])).toMatchObject({ rate_control: 'CBR', bitrate: 6000, preset: 'veryfast' })
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
    const p = join(d, 'basic/scenes/LinTO Live.json')
    await writeFile(p, 'modified')
    await writeSeed(d, o)
    expect(await readFile(p, 'utf8')).toBe('modified')
  })
  it('re-applies our basic.ini keys on an existing install, keeping keys and sections written by OBS', async () => {
    const d = await tmp()
    const p = join(d, 'basic/profiles/LinTO Live/basic.ini')
    await mkdir(join(d, 'basic/profiles/LinTO Live'), { recursive: true })
    await writeFile(
      p,
      '[General]\nName=LinTO Live\n\n[Video]\nBaseCX=1280\nColorFormat=NV12\n\n[SimpleOutput]\nVBitrate=2500\nFilePath=/tmp\n\n[Audio]\nSampleRate=48000\n'
    )
    await writeSeed(d, o)
    const b = await readFile(p, 'utf8')
    expect(b).toContain('BaseCX=1920')
    expect(b).not.toContain('BaseCX=1280')
    expect(b).toContain('ColorFormat=NV12')
    expect(b).toContain('VBitrate=2500') // Simple-mode section left to OBS (unused in Advanced mode)
    expect(b).toContain('FilePath=/tmp')
    expect(b).toContain('[Audio]\nSampleRate=48000')
    expect(b).toContain('[Output]\nMode=Advanced') // missing section added
    expect(b).toContain('[AdvOut]\n')
    expect(b).toContain('OutputCX=1920')
    expect(b.match(/^\[Video\]$/gm)).toHaveLength(1)
    // idempotent
    await writeSeed(d, o)
    expect(await readFile(p, 'utf8')).toBe(b)
  })
  it('rewrites the encoder settings files on every launch (they are ours)', async () => {
    const d = await tmp()
    const p = join(d, 'basic/profiles/LinTO Live/recordEncoder.json')
    await mkdir(join(d, 'basic/profiles/LinTO Live'), { recursive: true })
    await writeFile(p, '{"bitrate":2500}')
    await writeSeed(d, o)
    expect(JSON.parse(await readFile(p, 'utf8')).bitrate).toBe(6000)
  })
  it('re-applies our user.ini keys on an existing install', async () => {
    const d = await tmp()
    const p = join(d, 'user.ini')
    await writeFile(p, '[General]\nFirstRun=false\nConfirmOnExit=true\nLastVersion=1\n\n[BasicWindow]\nSaveProjectors=true\ngeometry=abc\n')
    await writeSeed(d, o)
    const u = await readFile(p, 'utf8')
    expect(u).toContain('ConfirmOnExit=false')
    expect(u).not.toContain('ConfirmOnExit=true')
    expect(u).toContain('SaveProjectors=false')
    expect(u).not.toContain('SaveProjectors=true')
    expect(u).toContain('LastVersion=1')
    expect(u).toContain('geometry=abc')
    expect(u).toContain('SysTrayEnabled=true')
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
