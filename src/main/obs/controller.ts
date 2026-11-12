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

/**
 * Upper bound for one obs-websocket request. obs-websocket-js has none, and a request in flight when the
 * socket closes never settles (the library drops its listeners without rejecting): unbounded, one such call
 * would block LiveController's queue — Démarrer, Arrêter, the re-attach after an OBS restart — until quit.
 */
export const OBS_CALL_TIMEOUT_MS = 10_000
/** Requests that open or enumerate a capture device can legitimately take several seconds. */
export const OBS_SLOW_CALL_TIMEOUT_MS = 30_000
const SLOW_REQUESTS = new Set(['CreateInput', 'CreateSceneItem', 'SetInputSettings', 'GetInputPropertiesListPropertyItems'])
/** connect() waits for OBS's Hello/Identified; disconnect() for the close handshake. */
const OBS_CONNECT_TIMEOUT_MS = 10_000
const OBS_DISCONNECT_TIMEOUT_MS = 3_000

export interface ObsTimeouts {
  call: number
  slowCall: number
}
const DEFAULT_TIMEOUTS: ObsTimeouts = { call: OBS_CALL_TIMEOUT_MS, slowCall: OBS_SLOW_CALL_TIMEOUT_MS }

/** Rejects with `err` if `p` has not settled after `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number, err: () => Error): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(err()), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

const MIN_DB = -100
/** obs-websocket RequestStatus::OutputNotRunning. */
const OUTPUT_NOT_RUNNING = 501
const TRACKS_NONE = { '1': false, '2': false, '3': false, '4': false, '5': false, '6': false }

const videoKind = (p: NodeJS.Platform): string => (p === 'darwin' ? 'macos-avcapture' : 'v4l2_input')
const audioKind = (p: NodeJS.Platform): string => (p === 'darwin' ? 'coreaudio_input_capture' : 'pulse_input_capture')
const videoProp = (p: NodeJS.Platform): string => (p === 'darwin' ? 'device' : 'device_id')

/** obs-websocket RequestStatus.InvalidResourceState: what audio requests answer for an input without audio. */
const INVALID_RESOURCE_STATE = 604

function ignoreNoAudio(e: unknown): void {
  if ((e as { code?: unknown })?.code === INVALID_RESOURCE_STATE) return
  throw e
}

export class ObsController {
  private platform: NodeJS.Platform = process.platform
  private videoItemId: number | null = null
  private lastServer: string | null = null
  private stateListeners = new Set<(s: StreamState) => void>()
  /** Rejecters of the requests in flight: the library exposes none, so they are tracked here. */
  private pending = new Set<(e: Error) => void>()
  private readonly onClosed = (): void => this.failPending(new Error('Connexion à OBS perdue.'))

  constructor(
    private readonly client: ObsClient,
    private readonly timeouts: ObsTimeouts = DEFAULT_TIMEOUTS
  ) {
    client.on('ConnectionClosed', this.onClosed)
  }

  static async connect(c: ObsConnection): Promise<ObsController> {
    const ws = new OBSWebSocket()
    const connecting = ws.connect(`ws://127.0.0.1:${c.port}`, c.password, {
      eventSubscriptions: EventSubscription.All | EventSubscription.InputVolumeMeters,
      rpcVersion: 1
    })
    try {
      await withTimeout(connecting, OBS_CONNECT_TIMEOUT_MS, () => new Error(`OBS ne répond pas (connexion, ${OBS_CONNECT_TIMEOUT_MS / 1000} s).`))
    } catch (e) {
      connecting.catch(() => {})
      await ws.disconnect().catch(() => {})
      throw e
    }
    return new ObsController(ws as unknown as ObsClient)
  }

