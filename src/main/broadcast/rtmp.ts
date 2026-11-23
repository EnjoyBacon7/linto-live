import { randomBytes } from 'node:crypto'
import { connect as netConnect, type Socket } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import { decode, encode, type Amf } from './amf0'

/**
 * Minimal RTMP publisher (Adobe RTMP 1.0 spec): simple handshake, connect / releaseStream / FCPublish /
 * createStream / publish, then audio, video and metadata messages. What OBS and FFmpeg send to YouTube,
 * Twitch or any RTMP server; RTMPS is the same over TLS.
 */

export const MSG = {
  setChunkSize: 1, ack: 3, userControl: 4, windowAckSize: 5, setPeerBandwidth: 6,
  audio: 8, video: 9, data: 18, command: 20
} as const

export interface RtmpMessage { csid: number; type: number; streamId: number; timestamp: number; payload: Buffer }

const EXTENDED = 0xffffff

/** Splits a message into chunks (type 0 header, then type 3 continuations). */
export function chunk(m: RtmpMessage, chunkSize: number): Buffer {
  const ext = m.timestamp >= EXTENDED
  const header = Buffer.alloc(12 + (ext ? 4 : 0))
  header[0] = m.csid & 0x3f
  header.writeUIntBE(ext ? EXTENDED : m.timestamp, 1, 3)
  header.writeUIntBE(m.payload.length, 4, 3)
  header[7] = m.type
  header.writeUInt32LE(m.streamId, 8)
  if (ext) header.writeUInt32BE(m.timestamp >>> 0, 12)
  const parts: Buffer[] = [header]
  for (let off = 0; off < m.payload.length; off += chunkSize) {
    if (off > 0) {
      parts.push(Buffer.from([0xc0 | (m.csid & 0x3f)]))
      if (ext) {
        const t = Buffer.alloc(4)
        t.writeUInt32BE(m.timestamp >>> 0)
        parts.push(t)
      }
    }
    parts.push(m.payload.subarray(off, off + chunkSize))
  }
  return Buffer.concat(parts)
}

interface ChunkState { timestamp: number; delta: number; length: number; type: number; streamId: number; ext: boolean; parts: Buffer[]; got: number }

/** Reassembles the messages of an incoming chunk stream (all four header types, extended timestamps). */
export class ChunkReader {
  chunkSize = 128
  private buf: Buffer = Buffer.alloc(0)
  private states = new Map<number, ChunkState>()

  push(data: Buffer): RtmpMessage[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, data]) : data
    const out: RtmpMessage[] = []
    for (;;) {
      const m = this.readOne()
      if (m === null) break
      if (m !== undefined) {
        if (m.type === MSG.setChunkSize && m.payload.length >= 4) this.chunkSize = m.payload.readUInt32BE(0) & 0x7fffffff
        out.push(m)
      }
    }
    return out
  }

  /** null: not enough bytes yet; undefined: a chunk was consumed without completing a message. */
  private readOne(): RtmpMessage | null | undefined {
    const b = this.buf
    if (b.length < 1) return null
    const fmt = b[0] >> 6
    let csid = b[0] & 0x3f
    let i = 1
    if (csid === 0) {
      if (b.length < 2) return null
      csid = 64 + b[1]
      i = 2
    } else if (csid === 1) {
      if (b.length < 3) return null
      csid = 64 + b[1] + b[2] * 256
      i = 3
    }
    const hlen = [11, 7, 3, 0][fmt]
    if (b.length < i + hlen) return null
    const prev = this.states.get(csid)
    if (fmt !== 0 && !prev) throw new Error('RTMP : en-tête de chunk sans contexte')
    const s: ChunkState = prev ? { ...prev } : { timestamp: 0, delta: 0, length: 0, type: 0, streamId: 0, ext: false, parts: [], got: 0 }
    let tsField = 0
    if (fmt <= 2) tsField = b.readUIntBE(i, 3)
    if (fmt <= 1) {
      s.length = b.readUIntBE(i + 3, 3)
      s.type = b[i + 6]
    }
    if (fmt === 0) s.streamId = b.readUInt32LE(i + 7)
    i += hlen
    const ext = fmt <= 2 ? tsField === EXTENDED : s.ext
    if (ext) {
      if (b.length < i + 4) return null
      tsField = b.readUInt32BE(i)
      i += 4
    }
    const starting = s.got === 0
    if (fmt === 0) s.timestamp = tsField
    else if (fmt <= 2) s.delta = tsField
    if (starting && fmt !== 0) s.timestamp += fmt === 3 ? s.delta : tsField
    s.ext = ext
    const n = Math.min(this.chunkSize, s.length - s.got)
    if (b.length < i + n) return null
    s.parts = starting ? [] : s.parts
    s.parts.push(b.subarray(i, i + n))
    s.got += n
    this.buf = b.subarray(i + n)
    if (s.got < s.length) {
      this.states.set(csid, s)
      return undefined
    }
    const payload = Buffer.concat(s.parts)
    this.states.set(csid, { ...s, parts: [], got: 0 })
    return { csid, type: s.type, streamId: s.streamId, timestamp: s.timestamp, payload }
  }
}

