import { EventEmitter } from 'node:events'
import { io as realIo } from 'socket.io-client'
import type { LintoUrls } from './instance'

export interface CaptionEvent { segmentId: number; text: string; locutor?: string | null }

type IoFn = typeof realIo
type Socket = ReturnType<IoFn>
const STABLE_MS = 10000
export type CaptionStatus = 'connecting' | 'live' | 'offline'
const AUTH_ERROR_RE = /token|auth|jwt|expired|signature|unauthori[sz]ed|forbidden/i

export class CaptionStream extends EventEmitter {
  private socket: Socket | null = null
  private room: string | null = null
  private lastStatus: CaptionStatus | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private stableTimer: ReturnType<typeof setTimeout> | null = null
  private backoff = 1000

  constructor(
    private urls: LintoUrls,
    private token: () => string | null,
    private ioFactory: IoFn = realIo
  ) { super() }

  open(sessionId: string, channelId: number): void {
    this.teardown()
    this.lastStatus = null
    this.backoff = 1000
    const room = `${sessionId}/${channelId}`
    this.room = room
    this.setStatus('connecting')
    const socket = this.ioFactory(this.urls.wsUrl, {
      path: this.urls.wsPath,
      transports: ['websocket'],
      auth: (cb: (data: object) => void) => cb({ token: this.token() })
    })
    this.socket = socket
    const authFail = () => {
      if (this.socket !== socket) return
      socket.disconnect() // stop auto-reconnect until open() is called again
      this.clearTimers()
      this.setStatus('offline')
      this.emit('authError')
    }
    socket.on('connect', () => {
      socket.emit('join_room', room)
      this.setStatus('live')
      // Only forget the backoff once the connection has stayed up for a while.
      this.stableTimer = setTimeout(() => { this.backoff = 1000 }, STABLE_MS)
    })
    socket.on('disconnect', (reason: string) => {
      if (this.socket !== socket) return
      this.clearTimers()
      this.setStatus('offline')
      // socket.io does not auto-reconnect after a server-initiated disconnect.
      if (reason === 'io server disconnect') {
        const delay = this.backoff
        this.backoff = Math.min(this.backoff * 2, 30000)
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null
          if (this.socket !== socket) return
          this.setStatus('connecting')
          socket.connect()
        }, delay)
      }
    })
    socket.io.on('reconnect_attempt', () => { if (this.socket === socket) this.setStatus('connecting') })
    socket.on('connect_error', (err: Error) => {
      // Message wording varies by server version; LiveController also probes the API if captions stay down.
      if (AUTH_ERROR_RE.test(err?.message ?? '')) authFail()
    })
    socket.on('unauthorized', authFail)
    socket.on('partial', (e: CaptionEvent) => this.emit('partial', e))
    socket.on('final', (e: CaptionEvent) => this.emit('final', e))
  }

  close(): void {
    const had = this.socket !== null
    this.teardown()
    if (had) this.setStatus('offline')
  }

  private setStatus(st: CaptionStatus): void {
    if (this.lastStatus === st) return
    this.lastStatus = st
    this.emit('status', st)
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.stableTimer) clearTimeout(this.stableTimer)
    this.retryTimer = this.stableTimer = null
  }

  private teardown(): void {
    const s = this.socket
    this.socket = null
    this.clearTimers()
    if (!s) return
    if (this.room && s.connected !== false) s.emit('leave_room', this.room)
    s.disconnect()
    this.room = null
  }
}
