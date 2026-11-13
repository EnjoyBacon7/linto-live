import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OBSWebSocket } from 'obs-websocket-js'
import { afterAll, describe, expect, it } from 'vitest'
import { ObsController, SCENE, SRC_AUDIO, SRC_BACKUP, SRC_OVERLAY, SRC_VIDEO } from '../../src/main/obs/controller'
import { obsExecutable } from '../../src/main/obs/locate'
import { ObsProcess } from '../../src/main/obs/process'
import { appPaths } from '../../src/main/paths'

const platform = process.platform
const run = process.env.LINTO_LIVE_IT === '1' && (platform === 'darwin' || platform === 'linux')
const expectedKinds =
  platform === 'darwin'
    ? ['macos-avcapture', 'coreaudio_input_capture', 'browser_source']
    : ['v4l2_input', 'pulse_input_capture', 'browser_source']

describe.skipIf(!run)('ObsController (real OBS)', () => {
  const userData = mkdtempSync(join(tmpdir(), 'linto-live-it-'))
  const paths = appPaths(userData, platform)
  const obs = new ObsProcess({
    exe: obsExecutable({ packaged: false, resourcesPath: '', platform, env: process.env }),
    paths,
    platform
  })
  let ctl: ObsController | undefined
  let conn: { port: number; password: string } | undefined
  afterAll(async () => {
    await ctl?.disconnect().catch(() => {})
    await obs.stop()
    rmSync(userData, { recursive: true, force: true })
  })

  it('builds the scene, lists audio devices, sets overlay, screenshots', async () => {
    conn = await obs.start()

    const raw = new OBSWebSocket()
    await raw.connect(`ws://127.0.0.1:${conn.port}`, conn.password)
    const { inputKinds } = await raw.call('GetInputKindList', { unversioned: false })
    console.log('--- input kinds ---\n' + inputKinds.join('\n'))
    await raw.disconnect()
    for (const k of expectedKinds) {
      expect(inputKinds.some((x) => x === k || x.startsWith(k + '_v'))).toBe(true)
    }

    ctl = await ObsController.connect(conn)
    await ctl.ensureScene(platform)
    await ctl.ensureScene(platform)
    const audio = await ctl.listAudioDevices()
    console.log('audio devices', JSON.stringify(audio))
    expect(audio.length).toBeGreaterThan(0)
    console.log('video devices', JSON.stringify(await ctl.listVideoDevices()))
    await ctl.setAudioDevice(audio[0].id)
    await ctl.setOverlayUrl('about:blank')
    await new Promise((r) => setTimeout(r, 1500))
    const shot = await ctl.screenshot()
    // obs-websocket labels imageFormat 'jpg' as data:image/jpg
    expect(shot).toMatch(/^data:image\/jpe?g;base64,/)
    expect([SRC_VIDEO, SRC_AUDIO, SRC_OVERLAY]).toHaveLength(3)
  }, 90_000)

  it('swaps the primary to an image and back, stacks a hidden backup above it', async () => {
    // 1×1 white PNG
    const png = join(userData, 'white.png')
    writeFileSync(
      png,
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64')
    )
    await ctl!.setSource('primary', { kind: 'image', path: png })
    await ctl!.setSource('backup', { kind: 'image', path: png })
    await ctl!.setBackupVisible(true)
    await ctl!.setBackupVisible(false)
    await new Promise((r) => setTimeout(r, 500))
    expect(await ctl!.probePrimary()).toMatch(/^data:image\/png;base64,/)

    const raw = new OBSWebSocket()
    await raw.connect(`ws://127.0.0.1:${conn!.port}`, conn!.password)
    try {
      const kind = async (inputName: string) => (await raw.call('GetInputSettings', { inputName })).inputKind
      expect(await kind(SRC_VIDEO)).toBe('image_source')
      expect(await kind(SRC_BACKUP)).toBe('image_source')
      const order = async () =>
        ((await raw.call('GetSceneItemList', { sceneName: SCENE })).sceneItems as { sourceName: string }[]).map((i) => i.sourceName)
      let o = await order()
      expect(o.indexOf(SRC_VIDEO)).toBeLessThan(o.indexOf(SRC_BACKUP))
      expect(o.indexOf(SRC_BACKUP)).toBeLessThan(o.indexOf(SRC_OVERLAY))

      // Back to a device input and to an image again: the input is recreated under the same name.
      await ctl!.setSource('primary', { kind: 'none' })
      expect(await kind(SRC_VIDEO)).not.toBe('image_source')
      await ctl!.setSource('primary', { kind: 'image', path: png })
      expect(await kind(SRC_VIDEO)).toBe('image_source')
      o = await order()
      expect(o[0]).toBe(SRC_VIDEO)
      expect(o.indexOf(SRC_BACKUP)).toBeLessThan(o.indexOf(SRC_OVERLAY))
    } finally {
      await raw.disconnect().catch(() => {})
    }
  }, 60_000)

  it('records the output to an mkv file in the chosen directory', async () => {
    const dir = join(userData, 'rec')
    mkdirSync(dir) // OBS does not create the record directory itself (the app must)
    const ev: unknown[] = []
    const off = ctl!.recordState$((x) => ev.push(x))
    await ctl!.startRecord(dir, 'Test enreg')
    await new Promise((r) => setTimeout(r, 2000))
    off()
    expect(ev.at(-1)).toMatchObject({ active: true }) // STARTING reports active=false first
    const path = await ctl!.stopRecord()
    expect(path).toMatch(/Test enreg \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.mkv$/)
    await new Promise((r) => setTimeout(r, 500))
    expect(existsSync(path!)).toBe(true)
    expect(await ctl!.stopRecord()).toBeNull()
  }, 30_000)
})
