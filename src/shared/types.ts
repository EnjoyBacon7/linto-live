import type { OrgRights } from './rights'

export interface StreamEndpoints {
  srt?: string
  rtmp?: string
  ws?: string
}

export type SessionStatus = 'on_schedule' | 'ready' | 'active' | 'paused' | 'terminated'
export type SessionVisibility = 'private' | 'organization' | 'public'
export interface Channel {
  id: number; name: string; streamEndpoints?: StreamEndpoints
  /** Spoken languages (e.g. `fr-FR`). */
  languages?: string[]
  /** Translation target codes. */
  translations?: string[]
}
export interface Session {
  id: string; name: string; status: SessionStatus; channels: Channel[]; owner?: string; createdAt?: string; updatedAt?: string
  visibility?: SessionVisibility
  /** Free-form session metadata (LinTO Studio keeps the watermark settings under `@watermark`). */
  meta?: Record<string, unknown>
}
/** A choice of language for the subtitle band: `value` is 'original', 'crossSubtitles' or a translation code. */
export interface SubtitleLanguageOption { value: string; label: string }
/** Sessions the user can stream to (the others of the organisation are not listed). */
export interface SessionSummary {
  id: string; name: string; status: Exclude<SessionStatus, 'terminated'>; updatedAt?: string
  /** The session's watermark, completed with the instance defaults. */
  watermark: Watermark
  visibility?: SessionVisibility
  /** Choices for the language shown in the subtitle band (from the first channel). */
  languages: SubtitleLanguageOption[]
}

/**
 * Watermark shown in the subtitle band, as on the LinTO subtitle page: every `frequency` s for `duration` s
 * (always when pinned). `$linto` / `$linagora` in `content` become logos. Stored on the LinTO session.
 */
export interface Watermark {
  display: boolean
  pinned: boolean
  content: string
  frequency: number
  duration: number
}
/** The instance's watermark feature flag and defaults (its config.js, else LinTO Studio's defaults). */
export interface WatermarkConfig {
  enabled: boolean
  content: string
  frequency: number
  duration: number
}
/** An exact-name check before « Nouvelle session »: see lookupSession. */
export type SessionLookup = 'none' | 'usable' | 'forbidden' | 'rtmp-only' | 'terminated'
/** `rights`: what the user may do there (absent when LinTO did not say: then LinTO alone decides). */
export interface Organization { id: string; name: string; rights?: OrgRights }
export interface TranscriberProfile { id: number; name: string; languages?: string[]; translations?: string[] }
/** A LinTO translation of a segment into `targetLang` (e.g. 'en'); `sourceLang`: the spoken language (e.g. 'fr-FR'). */
export interface TranslationEvent {
  segmentId: number
  text: string
  sourceLang?: string | null
  targetLang: string
  final: boolean
  astart?: string | null
  start?: number | null
  end?: number | null
  locutor?: string | null
}
/** Options of a new session: translation targets and who may see it (`password`: public + a password). */
export interface NewSessionOptions {
  translations: string[]
  visibility: SessionVisibility | 'password'
  password?: string
  /** The band of the session created starts in cross subtitles (each sentence in the other spoken language). */
  crossSubtitles?: boolean
}
export interface AuthMethod { path: string; from: string; name: string }
/** LinTO rejected the token (expired, revoked…): logging in again is the fix. */
export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

/** A LinTO HTTP call failed with a status other than 401. `serverMessage` / `code`: LinTO's JSON error body. */
export class LintoHttpError extends Error {
  constructor(
    readonly status: number,
    body: string,
    readonly serverMessage?: string,
    readonly code?: string
  ) {
    super(`LinTO HTTP ${status}: ${body}`)
    this.name = 'LintoHttpError'
  }
}

/** The token is valid but LinTO refuses the action (role, organisation permission, resource of another organisation). */
export class ForbiddenError extends LintoHttpError {
  constructor(status: number, body: string, serverMessage?: string, code?: string) {
    super(status, body, serverMessage, code)
    this.name = 'ForbiddenError'
  }
}

/** The organisation or session no longer exists (deleted on LinTO). */
export class NotFoundError extends LintoHttpError {
  constructor(status: number, body: string, serverMessage?: string, code?: string) {
    super(status, body, serverMessage, code)
    this.name = 'NotFoundError'
  }
}

/** Window rectangle in screen coordinates (DIP). */
export interface Bounds { x: number; y: number; width: number; height: number }

/** Email + password kept for « Se souvenir de moi » (stored encrypted with the OS keychain). */
export interface SavedLogin { email: string; password: string }

/** Same display cycle as the watermark: every `frequency` s for `duration` s (always when pinned). */
export interface QrSettings { display: boolean; pinned: boolean; frequency: number; duration: number }
export const DEFAULT_QR: QrSettings = { display: false, pinned: false, frequency: 60, duration: 15 }

