import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { CaptionStream } from '../../src/main/linto/captions'
import type { LintoUrls } from '../../src/main/linto/instance'

class FakeSocket extends EventEmitter {
  emit_(ev: string, ...a: unknown[]) { return super.emit(ev, ...a) }
  emitted: unknown[][] = []
  disconnected = false
  io = new EventEmitter()
  connects = 0
  connect() { this.connects++; return this }
  emit(ev: string, ...a: unknown[]): boolean { this.emitted.push([ev, ...a]); return true }
  disconnect() { this.disconnected = true; return this }
}
const urls: LintoUrls = { instance: 'https://s', api: 'a', auth: 'b', wsUrl: 'https://s', wsPath: '/io' }
function mk(token: () => string | null = () => 'tok') {
  const sock = new FakeSocket()
  const calls: { url: string; opts: any }[] = []
  const sock2 = sock
  const factory = ((url: string, opts: any) => { calls.push({ url, opts }); return sock2 }) as any
  const s = new CaptionStream(urls, token, factory)
  const statuses: string[] = []
  s.on('status', (x) => statuses.push(x))
  return { s, sock: sock2, calls, statuses }
}

describe('CaptionStream', () => {
  it('connects, joins room on connect and after reconnect', () => {
    const { s, sock, calls, statuses } = mk()
    s.open('s1', 7)
    expect(calls[0].url).toBe('https://s')
    expect(calls[0].opts.path).toBe('/io')
    expect(calls[0].opts.transports).toEqual(['websocket'])
    let got: unknown
    calls[0].opts.auth((d: unknown) => (got = d))
    expect(got).toEqual({ token: 'tok' })
    sock.emit_('connect')
    sock.emit_('disconnect')
    sock.io.emit('reconnect_attempt')
    sock.emit_('connect')
    expect(sock.emitted.filter((e) => e[0] === 'join_room')).toEqual([['join_room', 's1/7'], ['join_room', 's1/7']])
    expect(statuses).toEqual(['connecting', 'live', 'offline', 'connecting', 'live'])
  })
  it('re-reads token at each connect', () => {
    let t = 'a'
    const { s, calls } = mk(() => t)
    s.open('s1', 7)
    let got: any
    calls[0].opts.auth((d: unknown) => (got = d)); expect(got.token).toBe('a')
    t = 'b'
    calls[0].opts.auth((d: unknown) => (got = d)); expect(got.token).toBe('b')
  })
  it('forwards partial and final events', () => {
    const { s, sock } = mk()
    const out: unknown[] = []
    s.on('partial', (e) => out.push(['p', e]))
    s.on('final', (e) => out.push(['f', e]))
    s.open('s1', 7)
    sock.emit_('partial', { segmentId: 1, text: 'a' })
    sock.emit_('final', { segmentId: 1, text: 'ab' })
    expect(out).toEqual([['p', { segmentId: 1, text: 'a' }], ['f', { segmentId: 1, text: 'ab' }]])
  })
  it('emits authError on connect_error with auth message and stops reconnecting', () => {
    const { s, sock } = mk()
    let n = 0
    s.on('authError', () => n++)
    s.open('s1', 7)
    sock.emit_('connect_error', new Error('Authentication token is missing'))
    expect(n).toBe(1)
    expect(sock.disconnected).toBe(true)
  })
  it.each(['jwt expired', 'invalid signature', 'Unauthorized', 'unauthorised', 'Forbidden', 'Session expired'])(
    'emits authError on connect_error %j', (msg) => {
      const { s, sock } = mk()
      let n = 0
      s.on('authError', () => n++)
      s.open('s1', 7)
      sock.emit_('connect_error', new Error(msg))
      expect(n).toBe(1)
      expect(sock.disconnected).toBe(true)
    }
  )
  it.each(['websocket error', 'timeout', 'xhr poll error'])('ignores network connect_error %j', (msg) => {
    const { s, sock } = mk()
    let n = 0
    s.on('authError', () => n++)
    s.open('s1', 7)
    sock.emit_('connect_error', new Error(msg))
    expect(n).toBe(0)
  })
  it('emits authError on unauthorized event', () => {
    const { s, sock } = mk()
    let n = 0
    s.on('authError', () => n++)
    s.open('s1', 7)
    sock.emit_('unauthorized')
    expect(n).toBe(1)
  })
  it('does not emit authError on network connect_error', () => {
    const { s, sock } = mk()
    let n = 0
    s.on('authError', () => n++)
    s.open('s1', 7)
    sock.emit_('connect_error', new Error('xhr poll error'))
    expect(n).toBe(0)
    expect(sock.disconnected).toBe(false)
  })
  it('close leaves room and disconnects', () => {
    const { s, sock, statuses } = mk()
    s.open('s1', 7)
    sock.emit_('connect')
    s.close()
    expect(sock.emitted).toContainEqual(['leave_room', 's1/7'])
    expect(sock.disconnected).toBe(true)
    expect(statuses.at(-1)).toBe('offline')
  })

  describe('server-side disconnect', () => {
    afterEach(() => vi.useRealTimers())
    it('reconnects with doubling backoff, no tight loop', () => {
      vi.useFakeTimers()
      const { s, sock } = mk()
      s.open('s1', 7)
      sock.emit_('connect')
      sock.emit_('disconnect', 'io server disconnect')
      expect(sock.connects).toBe(0)
      vi.advanceTimersByTime(999); expect(sock.connects).toBe(0)
      vi.advanceTimersByTime(1); expect(sock.connects).toBe(1)
      sock.emit_('connect')
      sock.emit_('disconnect', 'io server disconnect')
      vi.advanceTimersByTime(1999); expect(sock.connects).toBe(1)
      vi.advanceTimersByTime(1); expect(sock.connects).toBe(2)
    })
    it('resets backoff after a stable connection', () => {
      vi.useFakeTimers()
      const { s, sock } = mk()
      s.open('s1', 7)
      sock.emit_('connect')
      sock.emit_('disconnect', 'io server disconnect')
      vi.advanceTimersByTime(1000)
      sock.emit_('connect')
      vi.advanceTimersByTime(10000)
      sock.emit_('disconnect', 'io server disconnect')
      vi.advanceTimersByTime(1000); expect(sock.connects).toBe(2)
    })
    it('does not reconnect on transport close, after authError, or after close()', () => {
      vi.useFakeTimers()
      const a = mk(); a.s.open('s1', 7)
      a.sock.emit_('disconnect', 'transport close')
      vi.advanceTimersByTime(60000); expect(a.sock.connects).toBe(0)
      const b = mk(); b.s.open('s1', 7)
      b.sock.emit_('disconnect', 'io server disconnect')
      b.sock.emit_('unauthorized')
      vi.advanceTimersByTime(60000); expect(b.sock.connects).toBe(0)
      const c = mk(); c.s.open('s1', 7)
      c.sock.emit_('disconnect', 'io server disconnect')
      c.s.close()
      vi.advanceTimersByTime(60000); expect(c.sock.connects).toBe(0)
    })
    it('dedupes consecutive identical statuses and ignores stale sockets', () => {
      const { s, sock, statuses } = mk()
      s.open('s1', 7)
      sock.emit_('connect')
      sock.emit_('connect')
      expect(statuses).toEqual(['connecting', 'live'])
      s.close()
      sock.emit_('disconnect', 'io client disconnect')
      expect(statuses).toEqual(['connecting', 'live', 'offline'])
    })
  })
})
