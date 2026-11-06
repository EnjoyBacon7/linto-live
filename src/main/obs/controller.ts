import { EventSubscription, OBSWebSocket } from 'obs-websocket-js'
import type { ObsConnection } from './process'
import type { ObsStreamService } from './streamTarget'
import type { DeviceItem } from '../../shared/types'

export type StreamState = 'starting' | 'active' | 'stopped' | 'error'

export type { DeviceItem }

export const SCENE = 'LinTO Live'
export const SCENE_PAUSE = 'LinTO Pause'
export const SRC_VIDEO = 'Salle'
export const SRC_AUDIO = 'Micro'
export const SRC_OVERLAY = 'Sous-titres'

/** Minimal slice of OBSWebSocket the controller needs (lets tests inject a fake). */
export interface ObsClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call(req: string, data?: Record<string, unknown>): Promise<any>
  on(evt: string, cb: (d: any) => void): unknown // eslint-disable-line @typescript-eslint/no-explicit-any
  off(evt: string, cb: (d: any) => void): unknown // eslint-disable-line @typescript-eslint/no-explicit-any
  disconnect(): Promise<unknown>
}

const MIN_DB = -100
const TRACKS_NONE = { '1': false, '2': false, '3': false, '4': false, '5': false, '6': false }

const videoKind = (p: NodeJS.Platform): string => (p === 'darwin' ? 'macos-avcapture' : 'v4l2_input')
const audioKind = (p: NodeJS.Platform): string => (p === 'darwin' ? 'coreaudio_input_capture' : 'pulse_input_capture')
const videoProp = (p: NodeJS.Platform): string => (p === 'darwin' ? 'device' : 'device_id')

export class ObsController {
  private platform: NodeJS.Platform = process.platform
  private videoItemId: number | null = null
  private lastServer: string | null = null
  private stateListeners = new Set<(s: StreamState) => void>()

  constructor(private readonly client: ObsClient) {}

  static async connect(c: ObsConnection): Promise<ObsController> {
    const ws = new OBSWebSocket()
    await ws.connect(`ws://127.0.0.1:${c.port}`, c.password, {
      eventSubscriptions: EventSubscription.All | EventSubscription.InputVolumeMeters,
      rpcVersion: 1
    })
    return new ObsController(ws as unknown as ObsClient)
  }

  async ensureScene(platform: NodeJS.Platform): Promise<void> {
    this.platform = platform
    const { scenes } = await this.client.call('GetSceneList')
    const have = new Set<string>((scenes as { sceneName: string }[]).map((s) => s.sceneName))
    for (const name of [SCENE, SCENE_PAUSE]) {
      if (!have.has(name)) await this.client.call('CreateScene', { sceneName: name })
    }
    const { inputs } = await this.client.call('GetInputList')
    const existing = new Set<string>((inputs as { inputName: string }[]).map((i) => i.inputName))
    const { sceneItems } = await this.client.call('GetSceneItemList', { sceneName: SCENE })
    const inScene = new Set<string>((sceneItems as { sourceName: string }[]).map((i) => i.sourceName))

    const wanted: [string, string, Record<string, unknown>][] = [
      [SRC_VIDEO, videoKind(platform), {}],
      [SRC_OVERLAY, 'browser_source', {}],
      [SRC_AUDIO, audioKind(platform), {}]
    ]
    for (const [inputName, inputKind, inputSettings] of wanted) {
      if (!existing.has(inputName)) {
        await this.client.call('CreateInput', { sceneName: SCENE, inputName, inputKind, inputSettings, sceneItemEnabled: true })
      } else if (!inScene.has(inputName)) {
        await this.client.call('CreateSceneItem', { sceneName: SCENE, sourceName: inputName, sceneItemEnabled: true })
      }
    }
    for (const name of [SRC_VIDEO, SRC_OVERLAY, SRC_AUDIO]) {
      const isAudio = name === SRC_AUDIO
      await this.client.call('SetInputAudioTracks', {
        inputName: name,
        inputAudioTracks: isAudio ? { ...TRACKS_NONE, '1': true } : { ...TRACKS_NONE }
      })
      if (!isAudio) await this.client.call('SetInputMute', { inputName: name, inputMuted: true })
    }
  }

  private async devices(inputName: string, propertyName: string): Promise<DeviceItem[]> {
    const { propertyItems } = await this.client.call('GetInputPropertiesListPropertyItems', { inputName, propertyName })
    return (propertyItems as { itemName: string; itemValue: unknown; itemEnabled?: boolean }[])
      .filter((i) => i.itemEnabled !== false)
      .map((i) => ({ name: i.itemName, id: String(i.itemValue) }))
  }

