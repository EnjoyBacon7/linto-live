import { describe, expect, it } from 'vitest'
import { ObsController, SCENE, SCENE_PAUSE, SRC_AUDIO, SRC_OVERLAY, SRC_VIDEO, type ObsClient } from '../../src/main/obs/controller'

type Call = { req: string; data?: Record<string, unknown> }

function fakeClient(opts: { items?: unknown[] } = {}) {
  const calls: Call[] = []
  const scenes = new Set<string>()
  const inputs = new Set<string>()
  const handlers = new Map<string, Set<(d: unknown) => void>>()
  const client: ObsClient = {
    async call(req, data) {
      calls.push({ req, data })
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
  return { client, calls, emit, handlers }
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
})
