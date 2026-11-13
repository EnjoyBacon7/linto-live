import { EventSubscription, OBSWebSocket } from 'obs-websocket-js'
import type { ObsConnection } from './process'
import type { ObsStreamService } from './streamTarget'
import type { DeviceItem, VideoSource } from '../../shared/types'

export type StreamState = 'starting' | 'active' | 'stopped' | 'error'

export type { DeviceItem }

export const SCENE = 'LinTO Live'
export const SCENE_PAUSE = 'LinTO Pause'
export const SRC_VIDEO = 'Salle'
export const SRC_AUDIO = 'Micro'
export const SRC_OVERLAY = 'Sous-titres'
export const SRC_BACKUP = 'Secours'
/** Hidden device input (pause scene) that only serves to list the cameras, whatever the sources are. */
export const SRC_DEVICES = 'Détection caméras'

export type SourceSlot = 'primary' | 'backup'

/** Minimal slice of OBSWebSocket the controller needs (lets tests inject a fake). */
export interface ObsClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call(req: string, data?: Record<string, unknown>): Promise<any>
  on(evt: string, cb: (d: any) => void): unknown // eslint-disable-line @typescript-eslint/no-explicit-any
  off(evt: string, cb: (d: any) => void): unknown // eslint-disable-line @typescript-eslint/no-explicit-any
  disconnect(): Promise<unknown>
}

const MIN_DB = -100
/** obs-websocket RequestStatus::OutputNotRunning. */
const OUTPUT_NOT_RUNNING = 501
const TRACKS_NONE = { '1': false, '2': false, '3': false, '4': false, '5': false, '6': false }

const videoKind = (p: NodeJS.Platform): string => (p === 'darwin' ? 'macos-avcapture' : 'v4l2_input')
const audioKind = (p: NodeJS.Platform): string => (p === 'darwin' ? 'coreaudio_input_capture' : 'pulse_input_capture')
const videoProp = (p: NodeJS.Platform): string => (p === 'darwin' ? 'device' : 'device_id')

/** OBS input kind and settings for a video source ('none' = a device input without device). */
function sourceInput(src: VideoSource, p: NodeJS.Platform): { inputKind: string; inputSettings: Record<string, unknown> } {
  switch (src.kind) {
    case 'image':
      return { inputKind: 'image_source', inputSettings: { file: src.path } }
    case 'video':
      return {
        inputKind: 'ffmpeg_source',
        inputSettings: { local_file: src.path, is_local_file: true, looping: true, restart_on_activate: false }
      }
    case 'device':
      return { inputKind: videoKind(p), inputSettings: { [videoProp(p)]: src.id } }
    default:
      return { inputKind: videoKind(p), inputSettings: { [videoProp(p)]: '' } }
  }
}

/** obs-websocket RequestStatus::ResourceNotFound / ResourceAlreadyExists. */
const RESOURCE_NOT_FOUND = 600
const RESOURCE_ALREADY_EXISTS = 601
/** RemoveInput returns before OBS has released the name: CreateInput is retried meanwhile. */
const CREATE_RETRIES = 5
const CREATE_RETRY_MS = 100
const codeOf = (e: unknown): unknown => (e as { code?: unknown })?.code

/** obs-websocket RequestStatus.InvalidResourceState: what audio requests answer for an input without audio. */
const INVALID_RESOURCE_STATE = 604

function ignoreNoAudio(e: unknown): void {
  if (codeOf(e) === INVALID_RESOURCE_STATE) return
  throw e
}

const TRANSFORM_1080P = {
  positionX: 0,
  positionY: 0,
  boundsType: 'OBS_BOUNDS_SCALE_INNER',
  boundsAlignment: 0,
  boundsWidth: 1920,
  boundsHeight: 1080
}

