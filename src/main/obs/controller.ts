import { join } from 'node:path'
import { EventSubscription, OBSWebSocket } from 'obs-websocket-js'
import type { ObsConnection } from './process'
import type { ObsStreamService } from './streamTarget'
import type { CaptureKind, DeviceItem, VideoSource } from '../../shared/types'
import { guardClient, OBS_CALL_TIMEOUT_MS } from './guardedClient'

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
/**
 * Hidden inputs (pause scene) that list the screens and the windows. Created only while listing, then removed:
 * on macOS, merely creating one asks for the screen recording access, which OBS must not do on its own at start.
 */
export const SRC_SCREENS = 'Détection écrans'
export const SRC_WINDOWS = 'Détection fenêtres'
/** Filters of SRC_AUDIO, in this order: the user's gain, then a limiter that catches what it pushes over. */
export const FILTER_GAIN = 'Gain'
export const FILTER_LIMITER = 'Limiteur'
/** Ceiling of the micro's limiter (dBFS): just under clipping, so it only acts on peaks that would saturate. */
export const LIMITER_THRESHOLD_DB = -1

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
/** obs-websocket RequestStatus::OutputRunning. */
const OUTPUT_RUNNING = 500
/** obs-websocket RequestStatus::OutputNotRunning. */
const OUTPUT_NOT_RUNNING = 501
const TRACKS_NONE = { '1': false, '2': false, '3': false, '4': false, '5': false, '6': false }

const videoKind = (p: NodeJS.Platform): string => (p === 'darwin' ? 'macos-avcapture' : 'v4l2_input')
const audioKind = (p: NodeJS.Platform): string => (p === 'darwin' ? 'coreaudio_input_capture' : 'pulse_input_capture')
const videoProp = (p: NodeJS.Platform): string => (p === 'darwin' ? 'device' : 'device_id')

/**
 * Screen and window capture inputs. macOS: ScreenCaptureKit (one kind, `type` 0 = display by UUID, 1 = window by
 * CGWindowID). Linux, X11 session: XSHM for a screen (by index) and
 * XComposite for a window (by its « id\r\nname\r\nclass » string, which OBS also matches by name once the id is gone).
 */
const captureKind = (kind: CaptureKind, p: NodeJS.Platform): string =>
  p === 'darwin' ? 'screen_capture' : kind === 'screen' ? 'xshm_input_v2' : 'xcomposite_input'
const captureProp = (kind: CaptureKind, p: NodeJS.Platform): string =>
  p === 'darwin' ? (kind === 'screen' ? 'display_uuid' : 'window') : kind === 'screen' ? 'screen' : 'capture_window'

function captureSettings(kind: CaptureKind, id: string, p: NodeJS.Platform): Record<string, unknown> {
  if (p === 'darwin') {
    return kind === 'screen'
      ? { type: 0, display_uuid: id, show_cursor: true, hide_obs: true }
      : { type: 1, window: Number(id), show_cursor: true }
  }
  return kind === 'screen' ? { screen: Number(id), show_cursor: true } : { capture_window: id, show_cursor: true }
}

/** Settings of a listing input: it captures nothing (no window / no screen chosen). */
function captureProbeSettings(kind: CaptureKind, p: NodeJS.Platform): Record<string, unknown> {
  if (p === 'darwin') return { type: 1, window: 0 }
  return kind === 'screen' ? { screen: -1 } : { capture_window: '' }
}

/**
 * Linux Wayland session: XSHM only sees XWayland's empty root (black) and XComposite crashes OBS when it lists
 * windows. The capture goes through the desktop's ScreenCast portal instead: one PipeWire kind (screen or window,
 * chosen by the user in the system's own picker when the input is created). The portal's restore token, kept by
 * OBS in the input's settings, picks the same target again at the next start without asking.
 */
export const PORTAL_CAPTURE = 'pipewire-screen-capture-source'