  listVideoDevices(): Promise<DeviceItem[]> {
    return this.devices(SRC_VIDEO, videoProp(this.platform))
  }

  listAudioDevices(): Promise<DeviceItem[]> {
    return this.devices(SRC_AUDIO, 'device_id')
  }

  async setVideoDevice(id: string): Promise<void> {
    await this.client.call('SetInputSettings', { inputName: SRC_VIDEO, inputSettings: { [videoProp(this.platform)]: id } })
    if (this.videoItemId === null) {
      const r = await this.client.call('GetSceneItemId', { sceneName: SCENE, sourceName: SRC_VIDEO })
      this.videoItemId = r.sceneItemId as number
    }
    await this.client.call('SetSceneItemTransform', {
      sceneName: SCENE,
      sceneItemId: this.videoItemId,
      sceneItemTransform: {
        positionX: 0,
        positionY: 0,
        boundsType: 'OBS_BOUNDS_SCALE_INNER',
        boundsAlignment: 0,
        boundsWidth: 1920,
        boundsHeight: 1080
      }
    })
  }

  async setAudioDevice(id: string): Promise<void> {
    await this.client.call('SetInputSettings', { inputName: SRC_AUDIO, inputSettings: { device_id: id } })
  }

  async setOverlayUrl(url: string): Promise<void> {
    await this.client.call('SetInputSettings', {
      inputName: SRC_OVERLAY,
      inputSettings: { url, width: 1920, height: 1080, fps: 30, fps_custom: true, reroute_audio: true, shutdown: false }
    })
    await this.client.call('SetInputMute', { inputName: SRC_OVERLAY, inputMuted: true })
  }

  audioLevel$(cb: (db: number) => void): () => void {
    const handler = (d: { inputs: { inputName: string; inputLevelsMul: number[][] }[] }): void => {
      const mic = d.inputs.find((i) => i.inputName === SRC_AUDIO)
      if (!mic) return
      const peak = Math.max(0, ...mic.inputLevelsMul.map((ch) => ch[1] ?? 0))
      cb(peak > 0 ? Math.max(MIN_DB, 20 * Math.log10(peak)) : MIN_DB)
    }
    this.client.on('InputVolumeMeters', handler)
    return () => {
      this.client.off('InputVolumeMeters', handler)
    }
  }

  async screenshot(): Promise<string> {
    const r = await this.client.call('GetSourceScreenshot', {
      sourceName: SCENE,
      imageFormat: 'jpg',
      imageWidth: 640,
      imageCompressionQuality: 70
    })
    return r.imageData as string
  }

  private async streamActive(): Promise<boolean> {
    const r = await this.client.call('GetStreamStatus')
    return Boolean(r?.outputActive)
  }

  async startStream(s: ObsStreamService): Promise<void> {
    const server = s.streamServiceSettings.server
    const key = s.streamServiceSettings.key
    const id = `${server}\n${key}`
    try {
      if (await this.streamActive()) {
        if (this.lastServer === id) return
        await this.client.call('StopStream')
      }
      await this.client.call('SetStreamServiceSettings', s as unknown as Record<string, unknown>)
      await this.client.call('StartStream')
      this.lastServer = id
    } catch (e) {
      this.stateListeners.forEach((cb) => cb('error'))
      throw e
    }
  }

  async stopStream(): Promise<void> {
    if (await this.streamActive()) await this.client.call('StopStream')
    this.lastServer = null
  }

  streamState$(cb: (s: StreamState) => void): () => void {
    const handler = (d: { outputState?: string }): void => {
      switch (d.outputState) {
        case 'OBS_WEBSOCKET_OUTPUT_STARTING':
        case 'OBS_WEBSOCKET_OUTPUT_RECONNECTING':
          return cb('starting')
        case 'OBS_WEBSOCKET_OUTPUT_STARTED':
        case 'OBS_WEBSOCKET_OUTPUT_RECONNECTED':
          return cb('active')
        case 'OBS_WEBSOCKET_OUTPUT_STOPPED':
          return cb('stopped')
      }
    }
    this.client.on('StreamStateChanged', handler)
    this.stateListeners.add(cb)
    return () => {
      this.client.off('StreamStateChanged', handler)
      this.stateListeners.delete(cb)
    }
  }

  /** Called by LiveController after an OBS restart: forget cached scene item ids. */
  resetProjectorState(): void {
    this.videoItemId = null
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect()
  }
}
