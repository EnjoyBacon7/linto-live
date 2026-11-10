import { describe, expect, it } from 'vitest'
import { ObsController, SCENE, SCENE_PAUSE, SRC_AUDIO, SRC_OVERLAY, SRC_VIDEO, type ObsClient } from '../../src/main/obs/controller'

type Call = { req: string; data?: Record<string, unknown> }

class CodedError extends Error {
  constructor(public code: number, message: string) {
    super(message)
  }
}

function fakeClient(opts: { items?: unknown[]; failStart?: boolean; stopError?: Error; noAudio?: string[] } = {}) {
  let active = false
  let starting = false
  const calls: Call[] = []
  const scenes = new Set<string>()
  const inputs = new Set<string>()
  const handlers = new Map<string, Set<(d: unknown) => void>>()
  const client: ObsClient = {
    async call(req, data) {
      calls.push({ req, data })
      // Real obs-websocket: audio requests on an input without audio (Linux v4l2) fail with 604.
      if ((req === 'SetInputAudioTracks' || req === 'SetInputMute') && opts.noAudio?.includes(data!.inputName as string)) {
        throw Object.assign(new Error('The specified input does not support audio.'), { code: 604 })
      }
      switch (req) {
        case 'GetSceneList':
          return { scenes: [...scenes].map((sceneName) => ({ sceneName })) }
        case 'CreateScene':
          scenes.add(data!.sceneName as string)
          return {}
        case 'GetSceneItemList':
          return { sceneItems: [...inputs].map((sourceName) => ({ sourceName })) }
        case 'GetInputList':
          return { inputs: [...inputs].map((inputName) => ({ inputName })) }
        case 'CreateInput':
          inputs.add(data!.inputName as string)
          return { sceneItemId: 7 }
        case 'GetSceneItemId':
          return { sceneItemId: 7 }
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
  return { client, calls, emit, handlers, setStarting }
}
const of = (calls: Call[], req: string) => calls.filter((c) => c.req === req)

describe('ObsController', () => {
  it('ensureScene twice creates inputs once, plus the pause scene', async () => {
    const f = fakeClient()
    const c = new ObsController(f.client)
    await c.ensureScene('darwin')
    await c.ensureScene('darwin')
    const created = of(f.calls, 'CreateInput').map((x) => x.data!.inputName)
    expect(created).toEqual([SRC_VIDEO, SRC_OVERLAY, SRC_AUDIO])
    expect(of(f.calls, 'CreateScene').map((x) => x.data!.sceneName)).toEqual([SCENE, SCENE_PAUSE])
  })

  it('uses the platform specific input kinds', async () => {
    const d = fakeClient()
    await new ObsController(d.client).ensureScene('darwin')
    expect(of(d.calls, 'CreateInput').map((x) => x.data!.inputKind)).toEqual(['macos-avcapture', 'browser_source', 'coreaudio_input_capture'])
    const l = fakeClient()
    await new ObsController(l.client).ensureScene('linux')
    expect(of(l.calls, 'CreateInput').map((x) => x.data!.inputKind)).toEqual(['v4l2_input', 'browser_source', 'pulse_input_capture'])
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
    expect(of(f.calls, 'GetInputPropertiesListPropertyItems')[0].data).toEqual({ inputName: SRC_VIDEO, propertyName: 'device' })
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
      { inputName: SRC_VIDEO, propertyName: 'device_id' },
      { inputName: SRC_AUDIO, propertyName: 'device_id' }
    ])
  })

  it('setVideoDevice sets device and fits transform to 1920x1080', async () => {
    const f = fakeClient()
    const c = new ObsController(f.client)
    await c.ensureScene('darwin')
    await c.setVideoDevice('cam1')
    const s = of(f.calls, 'SetInputSettings').at(-1)!.data as { inputName: string; inputSettings: unknown }
    expect(s).toMatchObject({ inputName: SRC_VIDEO, inputSettings: { device: 'cam1' } })
    expect(of(f.calls, 'SetSceneItemTransform').at(-1)!.data).toMatchObject({
      sceneName: SCENE,
      sceneItemTransform: { boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsWidth: 1920, boundsHeight: 1080 }
    })
  })

  it('setAudioDevice sets device_id', async () => {
    const f = fakeClient()
    const c = new ObsController(f.client)
    await c.setAudioDevice('mic1')
    expect(of(f.calls, 'SetInputSettings')[0].data).toMatchObject({ inputName: SRC_AUDIO, inputSettings: { device_id: 'mic1' } })
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