/** OBS input kind and settings for a video source ('none' = a device input without device). */
function sourceInput(src: VideoSource, p: NodeJS.Platform, portal = false): { inputKind: string; inputSettings: Record<string, unknown> } {
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
    case 'screen':
    case 'window':
      // RestoreToken is left alone: SetInputSettings overlays, so the one OBS saved is kept.
      if (portal && p === 'linux') return { inputKind: PORTAL_CAPTURE, inputSettings: { ShowCursor: true } }
      return { inputKind: captureKind(src.kind, p), inputSettings: captureSettings(src.kind, src.id, p) }
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

/** OBS's FFmpeg output in Advanced mode (its « Custom Output (FFmpeg) » recording type, see seed.ts). */
export const FFMPEG_OUTPUT = 'adv_ffmpeg_output'
const MKV = { name: 'matroska', mime: 'video/x-matroska' }
const FLV = { name: 'flv', mime: 'video/x-flv' }

const pad2 = (n: number): string => String(n).padStart(2, '0')
/** `YYYY-MM-DD hh-mm-ss` in local time, as OBS names its recordings. */
export function fileStamp(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`
}

/** File name base for a recording: no character OBS or a file system treats specially ('%' starts an OBS format specifier). */
export function recordBaseName(sessionName: string): string {
  // eslint-disable-next-line no-control-regex
  const name = sessionName.replace(/[/\\:*?"<>|%\u0000-\u001f\u007f]/g, '-').slice(0, 100).trim()
  return name || 'LinTO Live'
}

export class ObsController {
  private platform: NodeJS.Platform = process.platform
  /** Scene item ids in SCENE, by source name (new OBS run = new ids, see resetProjectorState). */
  private itemIds = new Map<string, number>()
  /** Last visibility asked for the backup: kept when the backup input has to be recreated. */
  private backupVisible = false
  private lastServer: string | null = null
  private stateListeners = new Set<(s: StreamState) => void>()

  /** Portal capture: the target applied to each slot by this run (a different one = a new pick, see setSource). */
  private portalIds = new Map<SourceSlot, string>()

  /** `portalCapture`: screens and windows go through the ScreenCast portal (Linux Wayland session, see PORTAL_CAPTURE). */
  constructor(private readonly client: ObsClient, private readonly opts: { portalCapture?: boolean } = {}) {}

  static async connect(c: ObsConnection, opts: { portalCapture?: boolean } = {}): Promise<ObsController> {
    const ws = new OBSWebSocket()
    // Bounded too: an OBS that accepts the socket but never identifies would otherwise hold the queue.
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error("OBS ne répond pas (connexion).")), OBS_CALL_TIMEOUT_MS)
    })
    try {
      await Promise.race([
        ws.connect(`ws://127.0.0.1:${c.port}`, c.password, {
          eventSubscriptions: EventSubscription.All | EventSubscription.InputVolumeMeters,
          rpcVersion: 1
        }),
        timeout
      ])
    } catch (e) {
      await ws.disconnect().catch(() => {})
      throw e
    } finally {
      clearTimeout(timer)
    }
    return new ObsController(guardClient(ws as unknown as ObsClient), opts)
  }

  /** Liveness check (the watchdog): rejects when OBS does not answer in time. */
  async ping(): Promise<void> {
    await this.client.call('GetVersion')
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
    // A listing input left over by an OBS that died while listing (e.g. XComposite under Wayland): not kept.
    for (const name of [SRC_SCREENS, SRC_WINDOWS]) {
      if (existing.delete(name)) await this.client.call('RemoveInput', { inputName: name }).catch(() => {})
    }
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
    await this.ensureMicFilters()
    for (const name of [SRC_VIDEO, SRC_OVERLAY, SRC_DEVICES]) await this.silence(name)
  }

  /** Gain then limiter on the micro (created once, kept by OBS with the scene collection). */
  private async ensureMicFilters(): Promise<void> {
    const { filters } = await this.client.call('GetSourceFilterList', { sourceName: SRC_AUDIO })
    const have = new Set<string>((filters as { filterName: string }[]).map((f) => f.filterName))
    let count = have.size
    const limiter = { threshold: LIMITER_THRESHOLD_DB, release_time: 60 }
    if (!have.has(FILTER_GAIN)) {
      await this.client.call('CreateSourceFilter', {
        sourceName: SRC_AUDIO, filterName: FILTER_GAIN, filterKind: 'gain_filter', filterSettings: { db: 0 }
      })
      count++
    }
    if (!have.has(FILTER_LIMITER)) {
      await this.client.call('CreateSourceFilter', {
        sourceName: SRC_AUDIO, filterName: FILTER_LIMITER, filterKind: 'limiter_filter', filterSettings: limiter
      })
      count++
    } else {
      await this.client.call('SetSourceFilterSettings', { sourceName: SRC_AUDIO, filterName: FILTER_LIMITER, filterSettings: limiter })
    }
    await this.client.call('SetSourceFilterIndex', { sourceName: SRC_AUDIO, filterName: FILTER_GAIN, filterIndex: 0 })
    await this.client.call('SetSourceFilterIndex', { sourceName: SRC_AUDIO, filterName: FILTER_LIMITER, filterIndex: count - 1 })
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

  /**
   * The screens or the windows OBS can capture, from a hidden input created for the occasion and removed after
   * (macOS: the caller makes sure the screen recording access is granted, else OBS waits on it).
   */
  async listCaptureTargets(kind: CaptureKind): Promise<DeviceItem[]> {
    // Portal capture: nothing to list, the system picker chooses (and the X11 inputs would see nothing, or crash).
    if (this.opts.portalCapture && this.platform === 'linux') return []
    const inputName = kind === 'screen' ? SRC_SCREENS : SRC_WINDOWS
    try {
      await this.createInput({
        sceneName: SCENE_PAUSE,
        inputName,
        inputKind: captureKind(kind, this.platform),
        inputSettings: captureProbeSettings(kind, this.platform),
        sceneItemEnabled: false
      })
    } catch (e) {
      // Left over by an earlier listing that could not remove it: used as is.
      if (codeOf(e) !== RESOURCE_ALREADY_EXISTS) throw e
    }
    try {
      return await this.devices(inputName, captureProp(kind, this.platform))
    } finally {
      await this.client.call('RemoveInput', { inputName }).catch(() => {})
    }
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
    const portal = !!this.opts.portalCapture && this.platform === 'linux'
    const { inputKind, inputSettings } = sourceInput(src, this.platform, portal)
    let current: string | null = null
    try {
      current = (await this.client.call('GetInputSettings', { inputName })).inputKind as string
    } catch (e) {
      if (codeOf(e) !== RESOURCE_NOT_FOUND) throw e
    }
    // Portal: the target is only chosen in the system picker, shown when the input is created. Another pick
    // than the one applied in this run recreates the input, without a restore token, so the picker shows again;
    // the first one of a run (the saved choice re-applied at start) keeps the input and its token.
    const isPortal = inputKind === PORTAL_CAPTURE && (src.kind === 'screen' || src.kind === 'window')
    const known = this.portalIds.get(slot)
    const repick = isPortal && known !== undefined && known !== src.id
    if (isPortal) this.portalIds.set(slot, src.id)
    else this.portalIds.delete(slot)
    if (current === inputKind && !repick) {
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
        inputSettings: isPortal ? { ...inputSettings, RestoreToken: '' } : inputSettings,
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

  /** Micro gain in dB (OBS's gain filter, ahead of the limiter: a boost cannot make it clip). */
  async setMicGain(db: number): Promise<void> {
    await this.client.call('SetSourceFilterSettings', { sourceName: SRC_AUDIO, filterName: FILTER_GAIN, filterSettings: { db } })
  }

  /**
   * Audio feedback: OBS plays the micro on the monitoring device (the system output) as it goes into the
   * mix — after OBS's processing, i.e. what LinTO receives and what is recorded — while still sending it out.
   */
  async setAudioMonitor(on: boolean): Promise<void> {
    await this.client.call('SetInputAudioMonitorType', {
      inputName: SRC_AUDIO,
      monitorType: on ? 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT' : 'OBS_MONITORING_TYPE_NONE'
    })
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
   * Points OBS's FFmpeg output (the « recording » output, see seed.ts) at `url` and starts it. Set twice:
   * in the profile, which OBS re-applies when no output is running, and on the output itself, used as is
   * while the stream to LinTO already runs.
   */
  private async startFfmpegOutput(url: string, format: { name: string; mime: string }): Promise<void> {
    const param = (parameterName: string, parameterValue: string): Promise<unknown> =>
      this.client.call('SetProfileParameter', { parameterCategory: 'AdvOut', parameterName, parameterValue })
    await param('FFURL', url)
    await param('FFFormat', format.name)
    await param('FFFormatMimeType', format.mime)
    await this.client.call('SetOutputSettings', {
      outputName: FFMPEG_OUTPUT,
      outputSettings: { url, format_name: format.name, format_mime_type: format.mime }
    })
    await this.client.call('StartRecord')
  }

  /**
   * Switches the FFmpeg output's video encoder (a hardware encoder that failed, see hwEncoder.ts). Set
   * in the profile and on the output, like startFfmpegOutput's URL; used from the next StartRecord.
   */
  async setRecordEncoder(e: { name: string; options: string }): Promise<void> {
    const param = (parameterName: string, parameterValue: string): Promise<unknown> =>
      this.client.call('SetProfileParameter', { parameterCategory: 'AdvOut', parameterName, parameterValue })
    await param('FFVEncoder', e.name)
    await param('FFVCustom', e.options)
    await this.client.call('SetOutputSettings', {
      outputName: FFMPEG_OUTPUT,
      outputSettings: { video_encoder: e.name, video_settings: e.options }
    })
  }

  /** Records the output to `<dir>/<baseName> <date time>.mkv` (local time). */
  async startRecord(dir: string, baseName: string, now: Date = new Date()): Promise<void> {
    await this.startFfmpegOutput(join(dir, `${baseName} ${fileStamp(now)}.mkv`), MKV)
  }

  /**
   * Broadcasts the output online: FLV to `url`, the app's relay (`unix:<private socket>`, see
   * broadcast/relay.ts), which publishes to the platform. OBS never gets the stream key.
   */
  async startBroadcast(url: string): Promise<void> {
    await this.startFfmpegOutput(url, FLV)
  }

  /** Stops the recording or the broadcast; resolves its file path (a broadcast's local URL), or null when nothing was running. */
  async stopRecord(): Promise<string | null> {
    try {
      const r = await this.client.call('StopRecord')
      return (r?.outputPath as string | undefined) ?? null
    } catch (e) {
      if (codeOf(e) === OUTPUT_NOT_RUNNING) return null
      throw e
    }
  }

  /** Recording started ({active: true}) or stopped ({active: false, path}); the STARTING/STOPPING steps are not reported. */
  recordState$(cb: (s: { active: boolean; path?: string }) => void): () => void {
    const handler = (d: { outputState?: string; outputPath?: string | null }): void => {
      if (d.outputState === 'OBS_WEBSOCKET_OUTPUT_STARTED') cb({ active: true })
      else if (d.outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPED') cb({ active: false, path: d.outputPath ?? undefined })
    }
    this.client.on('RecordStateChanged', handler)
    return () => {
      this.client.off('RecordStateChanged', handler)
    }
  }

  /** Whether this OBS has a virtual camera output (none on Linux without the v4l2loopback module). */
  async virtualCamAvailable(): Promise<boolean> {
    try {
      await this.client.call('GetVirtualCamStatus')
      return true
    } catch (e) {
      if (codeOf(e) === INVALID_RESOURCE_STATE) return false
      throw e
    }
  }

  /** Starts or stops the virtual camera (the program output, captions included; video only). */
  async setVirtualCam(on: boolean): Promise<void> {
    try {
      await this.client.call(on ? 'StartVirtualCam' : 'StopVirtualCam')
    } catch (e) {
      // Already in the asked state.
      if (codeOf(e) === (on ? OUTPUT_RUNNING : OUTPUT_NOT_RUNNING)) return
      throw e
    }
  }

  /** Virtual camera started (true) or stopped (false); the STARTING/STOPPING steps are not reported. */
  virtualCamState$(cb: (active: boolean) => void): () => void {
    const handler = (d: { outputState?: string }): void => {
      if (d.outputState === 'OBS_WEBSOCKET_OUTPUT_STARTED') cb(true)
      else if (d.outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPED') cb(false)
    }
    this.client.on('VirtualcamStateChanged', handler)
    return () => {
      this.client.off('VirtualcamStateChanged', handler)
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
