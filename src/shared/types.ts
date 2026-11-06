export interface StreamEndpoints {
  srt?: string
  rtmp?: string
  ws?: string
}

export type SessionStatus = 'on_schedule' | 'ready' | 'active' | 'paused' | 'terminated'
export interface Channel { id: number; name: string; streamEndpoints?: StreamEndpoints }
export interface Session { id: string; name: string; status: SessionStatus; channels: Channel[]; owner?: string }
export interface Organization { id: string; name: string }
export interface TranscriberProfile { id: number; name: string; languages?: string[] }
export interface AuthMethod { path: string; from: string; name: string }
export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

export interface SavedDisplay { name: string; x: number; y: number; width: number; height: number }
export interface MonitorInfo extends SavedDisplay { index: number }

export interface Settings {
  instance: string
  orgId?: string
  profileId?: number
  videoDeviceId?: string
  audioDeviceId?: string
  output?: SavedDisplay
  lastSessionName?: string
}