/** Screen or window capture (a display, or one application window). */
export type CaptureKind = 'screen' | 'window'

/**
 * A video source. Captures keep the name OBS gave the screen or window: listing them costs a capture
 * permission on macOS, so the label is not looked up again.
 */
export type VideoSource =
  | { kind: 'none' }
  | { kind: 'device'; id: string }
  | { kind: 'image'; path: string }
  | { kind: 'video'; path: string }
  | { kind: 'screen'; id: string; name: string }
  | { kind: 'window'; id: string; name: string }

/**
 * The screens or windows OBS can capture, or why they cannot be listed (macOS: no screen recording access).
 * 'portal' (Linux Wayland session): no list, the system's own picker asks which one once the source is chosen.
 */
export type CaptureTargets = { ok: true; items: DeviceItem[] } | { ok: false; access: MediaAccess } | { ok: 'portal' }

export interface Settings {
  instance: string
  orgId?: string
  profileId?: number
  /** Main video source (absent = none). */
  primarySource?: VideoSource
  /** Fallback video source, shown when the main one is absent. */
  backupSource?: VideoSource
  /** A black picture counts as an absent source (default true). */
  blackIsAbsent?: boolean
  audioDeviceId?: string
  /** Gain applied to the micro in OBS, in dB (default 0), before a limiter that keeps it from clipping. */
  micGainDb?: number
  lastSessionName?: string
  /** Subtitle band shown in the video (default true). */
  subtitlesVisible?: boolean
  /** Subtitle font size in px on the 1920×1080 canvas (default 48). */
  subtitleFontSize?: number
  /** Height of the subtitle band in the video, in % of its travel: 0 = bottom edge (default), 100 = top edge. */
  subtitlePosition?: number
  /** Delay in ms the subtitle band trades for calm reading (0 = shown at once, default); see subtitleSmoothingMs. */
  subtitleSmoothingMs?: number
  /** Fastest pace of the words in the subtitle band, in words/s (0 = no limit, default); see subtitleMaxWordsPerSecond. */
  subtitleMaxWordsPerSecond?: number
  /** Number of caption lines in the band of the video (1..3, default 2). */
  subtitleLines?: number
  /** Language shown in the subtitle band, per session id (absent = the original language). */
  subtitleLanguages?: Record<string, string>
  /** QR code of the session's public link in the video (default: hidden). */
  qr?: QrSettings
  /** Record each show to a file, read at Démarrer (default false). */
  recordEnabled?: boolean
  /** Folder of the recordings (default: « LinTO Live » in the user's Videos folder); created when missing. */
  recordDir?: string
  /** EXPERIMENTAL: proper nouns expected in the show, written as they must appear; LinTO's near-sounding words are replaced. */
  properNouns?: string[]
  /** EXPERIMENTAL: the proper-noun correction is on (default false); the list is kept when it is off. */
  properNounsEnabled?: boolean
  /**
   * Broadcast each show online, read at Démarrer (default false). OBS has one output besides the stream to
   * LinTO: broadcasting and recording exclude each other (the broadcast wins if both are set).
   */
  broadcastEnabled?: boolean
  /** RTMP(S) server of the online broadcast (see isBroadcastServer); its stream key is stored apart, encrypted. */
  broadcastServer?: string
  /** Read-only (SettingsStore.get): a stream key is saved (setBroadcastKey). */
  broadcastKeySet?: boolean
  /** Main window position/size, restored at launch if still on a display. */
  windowBounds?: Bounds
  /** Subtitle window position/size, restored when it is opened again if still on a display. */
  subtitlesWindowBounds?: Bounds
  /** The first-launch page was gone through (macOS permissions, Linux system checks): it is not shown again. */
  permissionsOnboarded?: boolean
}

export interface DeviceItem { id: string; name: string }

export const DEFAULT_SUBTITLE_FONT_SIZE = 48
export const SUBTITLE_FONT_SIZE_MIN = 12
export const SUBTITLE_FONT_SIZE_MAX = 96

/** Position actually used for the band: the saved one if valid (0 bottom … 100 top), else the bottom. */
export function subtitlePosition(s: Pick<Settings, 'subtitlePosition'>): number {
  const v = s.subtitlePosition
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 0
}

export const SUBTITLE_SMOOTHING_MAX = 10000
export const SUBTITLE_SMOOTHING_STEP = 250

/** Smoothing delay actually used: the saved one on a 250 ms step within 0..10 s, else 0. */
export function subtitleSmoothingMs(s: Pick<Settings, 'subtitleSmoothingMs'>): number {
  const v = s.subtitleSmoothingMs
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0
  return Math.min(SUBTITLE_SMOOTHING_MAX, Math.max(0, Math.round(v / SUBTITLE_SMOOTHING_STEP) * SUBTITLE_SMOOTHING_STEP))
}