/** Where to publish: `server` is the platform's RTMP(S) address, `key` its stream key (the stream name). */
export interface PublishTarget { server: string; key: string | null }

interface Endpoint { tls: boolean; host: string; port: number; app: string; tcUrl: string; stream: string }

/**
 * `rtmp://host[:port]/app` + key. Without a key, the last path segment is the stream name
 * (`rtmp://host/app/stream`), as in OBS's custom server.
 */
export function endpoint({ server, key }: PublishTarget): Endpoint {
  const u = new URL(server.trim())
  const tls = u.protocol === 'rtmps:'
  if (!tls && u.protocol !== 'rtmp:') throw new Error('Adresse de serveur RTMP invalide.')
  let path = u.pathname.replace(/^\/+|\/+$/g, '')
  let stream = key?.trim() ?? ''
  if (!stream) {
    const cut = path.lastIndexOf('/')
    if (cut < 0) throw new Error('Clé de stream manquante.')
    stream = path.slice(cut + 1)
    path = path.slice(0, cut)
  }
  const app = path + u.search
  const port = u.port ? Number(u.port) : tls ? 443 : 1935
  return { tls, host: u.hostname, port, app, tcUrl: `${u.protocol}//${u.host}/${app}`, stream }
}

const OUT_CHUNK = 4096
const CSID_COMMAND = 3
const CSID_DATA = 4
const CSID_AUDIO = 5
const CSID_VIDEO = 6

/** An RTMP publishing session: `ready` once the server accepted the stream (NetStream.Publish.Start). */
export class RtmpPublisher {
  private socket: Socket | null = null
  private reader = new ChunkReader()
  private streamId = 0
  private txn = 0
  private pending = new Map<number, { resolve: (v: Amf[]) => void; reject: (e: Error) => void }>()
  private publishWaiter: { resolve: () => void; reject: (e: Error) => void } | null = null
  private received = 0
  private acked = 0
  private window = 2_500_000
  private closeListeners: ((e: Error | null) => void)[] = []
  private closed = false

  constructor(private readonly target: Endpoint) {}

