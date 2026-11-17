import { createServer, type Server, type Socket } from 'node:net'
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
    drop: () => sock?.destroy()
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

    const { connect: tcp } = await import('node:net')
    const u = new URL(s.url)
    const obs = tcp({ host: u.hostname, port: Number(u.port) })
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
})