export const SUBTITLE_MAX_WPS_MAX = 8
export const SUBTITLE_MAX_WPS_STEP = 0.5

/**
 * Pace limit actually used, in words/s: the saved one on a 0.5 step within 0..8, else 0 (no limit). Caps how
 * fast the band catches up when a burst arrives (LinTO's translations come a whole sentence at once).
 */
export function subtitleMaxWordsPerSecond(s: Pick<Settings, 'subtitleMaxWordsPerSecond'>): number {
  const v = s.subtitleMaxWordsPerSecond
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0
  return Math.min(SUBTITLE_MAX_WPS_MAX, Math.max(0, Math.round(v / SUBTITLE_MAX_WPS_STEP) * SUBTITLE_MAX_WPS_STEP))
}

/** Caption lines in the band of the video: 3 at most, so the band never meets the QR code (layout.test.ts). */
export const DEFAULT_SUBTITLE_LINES = 2
export const SUBTITLE_LINES_MIN = 1
export const SUBTITLE_LINES_MAX = 3

/** Line count actually used for the band: the saved one if valid, else 2. */
export function subtitleLines(s: Pick<Settings, 'subtitleLines'>): number {
  const v = s.subtitleLines
  return Number.isInteger(v) && v! >= SUBTITLE_LINES_MIN && v! <= SUBTITLE_LINES_MAX ? v! : DEFAULT_SUBTITLE_LINES
}

/** Micro gain range in dB (OBS's gain filter accepts -30..+30). */
export const MIC_GAIN_MIN = -30
export const MIC_GAIN_MAX = 20

/** Micro gain actually applied: the saved one rounded to whole dB and within range, else 0. */
export function micGainDb(s: Pick<Settings, 'micGainDb'>): number {
  const v = s.micGainDb
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(MIC_GAIN_MAX, Math.max(MIC_GAIN_MIN, Math.round(v))) : 0
}

/**
 * One transcribed segment of the session on air. `at` / `endAt`: when it was said (ms epoch, from LinTO's
 * `astart` + `start`/`end` as on LinTO Studio, else when it reached the app); `lang`: the language LinTO
 * detected (e.g. 'fr-FR'); `locutor`: the speaker, when LinTO diarizes.
 */
export interface TranscriptSegment { id: number; text: string; at: number; endAt?: number; lang?: string; locutor?: string }
/**
 * Finalized segments (oldest first) and the segment still being transcribed; `sessionName` / `startedAt`
 * (ms epoch): the show they belong to (absent before the first one). `dropped`: how many older finals of the
 * show this copy no longer holds (absent when none).
 */
export interface Transcript {
  finals: TranscriptSegment[]
  partial: TranscriptSegment | null
  sessionName?: string
  startedAt?: number
  dropped?: number
}
/**
 * Change to the transcript: a segment finalized, the partial changed (null = none), a new show began, or the
 * whole transcript was replaced (e.g. the session's history loaded from LinTO).
 */
export type TranscriptUpdate =
  | { kind: 'final'; segment: TranscriptSegment }
  | { kind: 'partial'; segment: TranscriptSegment | null }
  | { kind: 'reset'; sessionName?: string; startedAt?: number }
  | { kind: 'snapshot'; transcript: Transcript }

/** Export formats of the transcript (« Exporter » once the show has ended). */
export const TRANSCRIPT_EXPORT_FORMATS = ['txt', 'srt', 'vtt', 'json'] as const
export type TranscriptExportFormat = (typeof TRANSCRIPT_EXPORT_FORMATS)[number]

/** OS privacy permissions the app asks for at first launch (macOS). */
export type MediaPermission = 'camera' | 'microphone'
/** Electron's systemPreferences.getMediaAccessStatus, 'unknown' for anything else. */
export type MediaAccess = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'

/** What the first-launch page checks on Linux (no privacy prompts there, but features the system may lack). */
export type SystemCheckId = 'display' | 'audio' | 'gpu' | 'keyring' | 'virtual-camera' | 'tray'
export interface SystemCheck {
  id: SystemCheckId
  ok: boolean
  /** When not ok: what is missing and how to get it. */
  fix?: string
  /** When not ok: a show cannot work without it (no OBS, no micro), unlike the optional features. */
  blocking?: boolean
}

export interface PermissionsStatus {
  /** Show the first-launch permissions page. */
  needed: boolean
  camera: MediaAccess
  microphone: MediaAccess
  /** Linux: features the system lacks or provides (the page shows them instead of camera and micro). */
  system?: SystemCheck[]
}
