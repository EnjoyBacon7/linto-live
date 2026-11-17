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
export interface NewSessionOptions { translations: string[]; visibility: SessionVisibility | 'password'; password?: string }
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

export type VideoSource = { kind: 'none' } | { kind: 'device'; id: string } | { kind: 'image' | 'video'; path: string }

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
  lastSessionName?: string
  /** Subtitle band shown in the video (default true). */
  subtitlesVisible?: boolean
  /** Subtitle font size in px on the 1920×1080 canvas (default 48). */
  subtitleFontSize?: number
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
}

export interface DeviceItem { id: string; name: string }

export const DEFAULT_SUBTITLE_FONT_SIZE = 48
export const SUBTITLE_FONT_SIZE_MIN = 12
export const SUBTITLE_FONT_SIZE_MAX = 96

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
