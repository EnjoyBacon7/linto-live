import { describe, expect, it } from 'vitest'
import { FFMPEG_OUTPUT, fileStamp,
  ObsController, recordBaseName, SCENE, SCENE_PAUSE, SRC_AUDIO, SRC_BACKUP, SRC_DEVICES, SRC_OVERLAY, SRC_VIDEO, type ObsClient
} from '../../src/main/obs/controller'

type Call = { req: string; data?: Record<string, unknown> }

class CodedError extends Error {
  constructor(public code: number, message: string) {
    super(message)
  }
}

function fakeClient(
  opts: { items?: unknown[]; failStart?: boolean; stopError?: Error; noAudio?: string[]; lingerAfterRemove?: number; recordStopError?: Error } = {}
) {
  let active = false
  let starting = false
  let nextId = 1
  let linger = 0
  const calls: Call[] = []
  const scenes = new Map<string, { sourceName: string; sceneItemId: number; sceneItemEnabled: boolean }[]>()
  const inputs = new Map<string, { inputKind: string; inputSettings: Record<string, unknown> }>()
  const handlers = new Map<string, Set<(d: unknown) => void>>()
  const sceneOf = (name: unknown) => scenes.get(name as string) ?? []
  const addItem = (sceneName: unknown, sourceName: string, enabled: unknown) => {
    const sceneItemId = nextId++
    sceneOf(sceneName).push({ sourceName, sceneItemId, sceneItemEnabled: enabled !== false })
    return sceneItemId
  }
  const client: ObsClient = {
    async call(req, data) {
      calls.push({ req, data })
      // Real obs-websocket: audio requests on an input without audio (Linux v4l2) fail with 604.
      if ((req === 'SetInputAudioTracks' || req === 'SetInputMute') && opts.noAudio?.includes(data!.inputName as string)) {
        throw Object.assign(new Error('The specified input does not support audio.'), { code: 604 })
      }
      switch (req) {
        case 'GetSceneList':
          return { scenes: [...scenes.keys()].map((sceneName) => ({ sceneName })) }
        case 'CreateScene':
          scenes.set(data!.sceneName as string, [])
          return {}
        case 'GetSceneItemList':
          return { sceneItems: sceneOf(data!.sceneName).map((it, sceneItemIndex) => ({ ...it, sceneItemIndex })) }
        case 'GetInputList':
          return { inputs: [...inputs.keys()].map((inputName) => ({ inputName })) }
        case 'GetInputSettings': {
          const i = inputs.get(data!.inputName as string)
          if (!i) throw new CodedError(600, 'No source was found by the name of `x`.')
          return { inputKind: i.inputKind, inputSettings: i.inputSettings }
        }
        case 'CreateInput': {
          const name = data!.inputName as string
          if (linger > 0) {
            linger--
            throw new CodedError(601, 'A source already exists by that input name.')
          }
          inputs.set(name, { inputKind: data!.inputKind as string, inputSettings: (data!.inputSettings ?? {}) as Record<string, unknown> })
          return { sceneItemId: addItem(data!.sceneName, name, data!.sceneItemEnabled) }
        }
        case 'CreateSceneItem':
          return { sceneItemId: addItem(data!.sceneName, data!.sourceName as string, data!.sceneItemEnabled) }
        case 'RemoveInput': {
          const name = data!.inputName as string
          inputs.delete(name)
          for (const [k, items] of scenes) scenes.set(k, items.filter((it) => it.sourceName !== name))
          linger = opts.lingerAfterRemove ?? 0
          return {}
        }
        case 'GetSceneItemId': {
          const it = sceneOf(data!.sceneName).find((x) => x.sourceName === data!.sourceName)
          if (!it) throw new CodedError(600, 'No scene items were found.')
          return { sceneItemId: it.sceneItemId }
        }
        case 'SetSceneItemIndex': {
          const items = sceneOf(data!.sceneName)
          const at = items.findIndex((x) => x.sceneItemId === data!.sceneItemId)
          const [it] = items.splice(at, 1)
          items.splice(data!.sceneItemIndex as number, 0, it)
          return {}
        }
        case 'SetSceneItemEnabled': {
          const it = sceneOf(data!.sceneName).find((x) => x.sceneItemId === data!.sceneItemId)
          if (it) it.sceneItemEnabled = data!.sceneItemEnabled as boolean
          return {}
        }
        case 'GetInputPropertiesListPropertyItems':
          return { propertyItems: opts.items ?? [] }
        case 'GetSourceScreenshot':
          return { imageData: 'data:image/jpeg;base64,AAAA' }
        case 'StartStream':
          if (opts.failStart) throw new Error('boom')
          active = true
          return {}
        case 'StopStream':
          if (opts.stopError) throw opts.stopError
          // Like obs-websocket: 501 OutputNotRunning when no stream output exists
          if (!active && !starting) throw new CodedError(501, 'The output is not running.')
          active = false
          starting = false
          return {}
        case 'GetStreamStatus':
          return { outputActive: active }
        case 'StopRecord':
          if (opts.recordStopError) throw opts.recordStopError
          return { outputPath: '/rec/Réunion 2026-11-13 10-00-00.mkv' }
        default:
          return {}
      }
    },
    on(evt, cb) {
      if (!handlers.has(evt)) handlers.set(evt, new Set())
      handlers.get(evt)!.add(cb)
    },
    off(evt, cb) {
      handlers.get(evt)?.delete(cb)
    },
    async disconnect() {}
  }
  const emit = (evt: string, d: unknown) => handlers.get(evt)?.forEach((h) => h(d))
  const setStarting = (v: boolean): void => {
    starting = v
  }
  /** Source names of a scene, bottom first. */
  const order = (sceneName: string) => sceneOf(sceneName).map((x) => x.sourceName)
  const item = (sceneName: string, sourceName: string) => sceneOf(sceneName).find((x) => x.sourceName === sourceName)
  return { client, calls, emit, handlers, setStarting, inputs, order, item }
}
const of = (calls: Call[], req: string) => calls.filter((c) => c.req === req)