  /**
   * Every request goes through here: bounded by a timeout, and rejected as soon as the connection closes
   * (the library would leave it pending forever).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private call(req: string, data?: Record<string, unknown>): Promise<any> {
    const ms = SLOW_REQUESTS.has(req) ? this.timeouts.slowCall : this.timeouts.call
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new Promise<any>((resolve, reject) => {
      const settle = (): void => {
        clearTimeout(timer)
        this.pending.delete(fail)
      }
      const fail = (e: Error): void => {
        settle()
        reject(e)
      }
      const timer = setTimeout(() => fail(new Error(`OBS ne répond pas (${req}, ${ms / 1000} s).`)), ms)
      this.pending.add(fail)
      let p: Promise<unknown>
      try {
        p = this.client.call(req, data)
      } catch (e) {
        return fail(e as Error)
      }
      p.then(
        (r) => {
          settle()
          resolve(r)
        },
        (e) => fail(e as Error)
      )
    })
  }

  private failPending(e: Error): void {
    const fails = [...this.pending]
    this.pending.clear()
    fails.forEach((f) => f(e))
  }

  async ensureScene(platform: NodeJS.Platform): Promise<void> {
    this.platform = platform
    const { scenes } = await this.call('GetSceneList')
    const have = new Set<string>((scenes as { sceneName: string }[]).map((s) => s.sceneName))
    for (const name of [SCENE, SCENE_PAUSE]) {
      if (!have.has(name)) await this.call('CreateScene', { sceneName: name })
    }
    const { inputs } = await this.call('GetInputList')
    const existing = new Set<string>((inputs as { inputName: string }[]).map((i) => i.inputName))
    const { sceneItems } = await this.call('GetSceneItemList', { sceneName: SCENE })
    const inScene = new Set<string>((sceneItems as { sourceName: string }[]).map((i) => i.sourceName))

    const wanted: [string, string, Record<string, unknown>][] = [
      [SRC_VIDEO, videoKind(platform), {}],
      [SRC_OVERLAY, 'browser_source', {}],
      [SRC_AUDIO, audioKind(platform), {}]
    ]
    for (const [inputName, inputKind, inputSettings] of wanted) {
      if (!existing.has(inputName)) {
        await this.call('CreateInput', { sceneName: SCENE, inputName, inputKind, inputSettings, sceneItemEnabled: true })
      } else if (!inScene.has(inputName)) {
        await this.call('CreateSceneItem', { sceneName: SCENE, sourceName: inputName, sceneItemEnabled: true })
      }
    }
    for (const name of [SRC_VIDEO, SRC_OVERLAY, SRC_AUDIO]) {
      const isAudio = name === SRC_AUDIO
      // Silencing a source that has no audio at all (Linux v4l2 camera) is already done.
      const silence = (req: string, data: Record<string, unknown>): Promise<unknown> =>
        isAudio ? this.call(req, data) : this.call(req, data).catch(ignoreNoAudio)
      await silence('SetInputAudioTracks', {
        inputName: name,
        inputAudioTracks: isAudio ? { ...TRACKS_NONE, '1': true } : { ...TRACKS_NONE }
      })
      if (!isAudio) await silence('SetInputMute', { inputName: name, inputMuted: true })
    }
  }

  private async devices(inputName: string, propertyName: string): Promise<DeviceItem[]> {
    const { propertyItems } = await this.call('GetInputPropertiesListPropertyItems', { inputName, propertyName })
    return (propertyItems as { itemName: string; itemValue: unknown; itemEnabled?: boolean }[])
      .filter((i) => i.itemEnabled !== false)
      .map((i) => ({ name: (i.itemName ?? '').trim(), id: i.itemValue == null ? '' : String(i.itemValue) }))
      // OBS lists a blank placeholder item (no value): it would show as an empty slot next to « Aucune ».
      .filter((d) => d.id !== '' && d.name !== '')
  }

  listVideoDevices(): Promise<DeviceItem[]> {
    return this.devices(SRC_VIDEO, videoProp(this.platform))
  }

  listAudioDevices(): Promise<DeviceItem[]> {
    return this.devices(SRC_AUDIO, 'device_id')
  }

  async setVideoDevice(id: string): Promise<void> {
    await this.call('SetInputSettings', { inputName: SRC_VIDEO, inputSettings: { [videoProp(this.platform)]: id } })
    if (this.videoItemId === null) {
      const r = await this.call('GetSceneItemId', { sceneName: SCENE, sourceName: SRC_VIDEO })
      this.videoItemId = r.sceneItemId as number
    }
    await this.call('SetSceneItemTransform', {
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
    await this.call('SetInputSettings', { inputName: SRC_AUDIO, inputSettings: { device_id: id } })
  }

  async setOverlayUrl(url: string): Promise<void> {
    await this.call('SetInputSettings', {
      inputName: SRC_OVERLAY,
      inputSettings: { url, width: 1920, height: 1080, fps: 30, fps_custom: true, reroute_audio: true, shutdown: false }
    })
    await this.call('SetInputMute', { inputName: SRC_OVERLAY, inputMuted: true })
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
    const r = await this.call('GetSourceScreenshot', {
      sourceName: SCENE,
      imageFormat: 'jpg',
      imageWidth: 640,
      imageCompressionQuality: 70
    })
    return r.imageData as string
  }

  private async streamActive(): Promise<boolean> {
    const r = await this.call('GetStreamStatus')
    return Boolean(r?.outputActive)
  }

  async startStream(s: ObsStreamService): Promise<void> {
    const server = s.streamServiceSettings.server
    const key = s.streamServiceSettings.key
    const id = `${server}\n${key}`
    try {
      if (await this.streamActive()) {
        if (this.lastServer === id) return
        await this.call('StopStream')
      }
      await this.call('SetStreamServiceSettings', s as unknown as Record<string, unknown>)
      await this.call('StartStream')
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
      await this.call('StopStream')
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
    await this.call('OpenVideoMixProjector', { videoMixType: 'OBS_WEBSOCKET_VIDEO_MIX_TYPE_PROGRAM' })
  }

  async showLive(): Promise<void> {
    await this.call('SetCurrentProgramScene', { sceneName: SCENE })
  }

  async showPause(): Promise<void> {
    await this.call('SetCurrentProgramScene', { sceneName: SCENE_PAUSE })
  }

  /** Called by LiveController after an OBS restart: forget cached scene item ids. */
  resetProjectorState(): void {
    this.videoItemId = null
  }

  /** Rejects the requests still in flight, then closes the socket (bounded: OBS may be frozen). */
  async disconnect(): Promise<void> {
    this.client.off('ConnectionClosed', this.onClosed)
    this.failPending(new Error('Connexion à OBS fermée.'))
    const closing = this.client.disconnect()
    closing.catch(() => {})
    await withTimeout(closing, OBS_DISCONNECT_TIMEOUT_MS, () => new Error('OBS ne ferme pas la connexion.'))
  }
}
