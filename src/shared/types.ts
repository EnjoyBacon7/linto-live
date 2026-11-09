export interface StreamEndpoints {
  srt?: string
  rtmp?: string
  ws?: string
}

export type SessionStatus = 'on_schedule' | 'ready' | 'active' | 'paused' | 'terminated'
export interface Channel { id: number; name: string; streamEndpoints?: StreamEndpoints }
export interface Session {
  id: string; name: string; status: SessionStatus; channels: Channel[]; owner?: string; createdAt?: string; updatedAt?: string
  /** Free-form session metadata (LinTO Studio keeps the watermark settings under `@watermark`). */
  meta?: Record<string, unknown>
}
export interface SessionSummary {
  id: string; name: string; status: Exclude<SessionStatus, 'terminated'>; canStream: boolean; updatedAt?: string
  /** The session's watermark, completed with the instance defaults. */
  watermark: Watermark
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
export interface Organization { id: string; name: string }
export interface TranscriberProfile { id: number; name: string; languages?: string[] }
export interface AuthMethod { path: string; from: string; name: string }
export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

/** Window rectangle in screen coordinates (DIP). */
export interface Bounds { x: number; y: number; width: number; height: number }

export interface Settings {
  instance: string
  orgId?: string
  profileId?: number
  videoDeviceId?: string
  audioDeviceId?: string
  lastSessionName?: string
  /** Subtitle band shown in the video (default true). */
  subtitlesVisible?: boolean
  /** Subtitle font size in px on the 1920×1080 canvas (default 48). */
  subtitleFontSize?: number
  /** Main window position/size, restored at launch if still on a display. */
  windowBounds?: Bounds
}

export interface DeviceItem { id: string; name: string }

export const DEFAULT_SUBTITLE_FONT_SIZE = 48
export const SUBTITLE_FONT_SIZE_MIN = 12
export const SUBTITLE_FONT_SIZE_MAX = 96
