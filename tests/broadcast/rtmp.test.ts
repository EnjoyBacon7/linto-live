import { statSync } from 'node:fs'
import { connect as netConnect, createServer, type Server, type Socket } from 'node:net'
import { dirname } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { decode, encode, type Amf } from '../../src/main/broadcast/amf0'
import { ChunkReader, MSG, chunk, endpoint } from '../../src/main/broadcast/rtmp'
import { FlvReader, openBroadcast } from '../../src/main/broadcast/relay'

describe('amf0', () => {
  it('round-trips commands', () => {
    const v: Amf[] = ['connect', 1, { app: 'live2', n: 2.5, ok: true, nested: { x: null } }, null, 'clé']
    expect(decode(encode(...v))).toEqual(v)
  })
  it('throws on truncated data', () => {
    expect(() => decode(encode('abcdef').subarray(0, 4))).toThrow()
  })

  const u16 = (n: number): Buffer => Buffer.from([n >> 8, n & 0xff])
  const u32 = (n: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b }
  const f64 = (n: number): Buffer => { const b = Buffer.alloc(8); b.writeDoubleBE(n); return b }
  const key = (k: string): Buffer => Buffer.concat([u16(k.length), Buffer.from(k)])
  const END = Buffer.from([0, 0, 0x09])

  it('decodes an ECMA array as an object (count ignored, nested values kept)', () => {
    const b = Buffer.concat([
      Buffer.from([0x08]), u32(2),
      key('a'), Buffer.from([0x00]), f64(1.5),
      key('b'), Buffer.from([0x02]), key('x'),
      END
    ])
    expect(decode(b)).toEqual([{ a: 1.5, b: 'x' }])
  })
  it('decodes a long string (32-bit length)', () => {
    const text = 'é'.repeat(70_000) // > 65535 bytes: cannot be a short string
    const body = Buffer.from(text)
    expect(decode(Buffer.concat([Buffer.from([0x0c]), u32(body.length), body, Buffer.from([0x05])]))).toEqual([text, null])
  })
  it('decodes a date as its millisecond timestamp and skips the timezone', () => {
    const b = Buffer.concat([Buffer.from([0x0b]), f64(1_700_000_000_000), u16(0), Buffer.from([0x01, 0x01])])
    expect(decode(b)).toEqual([1_700_000_000_000, true])
  })
  it('decodes a strict array, nested, and undefined', () => {
    const b = Buffer.concat([
      Buffer.from([0x0a]), u32(3), Buffer.from([0x00]), f64(7), Buffer.from([0x06]), Buffer.from([0x0a]), u32(1), Buffer.from([0x02]), key('z')
    ])
    expect(decode(b)).toEqual([[7, undefined, ['z']]])
  })
  it('throws on an unknown type, an unterminated object and a truncated long string', () => {
    expect(() => decode(Buffer.from([0x0d]))).toThrow(/type 13/)
    expect(() => decode(Buffer.from([0xff]))).toThrow(/type 255/)
    expect(() => decode(Buffer.concat([Buffer.from([0x03]), key('a'), Buffer.from([0x05])]))).toThrow()
    expect(() => decode(Buffer.concat([Buffer.from([0x0c]), u32(10), Buffer.from('abc')]))).toThrow()
  })
})

describe('chunks', () => {
  it('reassembles messages split in chunks, across reads, with the peer chunk size and extended timestamps', () => {
    const payload = Buffer.alloc(10_000, 7)
    const bytes = Buffer.concat([
      chunk({ csid: 2, type: MSG.setChunkSize, streamId: 0, timestamp: 0, payload: Buffer.from([0, 0, 0x10, 0]) }, 128),
      chunk({ csid: 6, type: MSG.video, streamId: 1, timestamp: 0x1234567, payload }, 4096),
      chunk({ csid: 3, type: MSG.command, streamId: 0, timestamp: 5, payload: encode('_result', 1) }, 4096)
    ])
    const r = new ChunkReader()
    const got = []
    for (let i = 0; i < bytes.length; i += 333) got.push(...r.push(bytes.subarray(i, i + 333)))
    expect(got.map((m) => [m.type, m.timestamp, m.payload.length])).toEqual([
      [MSG.setChunkSize, 0, 4], [MSG.video, 0x1234567, 10_000], [MSG.command, 5, encode('_result', 1).length]
    ])
    expect(got[1].payload.equals(payload)).toBe(true)
  })
})

describe('endpoint', () => {
  it('app from the path, key as the stream name; port defaults; key in the path when none is given', () => {
    expect(endpoint({ server: 'rtmp://a.rtmp.youtube.com/live2', key: 'k-1' })).toEqual({
      tls: false, host: 'a.rtmp.youtube.com', port: 1935, app: 'live2', tcUrl: 'rtmp://a.rtmp.youtube.com/live2', stream: 'k-1'
    })
    expect(endpoint({ server: 'rtmps://live-api-s.facebook.com:443/rtmp/', key: 'FB-1' })).toMatchObject({
      tls: true, port: 443, app: 'rtmp', stream: 'FB-1'
    })
    expect(endpoint({ server: 'rtmp://h:1940/app/inner/stream', key: null })).toMatchObject({ port: 1940, app: 'app/inner', stream: 'stream' })
    expect(() => endpoint({ server: 'rtmp://h', key: '' })).toThrow('Clé de stream manquante.')
  })
})

