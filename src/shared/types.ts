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

export interface Settings {
  instance: string
  orgId?: string
  profileId?: number
  videoDeviceId?: string
  audioDeviceId?: string
  lastSessionName?: string
}

export interface DeviceItem { id: string; name: string }