  /** Connects, handshakes and publishes; rejects with a message that never contains the key. */
  async open(timeoutMs: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error('le serveur de diffusion ne répond pas.')), timeoutMs)
    })
    try {
      await Promise.race([this.doOpen(), timeout])
    } catch (e) {
      this.destroy()
      throw new Error(this.redact(e instanceof Error ? e.message : String(e)))
    } finally {
      clearTimeout(timer)
    }
  }

  private async doOpen(): Promise<void> {
    const t = this.target
    const sock = await new Promise<Socket>((resolve, reject) => {
      const s: Socket = t.tls
        ? tlsConnect({ host: t.host, port: t.port, servername: t.host }, () => resolve(s))
        : netConnect({ host: t.host, port: t.port }, () => resolve(s))
      s.once('error', reject)
      this.socket = s // known while connecting, so destroy() on a timeout can kill it
      if (this.closed) s.destroy()
    })
    if (this.closed) {
      sock.destroy()
      throw new Error('session fermée.')
    }
    sock.setNoDelay(true)
    await this.handshake(sock)
    sock.on('data', (d: Buffer) => this.onData(d))
    sock.on('error', (e) => this.finish(new Error(`connexion au serveur de diffusion perdue (${e.message}).`)))
    sock.on('close', () => this.finish(new Error('le serveur de diffusion a fermé la connexion.')))

    this.send({ csid: 2, type: MSG.setChunkSize, streamId: 0, timestamp: 0, payload: u32(OUT_CHUNK) })
    await this.call('connect', {
      app: t.app, type: 'nonprivate', flashVer: 'FMLE/3.0 (compatible; FMSc/1.0)', swfUrl: t.tcUrl, tcUrl: t.tcUrl
    })
    this.notify('releaseStream', t.stream)
    this.notify('FCPublish', t.stream)
    const created = await this.call('createStream')
    this.streamId = typeof created[3] === 'number' ? created[3] : 1
    await new Promise<void>((resolve, reject) => {
      this.publishWaiter = { resolve, reject }
      this.send(command(this.streamId, ['publish', ++this.txn, null, t.stream, 'live']))
    })
  }

  private async handshake(sock: Socket): Promise<void> {
    const c1 = Buffer.alloc(1536)
    randomBytes(1528).copy(c1, 8)
    sock.write(Buffer.concat([Buffer.from([3]), c1]))
    let got = Buffer.alloc(0)
    const s0s1s2 = await new Promise<Buffer>((resolve, reject) => {
      const onData = (d: Buffer): void => {
        got = Buffer.concat([got, d])
        if (got.length >= 1 + 1536 * 2) {
          sock.off('data', onData)
          sock.off('close', onClose)
          resolve(got)
        }
      }
      const onClose = (): void => reject(new Error('le serveur de diffusion a refusé la connexion.'))
      sock.on('data', onData)
      sock.once('close', onClose)
    })
    if (s0s1s2[0] !== 3) throw new Error(`version RTMP ${s0s1s2[0]} non prise en charge.`)
    sock.write(s0s1s2.subarray(1, 1537)) // C2 = S1
    const rest = s0s1s2.subarray(1 + 1536 * 2)
    if (rest.length) queueMicrotask(() => this.onData(rest))
  }

  private onData(d: Buffer): void {
    this.received += d.length
    if (this.received - this.acked >= this.window) {
      this.acked = this.received
      this.send({ csid: 2, type: MSG.ack, streamId: 0, timestamp: 0, payload: u32(this.received >>> 0) })
    }
    let msgs: RtmpMessage[]
    try {
      msgs = this.reader.push(d)
    } catch (e) {
      return this.finish(e as Error)
    }
    for (const m of msgs) this.onMessage(m)
  }

  private onMessage(m: RtmpMessage): void {
    if (m.type === MSG.windowAckSize && m.payload.length >= 4) this.window = m.payload.readUInt32BE(0)
    else if (m.type === MSG.userControl && m.payload.length >= 6 && m.payload.readUInt16BE(0) === 6) {
      // PingRequest → PingResponse with the same time.
      const r = Buffer.alloc(6)
      r.writeUInt16BE(7)
      m.payload.copy(r, 2, 2, 6)
      this.send({ csid: 2, type: MSG.userControl, streamId: 0, timestamp: 0, payload: r })
    } else if (m.type === MSG.command) {
      let v: Amf[]
      try {
        v = decode(m.payload)
      } catch {
        return
      }
      const [name, txn] = v
      if ((name === '_result' || name === '_error') && typeof txn === 'number') {
        const p = this.pending.get(txn)
        if (!p) return
        this.pending.delete(txn)
        if (name === '_result') p.resolve(v)
        else p.reject(new Error(`connexion refusée par le serveur (${describe(v[3])}).`))
      } else if (name === 'onStatus') this.onStatus(v[3])
    }
  }

  private onStatus(info: Amf): void {
    const code = info && typeof info === 'object' && !Array.isArray(info) ? info.code : undefined
    const w = this.publishWaiter
    if (code === 'NetStream.Publish.Start') {
      this.publishWaiter = null
      w?.resolve()
    } else if (typeof code === 'string' && /Failed|BadName|Rejected|Error|Unpublish/.test(code)) {
      const e = new Error(`le serveur refuse la diffusion (${describe(info)}) : vérifier la clé de stream.`)
      if (w) {
        this.publishWaiter = null
        w.reject(e)
      } else this.finish(e)
    }
  }

  private call(name: string, ...args: Amf[]): Promise<Amf[]> {
    const txn = ++this.txn
    return new Promise((resolve, reject) => {
      this.pending.set(txn, { resolve, reject })
      this.send(command(0, [name, txn, ...(args.length ? args : [null])]))
    })
  }

  private notify(name: string, ...args: Amf[]): void {
    this.send(command(0, [name, ++this.txn, null, ...args]))
  }

  private send(m: RtmpMessage): boolean {
    const s = this.socket
    if (!s || this.closed) return false
    return s.write(chunk(m, OUT_CHUNK))
  }

  /** FLV tag → RTMP message; false: the socket's buffer is full (wait for drain()). */
  sendTag(type: number, timestamp: number, body: Buffer): boolean {
    if (type === MSG.audio) return this.send({ csid: CSID_AUDIO, type, streamId: this.streamId, timestamp, payload: body })
    if (type === MSG.video) return this.send({ csid: CSID_VIDEO, type, streamId: this.streamId, timestamp, payload: body })
    if (type === MSG.data) {
      const payload = Buffer.concat([encode('@setDataFrame'), body])
      return this.send({ csid: CSID_DATA, type, streamId: this.streamId, timestamp, payload })
    }
    return true
  }

  drain(cb: () => void): void {
    this.socket?.once('drain', cb)
  }

  /** The session ended by itself (error) or was closed (null). Called once. */
  onClose(cb: (e: Error | null) => void): void {
    if (this.closed) cb(null)
    else this.closeListeners.push(cb)
  }

  /** Ends the stream politely (FCUnpublish, deleteStream), then closes. */
  close(): void {
    if (this.closed) return
    if (this.streamId) {
      this.notify('FCUnpublish', this.target.stream)
      this.notify('deleteStream', this.streamId)
    }
    this.socket?.end()
    this.finish(null)
  }

  private destroy(): void {
    this.closed = true
    this.socket?.destroy()
    this.closeListeners = []
  }

  private finish(e: Error | null): void {
    if (this.closed) return
    this.closed = true
    const err = e && new Error(this.redact(e.message))
    for (const p of this.pending.values()) p.reject(err ?? new Error('fermé'))
    this.pending.clear()
    this.publishWaiter?.reject(err ?? new Error('fermé'))
    this.publishWaiter = null
    if (e) this.socket?.destroy()
    const l = this.closeListeners
    this.closeListeners = []
    l.forEach((cb) => cb(err))
  }

  /** A server may echo the stream name: it never reaches a message. */
  private redact(s: string): string {
    const k = this.target.stream
    return k ? s.split(k).join('•••') : s
  }
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}

function command(streamId: number, values: Amf[]): RtmpMessage {
  return { csid: CSID_COMMAND, type: MSG.command, streamId, timestamp: 0, payload: encode(...values) }
}

function describe(info: Amf): string {
  if (info && typeof info === 'object' && !Array.isArray(info)) {
    const parts = [info.code, info.description].filter((x): x is string => typeof x === 'string' && x !== '')
    if (parts.length) return parts.join(' : ')
  }
  return 'sans détail'
}
