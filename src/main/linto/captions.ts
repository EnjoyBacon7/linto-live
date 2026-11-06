import { EventEmitter } from 'node:events'
import { io as realIo } from 'socket.io-client'
import type { LintoUrls } from './instance'

export interface CaptionEvent { segmentId: number; text: string; locutor?: string | null }
export interface CaptionView { lines: string[]; partial: boolean }

function wrap(text: string, max: number): string[] {
  const lines: string[] = []
  let cur = ''
  for (let word of text.split(/\s+/).filter(Boolean)) {
    while (word.length > max) {
      if (cur) { lines.push(cur); cur = '' }
      lines.push(word.slice(0, max))
      word = word.slice(max)
    }
    if (!cur) cur = word
    else if (cur.length + 1 + word.length <= max) cur += ' ' + word
    else { lines.push(cur); cur = word }
  }
  if (cur) lines.push(cur)
  return lines
}

export class CaptionBuffer {
  private finals = ''
  private pending: CaptionEvent | null = null

  constructor(private maxCharsPerLine = 64, private maxLines = 2) {}

  /** Length of retained finalized text (bounded). */
  get size(): number { return this.finals.length }

  partial(e: CaptionEvent): CaptionView {
    if (e.text.trim()) this.pending = e
    return this.view()
  }

  final(e: CaptionEvent): CaptionView {
    if (e.text.trim()) {
      this.pending = null
      this.finals = this.finals ? `${this.finals} ${e.text.trim()}` : e.text.trim()
      // Trim at greedy-wrap line boundaries: output of the last lines is unchanged.
      const lines = wrap(this.finals, this.maxCharsPerLine)
      if (lines.length > this.maxLines) this.finals = lines.slice(-this.maxLines).join(' ')
    }
    return this.view()
  }

  private view(): CaptionView {
    const text = [this.finals, this.pending?.text.trim() ?? ''].filter(Boolean).join(' ')
    return { lines: wrap(text, this.maxCharsPerLine).slice(-this.maxLines), partial: this.pending !== null }
  }
}

type IoFn = typeof realIo
type Socket = ReturnType<IoFn>
export type CaptionStatus = 'connecting' | 'live' | 'offline'

export class CaptionStream extends EventEmitter {
  private socket: Socket | null = null
  private room: string | null = null

  constructor(
    private urls: LintoUrls,
    private token: () => string | null,
    private ioFactory: IoFn = realIo
  ) { super() }

  open(sessionId: string, channelId: number): void {
    this.teardown()
    const room = `${sessionId}/${channelId}`
    this.room = room
    this.emit('status', 'connecting' satisfies CaptionStatus)
    const socket = this.ioFactory(this.urls.wsUrl, {
      path: this.urls.wsPath,
      transports: ['websocket'],
      auth: (cb: (data: object) => void) => cb({ token: this.token() })
    })
    this.socket = socket
    const authFail = () => {
      if (this.socket !== socket) return
      socket.disconnect() // stop auto-reconnect until open() is called again
      this.emit('status', 'offline' satisfies CaptionStatus)
      this.emit('authError')
    }
    socket.on('connect', () => {
      socket.emit('join_room', room)
      this.emit('status', 'live' satisfies CaptionStatus)
    })
    socket.on('disconnect', () => this.emit('status', 'offline' satisfies CaptionStatus))
    socket.io.on('reconnect_attempt', () => this.emit('status', 'connecting' satisfies CaptionStatus))
    socket.on('connect_error', (err: Error) => {
      if (/token|auth/i.test(err?.message ?? '')) authFail()
    })
    socket.on('unauthorized', authFail)
    socket.on('partial', (e: CaptionEvent) => this.emit('partial', e))
    socket.on('final', (e: CaptionEvent) => this.emit('final', e))
  }

  close(): void {
    const had = this.socket !== null
    this.teardown()
    if (had) this.emit('status', 'offline' satisfies CaptionStatus)
  }

  private teardown(): void {
    const s = this.socket
    this.socket = null
    if (!s) return
    if (this.room && s.connected !== false) s.emit('leave_room', this.room)
    s.disconnect()
    this.room = null
  }
}
