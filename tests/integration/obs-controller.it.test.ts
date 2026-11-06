import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OBSWebSocket } from 'obs-websocket-js'
import { afterAll, describe, expect, it } from 'vitest'
import { ObsController, SRC_AUDIO, SRC_OVERLAY, SRC_VIDEO } from '../../src/main/obs/controller'
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
  afterAll(async () => {
    await ctl?.disconnect().catch(() => {})
    await obs.stop()
    rmSync(userData, { recursive: true, force: true })
  })

  it('builds the scene, lists audio devices, sets overlay, screenshots', async () => {
    const conn = await obs.start()

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
})