describe('FlvReader', () => {
  it('skips the header and yields tags across reads', () => {
    const tag = (type: number, ts: number, body: Buffer): Buffer => {
      const h = Buffer.alloc(11)
      h[0] = type
      h.writeUIntBE(body.length, 1, 3)
      h.writeUIntBE(ts & 0xffffff, 4, 3)
      h[7] = ts >>> 24
      const prev = Buffer.alloc(4)
      prev.writeUInt32BE(11 + body.length)
      return Buffer.concat([h, body, prev])
    }
    const flv = Buffer.concat([
      Buffer.from('FLV\x01\x05\x00\x00\x00\x09\x00\x00\x00\x00', 'latin1'),
      tag(18, 0, Buffer.from('meta')), tag(9, 0x01000010, Buffer.from('video')), tag(8, 40, Buffer.from('a'))
    ])
    const r = new FlvReader()
    const got = []
    for (let i = 0; i < flv.length; i += 5) got.push(...r.push(flv.subarray(i, i + 5)))
    expect(got.map((t) => [t.type, t.timestamp, t.body.toString()])).toEqual([[18, 0, 'meta'], [9, 0x01000010, 'video'], [8, 40, 'a']])
  })
})

/** A scripted RTMP server: handshake, then answers commands as `reply` decides; records what it got. */
function fakeServer(reply: (cmd: Amf[], send: (streamId: number, ...v: Amf[]) => void) => void) {
  const commands: Amf[][] = []
  const media: number[] = []
  let sock: Socket | null = null
  const server: Server = createServer((s) => {
    sock = s
    let hs = Buffer.alloc(0)
    let ready = false
    const reader = new ChunkReader()
    const send = (streamId: number, ...v: Amf[]): void => {
      s.write(chunk({ csid: 3, type: MSG.command, streamId, timestamp: 0, payload: encode(...v) }, 128))
    }
    s.on('data', (d: Buffer) => {
      if (!ready) {
        hs = Buffer.concat([hs, d])
        if (hs.length >= 1537 && hs.length < 1537 + 1536 && !(s as Socket & { sent?: boolean }).sent) {
          ;(s as Socket & { sent?: boolean }).sent = true
          s.write(Buffer.concat([Buffer.from([3]), Buffer.alloc(1536, 1), hs.subarray(1, 1537)]))
        }
        if (hs.length < 1537 + 1536) return
        ready = true
        d = hs.subarray(1537 + 1536)
      }
      for (const m of reader.push(d)) {
        if (m.type === MSG.command) {
          const v = decode(m.payload)
          commands.push(v)
          reply(v, send)
        } else if (m.type === MSG.audio || m.type === MSG.video || m.type === MSG.data) media.push(m.type)
      }
    })
    s.on('error', () => {})
  })
  return {
    commands, media, server,
    listen: () => new Promise<number>((r) => server.listen(0, '127.0.0.1', () => r((server.address() as { port: number }).port))),
    drop: () => sock?.destroy(),
    /** Stops reading from the client, as a slow platform would: its TCP window fills up. */
    hold: () => sock?.pause(),
    release: () => sock?.resume()
  }
}

const accepting = (cmd: Amf[], send: (id: number, ...v: Amf[]) => void): void => {
  const [name, txn] = cmd
  if (name === 'connect') send(0, '_result', txn as number, { fmsVer: 'FMS/3' }, { code: 'NetConnection.Connect.Success' })
  if (name === 'createStream') send(0, '_result', txn as number, null, 1)
  if (name === 'publish') send(1, 'onStatus', 0, null, { level: 'status', code: 'NetStream.Publish.Start' })
}