export class ObsController {
  private platform: NodeJS.Platform = process.platform
  /** Scene item ids in SCENE, by source name (new OBS run = new ids, see resetProjectorState). */
  private itemIds = new Map<string, number>()
  /** Last visibility asked for the backup: kept when the backup input has to be recreated. */
  private backupVisible = false
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
    // Never shown: in the pause scene, disabled, with no device opened.
    if (!existing.has(SRC_DEVICES)) {
      await this.client.call('CreateInput', {
        sceneName: SCENE_PAUSE,
        inputName: SRC_DEVICES,
        inputKind: videoKind(platform),
        inputSettings: { [videoProp(platform)]: '' },
        sceneItemEnabled: false
      })
    }
    await this.client.call('SetInputAudioTracks', { inputName: SRC_AUDIO, inputAudioTracks: { ...TRACKS_NONE, '1': true } })
    for (const name of [SRC_VIDEO, SRC_OVERLAY, SRC_DEVICES]) await this.silence(name)
  }

  private async devices(inputName: string, propertyName: string): Promise<DeviceItem[]> {
    const { propertyItems } = await this.client.call('GetInputPropertiesListPropertyItems', { inputName, propertyName })
    return (propertyItems as { itemName: string; itemValue: unknown; itemEnabled?: boolean }[])
      .filter((i) => i.itemEnabled !== false)
      .map((i) => ({ name: (i.itemName ?? '').trim(), id: i.itemValue == null ? '' : String(i.itemValue) }))
      // OBS lists a blank placeholder item (no value): it would show as an empty slot next to « Aucune ».
      .filter((d) => d.id !== '' && d.name !== '')
  }

  listVideoDevices(): Promise<DeviceItem[]> {
    return this.devices(SRC_DEVICES, videoProp(this.platform))
  }

  listAudioDevices(): Promise<DeviceItem[]> {
    return this.devices(SRC_AUDIO, 'device_id')
  }

  /** Mutes an input and takes it off every audio track (an input without audio, e.g. a Linux v4l2 camera, is already silent). */
  private async silence(inputName: string): Promise<void> {
    await this.client.call('SetInputAudioTracks', { inputName, inputAudioTracks: { ...TRACKS_NONE } }).catch(ignoreNoAudio)
    await this.client.call('SetInputMute', { inputName, inputMuted: true }).catch(ignoreNoAudio)
  }

  private async itemId(sourceName: string): Promise<number> {
    const cached = this.itemIds.get(sourceName)
    if (cached !== undefined) return cached
    const r = await this.client.call('GetSceneItemId', { sceneName: SCENE, sourceName })
    this.itemIds.set(sourceName, r.sceneItemId as number)
    return r.sceneItemId as number
  }

  private async createInput(data: Record<string, unknown>): Promise<number> {
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await this.client.call('CreateInput', data)
        return r.sceneItemId as number
      } catch (e) {
        if (codeOf(e) !== RESOURCE_ALREADY_EXISTS || attempt >= CREATE_RETRIES) throw e
        await new Promise((r) => setTimeout(r, CREATE_RETRY_MS))
      }
    }
  }

  /** Z-order in SCENE: primary at the bottom, backup above it, subtitles on top. */
  private async restack(): Promise<void> {
    const { sceneItems } = await this.client.call('GetSceneItemList', { sceneName: SCENE })
    const items = sceneItems as { sourceName: string; sceneItemId: number }[]
    for (const it of items) this.itemIds.set(it.sourceName, it.sceneItemId)
    const at = (name: string, sceneItemIndex: number): Promise<unknown> | undefined => {
      const it = items.find((i) => i.sourceName === name)
      if (it) return this.client.call('SetSceneItemIndex', { sceneName: SCENE, sceneItemId: it.sceneItemId, sceneItemIndex })
    }
    await at(SRC_VIDEO, 0)
    if (items.some((i) => i.sourceName === SRC_BACKUP)) await at(SRC_BACKUP, 1)
    await at(SRC_OVERLAY, items.length - 1)
  }

  /**
   * Points a source slot (primary = SRC_VIDEO, backup = SRC_BACKUP) at a device, an image or a video.
   * The input is recreated when its OBS kind has to change; the backup is created hidden.
   */
  async setSource(slot: SourceSlot, src: VideoSource): Promise<void> {
    const inputName = slot === 'primary' ? SRC_VIDEO : SRC_BACKUP
    const { inputKind, inputSettings } = sourceInput(src, this.platform)
    let current: string | null = null
    try {
      current = (await this.client.call('GetInputSettings', { inputName })).inputKind as string
    } catch (e) {
      if (codeOf(e) !== RESOURCE_NOT_FOUND) throw e
    }
    if (current === inputKind) {
      await this.client.call('SetInputSettings', { inputName, inputSettings })
    } else {
      if (current !== null) {
        await this.client.call('RemoveInput', { inputName })
        this.itemIds.delete(inputName)
      }
      const sceneItemId = await this.createInput({
        sceneName: SCENE,
        inputName,
        inputKind,
        inputSettings,
        sceneItemEnabled: slot === 'primary' || this.backupVisible
      })
      this.itemIds.set(inputName, sceneItemId)
    }
    await this.silence(inputName)
    await this.client.call('SetSceneItemTransform', {
      sceneName: SCENE,
      sceneItemId: await this.itemId(inputName),
      sceneItemTransform: TRANSFORM_1080P
    })
    await this.restack()
  }

  /** Shows or hides the backup above the primary (the primary itself always stays visible). */
  async setBackupVisible(on: boolean): Promise<void> {
    this.backupVisible = on
    let sceneItemId: number
    try {
      sceneItemId = await this.itemId(SRC_BACKUP)
    } catch (e) {
      // No backup yet: it will be created with this visibility.
      if (codeOf(e) === RESOURCE_NOT_FOUND) return
      throw e
    }
    await this.client.call('SetSceneItemEnabled', { sceneName: SCENE, sceneItemId, sceneItemEnabled: on })
  }

  /** A tiny picture of the primary input alone, to tell whether it is absent (data URL). */
  async probePrimary(): Promise<string> {
    const r = await this.client.call('GetSourceScreenshot', { sourceName: SRC_VIDEO, imageFormat: 'png', imageWidth: 32 })
    return r.imageData as string
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

  /**
   * Asks OBS to stop the stream, also while it is still connecting (GetStreamStatus reports
   * outputActive false then, so it is not consulted). Resolves true when OBS accepted the request
   * (a 'stopped' state change follows), false when no stream output was running.
   */
  async stopStream(): Promise<boolean> {
    this.lastServer = null
    try {
      await this.client.call('StopStream')
      return true
    } catch (e) {
      if ((e as { code?: unknown })?.code === OUTPUT_NOT_RUNNING) return false
      throw e
    }
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

  /**
   * Opens a windowed program projector (no monitor index: a normal window the user places freely).
   * No request can close or list projectors, so every call opens a new window.
   */
  async openOutputWindow(): Promise<void> {
    await this.client.call('OpenVideoMixProjector', { videoMixType: 'OBS_WEBSOCKET_VIDEO_MIX_TYPE_PROGRAM' })
  }

  async showLive(): Promise<void> {
    await this.client.call('SetCurrentProgramScene', { sceneName: SCENE })
  }

  async showPause(): Promise<void> {
    await this.client.call('SetCurrentProgramScene', { sceneName: SCENE_PAUSE })
  }

  /** Called by LiveController after an OBS restart: forget cached scene item ids. */
  resetProjectorState(): void {
    this.itemIds.clear()
    this.backupVisible = false
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect()
  }
}
