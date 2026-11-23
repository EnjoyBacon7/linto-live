import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

const sockets: FakeSocket[] = []
class FakeSocket extends EventEmitter {
  destroyed = false
  written = 0
  setNoDelay(): void {}
  write(): boolean { this.written++; return true }
  end(): void {}
  destroy(): this { this.destroyed = true; return this }
  connectNow(): void { this.emit('connect') }
}
vi.mock('node:net', () => ({
  connect: (_o: unknown, cb: () => void) => {
    const s = new FakeSocket()
    s.once('connect', cb)
    sockets.push(s)
    return s
  }
}))

import { RtmpPublisher, endpoint } from '../../src/main/broadcast/rtmp'

describe('RtmpPublisher.open timeout while connecting', () => {
  it('destroys the pending socket and never handshakes on it', async () => {
    const pub = new RtmpPublisher(endpoint({ server: 'rtmp://127.0.0.1:1935/app', key: 'k' }))
    await expect(pub.open(30)).rejects.toThrow('ne répond pas')
    const s = sockets[0]
    expect(s.destroyed).toBe(true)
    s.connectNow() // the connect finally succeeds after the timeout
    await new Promise((r) => setTimeout(r, 20))
    expect(s.written).toBe(0)
    expect(s.destroyed).toBe(true)
  })
})
