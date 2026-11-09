export interface StreamEndpoints {
  srt?: string
  rtmp?: string
  ws?: string
}

export type SessionStatus = 'on_schedule' | 'ready' | 'active' | 'paused' | 'terminated'
export interface Channel { id: number; name: string; streamEndpoints?: StreamEndpoints }
export interface Session { id: string; name: string; status: SessionStatus; channels: Channel[]; owner?: string; createdAt?: string; updatedAt?: string }
export interface SessionSummary { id: string; name: string; status: Exclude<SessionStatus, 'terminated'>; canStream: boolean; updatedAt?: string }
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

/** Email + password kept for « Se souvenir de moi » (stored encrypted with the OS keychain). */
export interface SavedLogin { email: string; password: string }

export interface Settings {
  instance: string
  orgId?: string
  profileId?: number
  videoDeviceId?: string
  audioDeviceId?: string
  lastSessionName?: string
  /** Main window position/size, restored at launch if still on a display. */
  windowBounds?: Bounds
}

export interface DeviceItem { id: string; name: string }