describe('ObsController', () => {
  it('ensureScene twice creates inputs once, plus the pause scene', async () => {
    const f = fakeClient()
    const c = new ObsController(f.client)
    await c.ensureScene('darwin')
    await c.ensureScene('darwin')
    const created = of(f.calls, 'CreateInput').map((x) => x.data!.inputName)
    expect(created).toEqual([SRC_VIDEO, SRC_OVERLAY, SRC_AUDIO, SRC_DEVICES])
    expect(of(f.calls, 'CreateScene').map((x) => x.data!.sceneName)).toEqual([SCENE, SCENE_PAUSE])
  })

  it('uses the platform specific input kinds', async () => {
    const d = fakeClient()
    await new ObsController(d.client).ensureScene('darwin')
    expect(of(d.calls, 'CreateInput').map((x) => x.data!.inputKind)).toEqual(['macos-avcapture', 'browser_source', 'coreaudio_input_capture', 'macos-avcapture'])
    const l = fakeClient()
    await new ObsController(l.client).ensureScene('linux')
    expect(of(l.calls, 'CreateInput').map((x) => x.data!.inputKind)).toEqual(['v4l2_input', 'browser_source', 'pulse_input_capture', 'v4l2_input'])
  })

  it('puts only Micro on audio track 1 and mutes the others', async () => {
    const f = fakeClient()
    await new ObsController(f.client).ensureScene('darwin')
    const tracks = Object.fromEntries(of(f.calls, 'SetInputAudioTracks').map((x) => [x.data!.inputName, x.data!.inputAudioTracks]))
    expect(tracks[SRC_AUDIO]).toEqual({ '1': true, '2': false, '3': false, '4': false, '5': false, '6': false })
    for (const n of [SRC_VIDEO, SRC_OVERLAY]) expect(Object.values(tracks[n] as object).every((v) => v === false)).toBe(true)
    const muted = of(f.calls, 'SetInputMute').filter((x) => x.data!.inputMuted === true).map((x) => x.data!.inputName)
    expect(muted).toEqual(expect.arrayContaining([SRC_VIDEO, SRC_OVERLAY]))
    expect(muted).not.toContain(SRC_AUDIO)
  })

  it('a video input without audio (Linux v4l2) does not stop the scene setup', async () => {
    const f = fakeClient({ noAudio: [SRC_VIDEO] })
    await new ObsController(f.client).ensureScene('linux')
    const tracks = of(f.calls, 'SetInputAudioTracks').map((x) => x.data!.inputName)
    expect(tracks).toEqual(expect.arrayContaining([SRC_OVERLAY, SRC_AUDIO]))
    expect(of(f.calls, 'SetInputMute').map((x) => x.data!.inputName)).toContain(SRC_OVERLAY)
  })

  it('other audio setup errors still fail the scene setup', async () => {
    const f = fakeClient({ noAudio: [SRC_AUDIO] })
    await expect(new ObsController(f.client).ensureScene('linux')).rejects.toThrow('does not support audio')
  })

  it('setOverlayUrl sends exact browser settings and mutes', async () => {
    const f = fakeClient()
    const c = new ObsController(f.client)
    await c.setOverlayUrl('http://127.0.0.1:1234/overlay')
    expect(of(f.calls, 'SetInputSettings')[0].data).toEqual({
      inputName: SRC_OVERLAY,
      inputSettings: { url: 'http://127.0.0.1:1234/overlay', width: 1920, height: 1080, fps: 30, fps_custom: true, reroute_audio: true, shutdown: false }
    })
    expect(of(f.calls, 'SetInputMute').at(-1)!.data).toEqual({ inputName: SRC_OVERLAY, inputMuted: true })
  })

  it('listVideoDevices maps items and drops disabled ones', async () => {
    const f = fakeClient({
      items: [
        { itemName: 'Cam A', itemValue: 'a', itemEnabled: true },
        { itemName: 'Cam B', itemValue: 'b', itemEnabled: false },
        { itemName: 'Cam C', itemValue: 'c' }
      ]
    })
    const c = new ObsController(f.client)
    await c.ensureScene('darwin')
    expect(await c.listVideoDevices()).toEqual([{ name: 'Cam A', id: 'a' }, { name: 'Cam C', id: 'c' }])
    expect(of(f.calls, 'GetInputPropertiesListPropertyItems')[0].data).toEqual({ inputName: SRC_DEVICES, propertyName: 'device' })
  })

  it('drops OBS\'s blank placeholder item (empty value), which would show as an empty slot', async () => {
    const f = fakeClient({
      items: [
        { itemName: '', itemValue: '' },
        { itemName: 'Cam A', itemValue: 'a' },
        { itemName: ' ', itemValue: null }
      ]
    })
    const c = new ObsController(f.client)
    await c.ensureScene('darwin')
    expect(await c.listVideoDevices()).toEqual([{ name: 'Cam A', id: 'a' }])
  })

  it('uses device_id on linux and for audio', async () => {
    const f = fakeClient()
    const c = new ObsController(f.client)
    await c.ensureScene('linux')
    await c.listVideoDevices()
    await c.listAudioDevices()
    const p = of(f.calls, 'GetInputPropertiesListPropertyItems').map((x) => x.data)
    expect(p).toEqual([
      { inputName: SRC_DEVICES, propertyName: 'device_id' },
      { inputName: SRC_AUDIO, propertyName: 'device_id' }
    ])
  })

  it('setAudioDevice sets device_id', async () => {
    const f = fakeClient()
    const c = new ObsController(f.client)
    await c.setAudioDevice('mic1')
    expect(of(f.calls, 'SetInputSettings')[0].data).toMatchObject({ inputName: SRC_AUDIO, inputSettings: { device_id: 'mic1' } })
  })

  it('setAudioMonitor monitors Micro while still sending it out, or stops monitoring', async () => {
    const f = fakeClient()
    const c = new ObsController(f.client)
    await c.setAudioMonitor(true)
    await c.setAudioMonitor(false)
    expect(of(f.calls, 'SetInputAudioMonitorType').map((x) => x.data)).toEqual([
      { inputName: SRC_AUDIO, monitorType: 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT' },
      { inputName: SRC_AUDIO, monitorType: 'OBS_MONITORING_TYPE_NONE' }
    ])
  })

  it('audioLevel$ reports dB for Micro and unsubscribes', () => {
    const f = fakeClient()
    const c = new ObsController(f.client)
    const got: number[] = []
    const off = c.audioLevel$((db) => got.push(db))
    f.emit('InputVolumeMeters', {
      inputs: [
        { inputName: 'Other', inputLevelsMul: [[1, 1, 1]] },
        { inputName: SRC_AUDIO, inputLevelsMul: [[0.05, 0.1, 0.1], [0.05, 0.01, 0.1]] }
      ]
    })
    expect(got[0]).toBeCloseTo(-20, 1)
    f.emit('InputVolumeMeters', { inputs: [{ inputName: SRC_AUDIO, inputLevelsMul: [[0, 0, 0]] }] })
    expect(got[1]).toBeLessThanOrEqual(-100)
    off()
    f.emit('InputVolumeMeters', { inputs: [{ inputName: SRC_AUDIO, inputLevelsMul: [[1, 1, 1]] }] })
    expect(got).toHaveLength(2)
  })

  it('screenshot requests a scaled jpg of the scene', async () => {
    const f = fakeClient()
    const url = await new ObsController(f.client).screenshot()
    expect(url).toBe('data:image/jpeg;base64,AAAA')
    expect(of(f.calls, 'GetSourceScreenshot')[0].data).toEqual({ sourceName: SCENE, imageFormat: 'jpg', imageWidth: 640, imageCompressionQuality: 70 })
  })

  describe('streaming', () => {
    const svc = { streamServiceType: 'rtmp_custom' as const, streamServiceSettings: { server: 'srt://h:9000?streamid=a', key: '' } }

    it('startStream sets service then starts; second identical call is a no-op', async () => {
      const f = fakeClient()
      const c = new ObsController(f.client)
      await c.startStream(svc)
      await c.startStream(svc)
      expect(of(f.calls, 'StartStream')).toHaveLength(1)
      expect(of(f.calls, 'SetStreamServiceSettings')[0].data).toEqual(svc)
      const order = f.calls.map((x) => x.req)
      expect(order.indexOf('SetStreamServiceSettings')).toBeLessThan(order.indexOf('StartStream'))
    })

    it('startStream with a different server while active restarts', async () => {
      const f = fakeClient()
      const c = new ObsController(f.client)
      await c.startStream(svc)
      await c.startStream({ ...svc, streamServiceSettings: { server: 'srt://other', key: '' } })
      expect(of(f.calls, 'StopStream')).toHaveLength(1)
      expect(of(f.calls, 'StartStream')).toHaveLength(2)
    })

    it('stopStream reports whether a stop was sent; nothing running is not an error', async () => {
      const f = fakeClient()
      const c = new ObsController(f.client)
      expect(await c.stopStream()).toBe(false)
      await c.startStream(svc)
      expect(await c.stopStream()).toBe(true)
      expect(of(f.calls, 'StopStream')).toHaveLength(2)
    })

    it('stopStream sends StopStream while the stream is still connecting (not yet active)', async () => {
      const f = fakeClient()
      const c = new ObsController(f.client)
      f.setStarting(true) // GetStreamStatus says outputActive: false during the SRT connect
      expect(await c.stopStream()).toBe(true)
      expect(of(f.calls, 'StopStream')).toHaveLength(1)
    })

    it('stopStream rethrows other errors', async () => {
      const f = fakeClient({ stopError: new CodedError(207, 'Not ready') })
      const c = new ObsController(f.client)
      await expect(c.stopStream()).rejects.toThrow('Not ready')
    })

    it('streamState$ maps events, reports error on failed start, unsubscribes', async () => {
      const f = fakeClient({ failStart: true })
      const c = new ObsController(f.client)
      const got: string[] = []
      const off = c.streamState$((s) => got.push(s))
      for (const st of ['STARTING', 'STARTED', 'RECONNECTING', 'RECONNECTED', 'STOPPING', 'STOPPED'])
        f.emit('StreamStateChanged', { outputActive: true, outputState: `OBS_WEBSOCKET_OUTPUT_${st}` })
      expect(got).toEqual(['starting', 'active', 'starting', 'active', 'stopped'])
      await expect(c.startStream(svc)).rejects.toThrow('boom')
      expect(got.at(-1)).toBe('error')
      off()
      f.emit('StreamStateChanged', { outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' })
      expect(got).toHaveLength(6)
    })
  })
})

describe('ObsController output', () => {
  it('openOutputWindow opens a windowed program projector (no monitor, no geometry), every call', async () => {
    const f = fakeClient()
    const c = new ObsController(f.client)
    await c.openOutputWindow()
    await c.openOutputWindow()
    const calls = of(f.calls, 'OpenVideoMixProjector')
    expect(calls).toHaveLength(2)
    expect(calls[0].data).toEqual({ videoMixType: 'OBS_WEBSOCKET_VIDEO_MIX_TYPE_PROGRAM' })
  })
  it('showLive / showPause switch program scene', async () => {
    const f = fakeClient()
    const c = new ObsController(f.client)
    await c.showLive()
    await c.showPause()
    expect(of(f.calls, 'SetCurrentProgramScene').map((x) => x.data)).toEqual([{ sceneName: SCENE }, { sceneName: SCENE_PAUSE }])
  })
})

describe('ObsController sources', () => {
  const T = { boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsWidth: 1920, boundsHeight: 1080 }

  it('ensureScene adds a hidden camera-detection input to the pause scene, not the live one', async () => {
    const f = fakeClient()
    await new ObsController(f.client).ensureScene('darwin')
    expect(f.item(SCENE_PAUSE, SRC_DEVICES)).toMatchObject({ sceneItemEnabled: false })
    expect(f.order(SCENE)).not.toContain(SRC_DEVICES)
    expect(f.order(SCENE)).not.toContain(SRC_BACKUP)
    const muted = of(f.calls, 'SetInputMute').map((x) => x.data!.inputName)
    expect(muted).toContain(SRC_DEVICES)
  })

  it('setSource image replaces a device input', async () => {
    const f = fakeClient()
    const c = new ObsController(f.client)
    await c.ensureScene('darwin')
    await c.setSource('primary', { kind: 'image', path: '/a.png' })
    const reqs = f.calls.map((x) => x.req)
    const remove = f.calls.findIndex((x) => x.req === 'RemoveInput' && x.data!.inputName === SRC_VIDEO)
    expect(remove).toBeGreaterThan(-1)
    const create = f.calls.findIndex((x, i) => i > remove && x.req === 'CreateInput')
    expect(f.calls[create].data).toMatchObject({
      sceneName: SCENE, inputName: SRC_VIDEO, inputKind: 'image_source', inputSettings: { file: '/a.png' }, sceneItemEnabled: true
    })
    expect(reqs).toContain('SetSceneItemTransform')
    expect(of(f.calls, 'SetSceneItemTransform').at(-1)!.data).toMatchObject({
      sceneName: SCENE, sceneItemId: f.item(SCENE, SRC_VIDEO)!.sceneItemId, sceneItemTransform: T
    })
    // primary at the bottom, subtitles on top
    expect(f.order(SCENE)[0]).toBe(SRC_VIDEO)
    expect(f.order(SCENE).indexOf(SRC_OVERLAY)).toBe(f.order(SCENE).length - 1)
  })

  it('setSource keeps the input when the kind is the same', async () => {
    const f = fakeClient()
    const c = new ObsController(f.client)
    await c.ensureScene('darwin')
    const n = f.calls.length
    await c.setSource('primary', { kind: 'device', id: 'cam1' })
    const after = f.calls.slice(n)
    expect(after.filter((x) => x.req === 'RemoveInput' || x.req === 'CreateInput')).toEqual([])
    expect(after.filter((x) => x.req === 'SetInputSettings').map((x) => x.data)).toEqual([
      { inputName: SRC_VIDEO, inputSettings: { device: 'cam1' } }
    ])
    expect(of(after, 'SetSceneItemTransform').at(-1)!.data).toMatchObject({ sceneName: SCENE, sceneItemTransform: T })
  })

  it('setSource none empties the device (linux: device_id)', async () => {
    const f = fakeClient()
    const c = new ObsController(f.client)
    await c.ensureScene('linux')
    await c.setSource('primary', { kind: 'none' })
    expect(of(f.calls, 'SetInputSettings').at(-1)!.data).toEqual({ inputName: SRC_VIDEO, inputSettings: { device_id: '' } })
    expect(of(f.calls, 'RemoveInput')).toEqual([])
  })

  it('setSource video goes back to a device input', async () => {
    const f = fakeClient()
    const c = new ObsController(f.client)
    await c.ensureScene('darwin')
    await c.setSource('primary', { kind: 'video', path: '/v.mp4' })
    await c.setSource('primary', { kind: 'device', id: 'cam1' })
    expect(f.inputs.get(SRC_VIDEO)).toEqual({ inputKind: 'macos-avcapture', inputSettings: { device: 'cam1' } })
    expect(f.order(SCENE)[0]).toBe(SRC_VIDEO)
  })

  it('backup is created hidden and above the primary', async () => {
    const f = fakeClient()
    const c = new ObsController(f.client)
    await c.ensureScene('darwin')
    await c.setSource('backup', { kind: 'video', path: '/b.mp4' })
    expect(of(f.calls, 'CreateInput').at(-1)!.data).toEqual({
      sceneName: SCENE,
      inputName: SRC_BACKUP,
      inputKind: 'ffmpeg_source',
      inputSettings: { local_file: '/b.mp4', is_local_file: true, looping: true, restart_on_activate: false },
      sceneItemEnabled: false
    })
    const idx = Object.fromEntries(
      of(f.calls, 'SetSceneItemIndex').map((x) => [x.data!.sceneItemId, x.data!.sceneItemIndex as number])
    )
    const id = (n: string) => f.item(SCENE, n)!.sceneItemId
    expect(idx[id(SRC_BACKUP)]).toBeGreaterThan(idx[id(SRC_VIDEO)])
    expect(idx[id(SRC_OVERLAY)]).toBeGreaterThan(idx[id(SRC_BACKUP)])
    const o = f.order(SCENE)
    expect(o.indexOf(SRC_VIDEO)).toBeLessThan(o.indexOf(SRC_BACKUP))
    expect(o.indexOf(SRC_BACKUP)).toBeLessThan(o.indexOf(SRC_OVERLAY))
    expect(o.indexOf(SRC_OVERLAY)).toBe(o.length - 1)
    // sound off: muted, on no track
    expect(of(f.calls, 'SetInputMute').at(-1)!.data).toEqual({ inputName: SRC_BACKUP, inputMuted: true })
    expect(of(f.calls, 'SetInputAudioTracks').at(-1)!.data).toMatchObject({ inputName: SRC_BACKUP })
    expect(of(f.calls, 'SetSceneItemTransform').at(-1)!.data).toMatchObject({ sceneItemId: id(SRC_BACKUP), sceneItemTransform: T })
    expect(f.item(SCENE, SRC_BACKUP)!.sceneItemEnabled).toBe(false)
  })

  it('setBackupVisible toggles the backup scene item', async () => {
    const f = fakeClient()
    const c = new ObsController(f.client)
    await c.ensureScene('darwin')
    await c.setSource('backup', { kind: 'image', path: '/b.png' })
    await c.setBackupVisible(true)
    expect(of(f.calls, 'SetSceneItemEnabled').at(-1)!.data).toEqual({
      sceneName: SCENE, sceneItemId: f.item(SCENE, SRC_BACKUP)!.sceneItemId, sceneItemEnabled: true
    })
    expect(f.item(SCENE, SRC_BACKUP)!.sceneItemEnabled).toBe(true)
    await c.setBackupVisible(false)
    expect(f.item(SCENE, SRC_BACKUP)!.sceneItemEnabled).toBe(false)
  })

  it('setBackupVisible before any backup exists is remembered, not an error', async () => {
    const f = fakeClient()
    const c = new ObsController(f.client)
    await c.ensureScene('darwin')
    await expect(c.setBackupVisible(true)).resolves.toBeUndefined()
    expect(of(f.calls, 'SetSceneItemEnabled')).toEqual([])
    await c.setSource('backup', { kind: 'image', path: '/b.png' })
    expect(f.item(SCENE, SRC_BACKUP)!.sceneItemEnabled).toBe(true)
  })

  it('a backup recreated while shown stays shown', async () => {
    const f = fakeClient()
    const c = new ObsController(f.client)
    await c.ensureScene('darwin')
    await c.setSource('backup', { kind: 'image', path: '/b.png' })
    await c.setBackupVisible(true)
    await c.setSource('backup', { kind: 'video', path: '/b.mp4' })
    expect(f.item(SCENE, SRC_BACKUP)!.sceneItemEnabled).toBe(true)
  })

  it('resetProjectorState forgets cached scene item ids', async () => {
    const f = fakeClient()
    const c = new ObsController(f.client)
    await c.ensureScene('darwin')
    await c.setSource('backup', { kind: 'image', path: '/b.png' })
    await c.setBackupVisible(true)
    c.resetProjectorState()
    const n = of(f.calls, 'GetSceneItemId').length
    await c.setBackupVisible(true)
    expect(of(f.calls, 'GetSceneItemId').slice(n).map((x) => x.data)).toEqual([{ sceneName: SCENE, sourceName: SRC_BACKUP }])
  })

  it('retries creating the input while OBS still holds the removed name', async () => {
    const f = fakeClient({ lingerAfterRemove: 2 })
    const c = new ObsController(f.client)
    await c.ensureScene('darwin')
    await c.setSource('primary', { kind: 'image', path: '/a.png' })
    expect(f.inputs.get(SRC_VIDEO)?.inputKind).toBe('image_source')
    expect(of(f.calls, 'CreateInput').filter((x) => x.data!.inputName === SRC_VIDEO)).toHaveLength(4) // ensureScene + 2 failed + 1
  })

  it('probePrimary takes a tiny png of the primary input alone', async () => {
    const f = fakeClient()
    const img = await new ObsController(f.client).probePrimary()
    expect(img).toBe('data:image/jpeg;base64,AAAA')
    expect(of(f.calls, 'GetSourceScreenshot')[0].data).toEqual({ sourceName: SRC_VIDEO, imageFormat: 'png', imageWidth: 32 })
  })
})

describe('ObsController recording', () => {
  const ffmpegStart = (url: string, name: string, mime: string) => [
    { req: 'SetProfileParameter', data: { parameterCategory: 'AdvOut', parameterName: 'FFURL', parameterValue: url } },
    { req: 'SetProfileParameter', data: { parameterCategory: 'AdvOut', parameterName: 'FFFormat', parameterValue: name } },
    { req: 'SetProfileParameter', data: { parameterCategory: 'AdvOut', parameterName: 'FFFormatMimeType', parameterValue: mime } },
    { req: 'SetOutputSettings', data: { outputName: FFMPEG_OUTPUT, outputSettings: { url, format_name: name, format_mime_type: mime } } },
    { req: 'StartRecord', data: undefined }
  ]

  it('startRecord points the FFmpeg output at `<dir>/<name> <date time>.mkv` (profile and output), then starts', async () => {
    const f = fakeClient()
    await new ObsController(f.client).startRecord('/rec', 'Réunion', new Date(2026, 10, 3, 9, 5, 7))
    expect(f.calls).toEqual(ffmpegStart('/rec/Réunion 2026-11-03 09-05-07.mkv', 'matroska', 'video/x-matroska'))
  })

  it('startBroadcast points the FFmpeg output at the local relay in FLV, then starts', async () => {
    const f = fakeClient()
    await new ObsController(f.client).startBroadcast('unix:/tmp/l/obs.sock')
    expect(f.calls).toEqual(ffmpegStart('unix:/tmp/l/obs.sock', 'flv', 'video/x-flv'))
  })

  it('fileStamp: local date and time, zero-padded', () => {
    expect(fileStamp(new Date(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02 03-04-05')
  })

  it('stopRecord returns the path', async () => {
    const f = fakeClient()
    expect(await new ObsController(f.client).stopRecord()).toBe('/rec/Réunion 2026-11-13 10-00-00.mkv')
  })

  it('stopRecord returns null when not running, rethrows other errors', async () => {
    const off = fakeClient({ recordStopError: new CodedError(501, 'The output is not running.') })
    expect(await new ObsController(off.client).stopRecord()).toBeNull()
    const boom = fakeClient({ recordStopError: new Error('boom') })
    await expect(new ObsController(boom.client).stopRecord()).rejects.toThrow('boom')
  })

  it('recordState$ reports only STARTED and STOPPED, and unsubscribes', () => {
    const f = fakeClient()
    const seen: unknown[] = []
    const off = new ObsController(f.client).recordState$((s) => seen.push(s))
    f.emit('RecordStateChanged', { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTING' })
    f.emit('RecordStateChanged', { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED', outputPath: '/rec/a.mkv' })
    f.emit('RecordStateChanged', { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPING' })
    f.emit('RecordStateChanged', { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED', outputPath: '/rec/a.mkv' })
    off()
    f.emit('RecordStateChanged', { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' })
    expect(seen).toEqual([{ active: true }, { active: false, path: '/rec/a.mkv' }])
  })

  it('recordBaseName makes a safe file name', () => {
    expect(recordBaseName('A/B: C?')).toBe('A-B- C-')
    expect(recordBaseName('100% \\ "x" <y>|z\u0001')).toBe('100- - -x- -y--z-')
    expect(recordBaseName('  Réunion  ')).toBe('Réunion')
    expect(recordBaseName('')).toBe('LinTO Live')
    expect(recordBaseName('   ')).toBe('LinTO Live')
    expect(recordBaseName('é'.repeat(150))).toHaveLength(100)
    // Cut to 100 first, then trimmed: no trailing space left by the cut.
    expect(recordBaseName('a'.repeat(99) + '  b')).toBe('a'.repeat(99))
  })
})
