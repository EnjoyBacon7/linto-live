import { createServer, type Server } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import type { Watermark } from '../../shared/types'

/** How the subtitle band looks: the app's local settings plus the on-air session's watermark. */
export interface OverlayStyle {
  /** Subtitle band shown at all. */
  visible: boolean
  /** Font size in px on the 1920×1080 canvas. */
  fontSize: number
  watermark: Watermark
}

export type OverlayMessage =
  | { type: 'reset' }
  | { type: 'partial' | 'final'; text: string }
  | ({ type: 'style' } & OverlayStyle)

const ASSETS: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/overlay.css': { file: 'overlay.css', type: 'text/css; charset=utf-8' },
  '/overlay.js': { file: 'overlay.js', type: 'text/javascript; charset=utf-8' },
  '/layout.js': { file: 'layout.js', type: 'text/javascript; charset=utf-8' },
  '/watermark.js': { file: 'watermark.js', type: 'text/javascript; charset=utf-8' },
  '/img/linto.svg': { file: 'img/linto.svg', type: 'image/svg+xml' },
  '/img/linagora.png': { file: 'img/linagora.png', type: 'image/png' }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export class OverlayServer {
  private server: Server | null = null
  private wss: WebSocketServer | null = null
  // Replay state (bounded): last final since the last reset, and last partial after that final.
  private lastFinal: string | null = null
  private lastPartial: string | null = null
  /** Last style message, replayed first to every new client (a caption reset does not clear it). */
  private lastStyle: string | null = null
  private token = ''

  constructor(private opts: { pageDir: string }) {}

  async start(): Promise<{ url: string }> {
    this.token = randomBytes(16).toString('hex')
    const server = createServer((req, res) => {
      const path = (req.url ?? '/').split('?')[0]
      const asset = req.method === 'GET' ? ASSETS[path] : undefined
      if (!asset) { res.writeHead(404).end('Not found'); return }
      readFile(join(this.opts.pageDir, asset.file)).then(
        (buf) => { res.writeHead(200, { 'Content-Type': asset.type, 'Cache-Control': 'no-store' }).end(buf) },
        () => { res.writeHead(500).end('Error') }
      )
    })
    const wss = new WebSocketServer({ noServer: true })
    this.server = server
    this.wss = wss

    server.on('upgrade', (req, socket, head) => {
      const reject = (): void => { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy() }
      const port = (server.address() as AddressInfo).port
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
      const origin = req.headers.origin
      if (url.pathname !== '/ws') return reject()
      if (origin !== undefined && origin !== `http://127.0.0.1:${port}`) return reject()
      if (!safeEqual(url.searchParams.get('k') ?? '', this.token)) return reject()
      wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
        if (this.lastStyle !== null) ws.send(this.lastStyle)
        ws.send(JSON.stringify({ type: 'reset' }))
        if (this.lastFinal !== null) ws.send(this.lastFinal)
        if (this.lastPartial !== null) ws.send(this.lastPartial)
      })
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const { port } = server.address() as AddressInfo
    return { url: `http://127.0.0.1:${port}/?k=${this.token}` }
  }

  push(msg: OverlayMessage): void {
    const data = JSON.stringify(msg)
    if (msg.type === 'style') this.lastStyle = data
    else if (msg.type === 'reset') { this.lastFinal = null; this.lastPartial = null }
    else if (msg.type === 'final') { this.lastFinal = data; this.lastPartial = null }
    else this.lastPartial = data
    for (const c of this.wss?.clients ?? []) if (c.readyState === 1) c.send(data)
  }

  async stop(): Promise<void> {
    const { server, wss } = this
    this.server = null
    this.wss = null
    if (wss) for (const c of wss.clients) c.terminate()
    wss?.close()
    if (server) await new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections() })
  }
}
