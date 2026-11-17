import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { endpoint, RtmpPublisher, type PublishTarget } from './rtmp'

/**
 * Online broadcast without handing the stream key to OBS: OBS's FFmpeg output sends FLV to a Unix socket of
 * the app (`unix:<path>`, nothing secret), and the app publishes it to the platform over RTMP(S). OBS
 * would otherwise keep the key in its profile and write it to its log whenever the connection fails.
 * The socket lives in a fresh 0700 directory: only the user's own processes can reach it (a loopback TCP
 * port would let any local process connect first and broadcast its own video on the user's channel).
 */
export interface BroadcastSession {
  /** Where OBS sends the FLV stream. */
  url: string
  /** The platform connection ended by itself (error), or close() was called (null). Called once. */
  onClose(cb: (e: Error | null) => void): void
  close(): void
}

const OPEN_TIMEOUT_MS = 10_000
const FLV_HEADER = 9 + 4 // signature header + PreviousTagSize0

/** Reads FLV tags off a byte stream: (type, timestamp, body) for each complete tag. */
export class FlvReader {
  private buf: Buffer = Buffer.alloc(0)
  private headerDone = false

  push(data: Buffer): { type: number; timestamp: number; body: Buffer }[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, data]) : data
    const out: { type: number; timestamp: number; body: Buffer }[] = []
    if (!this.headerDone) {
      if (this.buf.length < FLV_HEADER) return out
      if (this.buf.toString('latin1', 0, 3) !== 'FLV') throw new Error('flux FLV invalide')
      const skip = this.buf.readUInt32BE(5) + 4
      if (this.buf.length < skip) return out
      this.buf = this.buf.subarray(skip)
      this.headerDone = true
    }
    while (this.buf.length >= 11) {
      const size = this.buf.readUIntBE(1, 3)
      if (this.buf.length < 11 + size + 4) break
      const type = this.buf[0] & 0x1f
      const timestamp = (this.buf.readUIntBE(4, 3) | (this.buf[7] << 24)) >>> 0
      out.push({ type, timestamp, body: this.buf.subarray(11, 11 + size) })
      this.buf = this.buf.subarray(11 + size + 4)
    }
    return out
  }
}

/**
 * Connects to the platform and publishes (rejects with the reason, key never included), then waits for
 * OBS on a private Unix socket. Only the first connection is taken.
 */
export async function openBroadcast(target: PublishTarget): Promise<BroadcastSession> {
  const pub = new RtmpPublisher(endpoint(target))
  await pub.open(OPEN_TIMEOUT_MS)

  let obs: Socket | null = null
  const server: Server = createServer({ pauseOnConnect: false }, (sock) => {
    if (obs) {
      sock.destroy()
      return
    }
    obs = sock
    server.close() // nobody else can connect from now on
    const flv = new FlvReader()
    sock.on('data', (d: Buffer) => {
      let tags
      try {
        tags = flv.push(d)
      } catch {
        sock.destroy()
        return
      }
      let full = false
      for (const t of tags) if (!pub.sendTag(t.type, t.timestamp, t.body)) full = true
      if (full) {
        sock.pause()
        pub.drain(() => sock.resume())
      }
    })
    sock.on('error', () => {})
    // OBS stopped its output (Arrêter, or it gave up): the platform sees the end of the stream.
    sock.on('close', () => pub.close())
  })
  // mkdtemp creates the directory 0700. Short base (os.tmpdir): socket paths are limited to ~104 bytes.
  const dir = mkdtempSync(join(tmpdir(), 'linto-live-'))
  const path = join(dir, 'obs.sock')
  const cleanup = (): void => {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(path, () => resolve())
    })
  } catch (e) {
    cleanup()
    pub.close()
    throw e
  }
  pub.onClose(() => {
    cleanup()
    ;(obs as Socket | null)?.destroy() // the platform is gone: OBS's output stops and reports it
  })
  return {
    url: `unix:${path}`,
    onClose: (cb) => pub.onClose(cb),
    close: () => {
      cleanup()
      pub.close()
      ;(obs as Socket | null)?.destroy()
    }
  }
}