describe('openBroadcast (RTMP session)', () => {
  const servers: Server[] = []
  afterEach(() => servers.splice(0).forEach((s) => s.close()))

  it('connects to the app and publishes the stream key, then forwards OBS FLV tags as RTMP messages', async () => {
    const f = fakeServer(accepting)
    servers.push(f.server)
    const port = await f.listen()
    const s = await openBroadcast({ server: `rtmp://127.0.0.1:${port}/live2/`, key: 'k-123' })
    const connect = f.commands.find((c) => c[0] === 'connect')!
    expect(connect[2]).toMatchObject({ app: 'live2', tcUrl: `rtmp://127.0.0.1:${port}/live2` })
    expect(f.commands.find((c) => c[0] === 'publish')!.slice(3)).toEqual(['k-123', 'live'])

    expect(s.url).toMatch(/^unix:\//)
    const sockPath = s.url.slice('unix:'.length)
    // Private: the directory is the user's only (no other local user can reach the socket).
    expect(statSync(dirname(sockPath)).mode & 0o777).toBe(0o700)
    const obs = netConnect({ path: sockPath })
    await new Promise((r) => obs.once('connect', r))
    // A second producer (another local process) is turned away: the socket accepts only one.
    const intruder = netConnect({ path: sockPath })
    await new Promise((r) => intruder.once('error', r).once('close', r))
    const tag = (type: number, body: string): Buffer => {
      const h = Buffer.alloc(11)
      h[0] = type
      h.writeUIntBE(body.length, 1, 3)
      return Buffer.concat([h, Buffer.from(body), Buffer.from([0, 0, 0, 11 + body.length])])
    }
    obs.write(Buffer.concat([Buffer.from('FLV\x01\x05\x00\x00\x00\x09\x00\x00\x00\x00', 'latin1'), tag(18, 'm'), tag(9, 'v'), tag(8, 'a')]))
    for (let i = 0; i < 50 && f.media.length < 3; i++) await new Promise((r) => setTimeout(r, 10))
    expect(f.media).toEqual([MSG.data, MSG.video, MSG.audio])
    s.close()
    obs.destroy()
    expect(() => statSync(dirname(sockPath))).toThrow() // removed with the session
  })

  it('a refused key rejects with the server reason, the key redacted', async () => {
    const f = fakeServer((cmd, send) => {
      if (cmd[0] === 'publish') {
        send(1, 'onStatus', 0, null, { level: 'error', code: 'NetStream.Publish.BadName', description: 'k-123 is not a valid stream key' })
      } else accepting(cmd, send)
    })
    servers.push(f.server)
    const port = await f.listen()
    const err = await openBroadcast({ server: `rtmp://127.0.0.1:${port}/live2`, key: 'k-123' }).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain('NetStream.Publish.BadName')
    expect((err as Error).message).toContain('••• is not a valid stream key')
    expect((err as Error).message).not.toContain('k-123')
  })

  it('a refused connect rejects', async () => {
    const f = fakeServer((cmd, send) => {
      if (cmd[0] === 'connect') send(0, '_error', cmd[1] as number, null, { code: 'NetConnection.Connect.Rejected' })
    })
    servers.push(f.server)
    const port = await f.listen()
    await expect(openBroadcast({ server: `rtmp://127.0.0.1:${port}/app`, key: 'k' })).rejects.toThrow(/Connect\.Rejected/)
  })

  it('reports the platform dropping the connection during the broadcast', async () => {
    const f = fakeServer(accepting)
    servers.push(f.server)
    const port = await f.listen()
    const s = await openBroadcast({ server: `rtmp://127.0.0.1:${port}/live2`, key: 'k' })
    const closed = new Promise<Error | null>((r) => s.onClose(r))
    f.drop()
    expect(await closed).toBeInstanceOf(Error)
  })

  const flvHeader = Buffer.from('FLV\x01\x05\x00\x00\x00\x09\x00\x00\x00\x00', 'latin1')
  const flvTag = (type: number, body: Buffer): Buffer => {
    const h = Buffer.alloc(11)
    h[0] = type
    h.writeUIntBE(body.length, 1, 3)
    const prev = Buffer.alloc(4)
    prev.writeUInt32BE(11 + body.length)
    return Buffer.concat([h, body, prev])
  }
  const until = async (cond: () => boolean, ms: number): Promise<void> => {
    for (const end = Date.now() + ms; Date.now() < end && !cond(); ) await new Promise((r) => setTimeout(r, 20))
  }

  it('a non-FLV first chunk destroys OBS socket and ends the platform session', async () => {
    const f = fakeServer(accepting)
    servers.push(f.server)
    const port = await f.listen()
    const s = await openBroadcast({ server: `rtmp://127.0.0.1:${port}/live2`, key: 'k' })
    const closed = new Promise<Error | null>((r) => s.onClose(r))
    const obs = netConnect({ path: s.url.slice('unix:'.length) })
    const obsClosed = new Promise<void>((r) => obs.once('close', () => r()))
    obs.on('error', () => {})
    await new Promise((r) => obs.once('connect', r))
    obs.write(Buffer.from('GET / HTTP/1.1\r\nHost: x\r\n\r\n'))
    await obsClosed
    expect(await closed).toBeNull()
    expect(f.commands.some((c) => c[0] === 'deleteStream')).toBe(true)
    s.close()
  })

  it('backpressure: a slow platform pauses OBS socket, and every tag is delivered once it drains', async () => {
    const f = fakeServer(accepting)
    servers.push(f.server)
    const port = await f.listen()
    const s = await openBroadcast({ server: `rtmp://127.0.0.1:${port}/live2`, key: 'k' })
    const obs = netConnect({ path: s.url.slice('unix:'.length) })
    obs.on('error', () => {})
    await new Promise((r) => obs.once('connect', r))
    f.hold()
    const total = 300
    const body = Buffer.alloc(128 * 1024, 1) // ~38 MB: far beyond the socket buffers
    obs.write(flvHeader)
    for (let i = 0; i < total; i++) obs.write(flvTag(9, body))
    await new Promise((r) => setTimeout(r, 300))
    expect(f.media.length).toBeLessThan(total) // the platform is not reading yet
    f.release()
    await until(() => f.media.length >= total, 15_000)
    expect(f.media.length).toBe(total)
    s.close()
    obs.destroy()
  }, 30_000)
})
