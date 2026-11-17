import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OBSWebSocket } from 'obs-websocket-js'
import { afterAll, describe, expect, it } from 'vitest'
import { ObsController, SCENE, SRC_AUDIO, SRC_BACKUP, SRC_OVERLAY, SRC_VIDEO } from '../../src/main/obs/controller'
import { obsExecutable } from '../../src/main/obs/locate'
import { ObsProcess } from '../../src/main/obs/process'
import { appPaths } from '../../src/main/paths'
import { openBroadcast } from '../../src/main/broadcast/relay'

const platform = process.platform
const run = process.env.LINTO_LIVE_IT === '1' && (platform === 'darwin' || platform === 'linux')
const expectedKinds =
  platform === 'darwin'
    ? ['macos-avcapture', 'coreaudio_input_capture', 'browser_source']
    : ['v4l2_input', 'pulse_input_capture', 'browser_source']

/** Video stream size of a media file (ffprobe), or null when ffprobe is not installed. */
function videoSize(file: string): { width: number; height: number } | null {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file], {
      encoding: 'utf8'
    })
    const s = JSON.parse(out).streams[0]
    return { width: s.width, height: s.height }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}
const hasFfmpeg = ((): boolean => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

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

  it('turns the micro audio feedback on (monitor and output) and off', async () => {
    const raw = new OBSWebSocket()
    await raw.connect(`ws://127.0.0.1:${conn!.port}`, conn!.password)
    const type = async (): Promise<string> => (await raw.call('GetInputAudioMonitorType', { inputName: SRC_AUDIO })).monitorType
    try {
      await ctl!.setAudioMonitor(true)
      expect(await type()).toBe('OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT')
      await ctl!.setAudioMonitor(false)
      expect(await type()).toBe('OBS_MONITORING_TYPE_NONE')
    } finally {
      await raw.disconnect()
    }
  }, 30_000)

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
    expect(ev).toEqual([{ active: true }]) // STARTING is not reported
    const path = await ctl!.stopRecord()
    expect(path).toMatch(/Test enreg \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.mkv$/)
    await new Promise((r) => setTimeout(r, 500))
    expect(existsSync(path!)).toBe(true)
    expect(path!.startsWith(dir)).toBe(true) // SetRecordDirectory applies in Advanced output mode
    expect(statSync(path!).size).toBeGreaterThan(20_000) // a still picture: the H.264 encoder needs little
    const size = videoSize(path!)
    console.log('recording video size', JSON.stringify(size), 'bytes', statSync(path!).size)
    if (size) expect(size).toEqual({ width: 1920, height: 1080 }) // full canvas, not the 640×360 stream
    expect(await ctl!.stopRecord()).toBeNull()
  }, 30_000)

  it('a new recording starts right after the previous one is stopped (session switch)', async () => {
    const dir = join(userData, 'rec-switch')
    mkdirSync(dir)
    const ev: { active: boolean; path?: string }[] = []
    const off = ctl!.recordState$((x) => ev.push(x))
    const waitFor = async (pred: () => boolean, ms: number): Promise<void> => {
      for (const end = Date.now() + ms; !pred(); ) {
        if (Date.now() > end) throw new Error('timeout ' + JSON.stringify(ev))
        await new Promise((r) => setTimeout(r, 20))
      }
    }
    await ctl!.startRecord(dir, 'Session A')
    await waitFor(() => ev.some((e) => e.active), 5000)
    await new Promise((r) => setTimeout(r, 1000))
    const first = await ctl!.stopRecord()
    const stoppedAtAnswer = ev.some((e) => !e.active)
    // What LiveController does: wait for « stopped », then start, retrying while OBS says OutputRunning.
    await waitFor(() => ev.some((e) => !e.active), 5000)
    let refused = 0
    for (;;) {
      try {
        await ctl!.startRecord(dir, 'Session B')
        break
      } catch (e) {
        if ((e as { code?: number }).code !== 500 || refused >= 5) throw e
        refused++
        await new Promise((r) => setTimeout(r, 200))
      }
    }
    console.log('stopped event before StopRecord answer:', stoppedAtAnswer, '— OutputRunning refusals:', refused)
    await waitFor(() => ev.filter((e) => e.active).length === 2, 5000)
    await new Promise((r) => setTimeout(r, 1000))
    const second = await ctl!.stopRecord()
    off()
    expect(first).toMatch(/Session A .*\.mkv$/)
    expect(second).toMatch(/Session B .*\.mkv$/)
    await new Promise((r) => setTimeout(r, 500))
    expect(existsSync(first!) && existsSync(second!)).toBe(true)
  }, 30_000)

  it.skipIf(!hasFfmpeg)('streams at 640×360 (rescaled stream encoder) while recording at full resolution', async () => {
    const port = 19350 + Math.floor(Math.random() * 500)
    const flv = join(userData, 'stream.flv')
    // ffmpeg as a one-shot RTMP server: stands in for LinTO's ingest.
    const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-listen', '1', '-i', `rtmp://127.0.0.1:${port}/live/test`, '-c', 'copy', flv], {
      stdio: 'ignore'
    })
    const exited = new Promise((r) => ff.once('exit', r))
    try {
      await new Promise((r) => setTimeout(r, 1000))
      const states: string[] = []
      const off = ctl!.streamState$((x) => states.push(x))
      await ctl!.startStream({ streamServiceType: 'rtmp_custom', streamServiceSettings: { server: `rtmp://127.0.0.1:${port}/live`, key: 'test' } })
      const dir = join(userData, 'rec2')
      mkdirSync(dir)
      await ctl!.startRecord(dir, 'Pendant le direct')
      await new Promise((r) => setTimeout(r, 3000))
      const path = await ctl!.stopRecord()
      expect(states).toContain('active')
      await ctl!.stopStream()
      off()
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))])
      expect(videoSize(flv)).toEqual({ width: 640, height: 360 })
      await new Promise((r) => setTimeout(r, 500))
      expect(videoSize(path!)).toEqual({ width: 1920, height: 1080 })
    } finally {
      ff.kill('SIGKILL')
    }
  }, 40_000)

  it.skipIf(!hasFfmpeg)('broadcasts the full output through the relay while the stream to LinTO runs; the key never reaches OBS', async () => {
    const base = 19850 + Math.floor(Math.random() * 500)
    const KEY = 'cle-secrete-' + Math.random().toString(36).slice(2)
    const linto = join(userData, 'linto.flv')
    const online = join(userData, 'online.flv')
    // Two one-shot RTMP servers: LinTO's ingest and the online platform.
    const servers = [
      spawn('ffmpeg', ['-v', 'error', '-y', '-listen', '1', '-i', `rtmp://127.0.0.1:${base}/live/test`, '-c', 'copy', linto], { stdio: 'ignore' }),
      spawn('ffmpeg', ['-v', 'error', '-y', '-listen', '1', '-i', `rtmp://127.0.0.1:${base + 1}/live2/${KEY}`, '-c', 'copy', online], { stdio: 'ignore' })
    ]
    const exited = servers.map((ff) => new Promise((r) => ff.once('exit', r)))
    const raw = new OBSWebSocket()
    await raw.connect(`ws://127.0.0.1:${conn!.port}`, conn!.password)
    try {
      await new Promise((r) => setTimeout(r, 1000))
      const rec: { active: boolean; path?: string }[] = []
      const off = ctl!.recordState$((x) => rec.push(x))
      await ctl!.startStream({ streamServiceType: 'rtmp_custom', streamServiceSettings: { server: `rtmp://127.0.0.1:${base}/live`, key: 'test' } })
      await new Promise((r) => setTimeout(r, 1500))
      const session = await openBroadcast({ server: `rtmp://127.0.0.1:${base + 1}/live2`, key: KEY })
      await ctl!.startBroadcast(session.url)
      await new Promise((r) => setTimeout(r, 3000))
      expect(rec).toContainEqual({ active: true })
      expect((await raw.call('GetStreamStatus')).outputActive).toBe(true)
      await ctl!.stopRecord()
      session.close()
      expect((await raw.call('GetStreamStatus')).outputActive).toBe(true) // LinTO's stream goes on
      await ctl!.stopStream()
      off()
      await Promise.race([Promise.all(exited), new Promise((r) => setTimeout(r, 5000))])
      expect(videoSize(online)).toEqual({ width: 1920, height: 1080 })
      expect(videoSize(linto)).toEqual({ width: 640, height: 360 })

      // A refused connection: the relay fails before OBS is involved.
      await expect(openBroadcast({ server: 'rtmp://127.0.0.1:9/live2', key: KEY })).rejects.toThrow()

      // Back to a file after a broadcast.
      const dir = join(userData, 'rec3')
      mkdirSync(dir)
      await ctl!.startRecord(dir, 'Après diffusion')
      await new Promise((r) => setTimeout(r, 2000))
      const path = await ctl!.stopRecord()
      expect(path).toMatch(/Après diffusion \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.mkv$/)
      await new Promise((r) => setTimeout(r, 500))
      expect(existsSync(path!)).toBe(true)

      // Nowhere in OBS's files: profile, scene collection, logs.
      const grep = spawnSync('grep', ['-rl', KEY, paths.obsConfigDir], { encoding: 'utf8' })
      expect(grep.stdout).toBe('')
      expect(grep.status).toBe(1) // 1: no match (2 would be an error)
    } finally {
      servers.forEach((ff) => ff.kill('SIGKILL'))
      await raw.disconnect().catch(() => {})
    }
  }, 40_000)
})
