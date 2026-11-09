import { describe, it, expect, afterEach } from 'vitest'
import { resolve } from 'node:path'
import WebSocket from 'ws'
import { OverlayServer } from '../../src/main/overlay/server'

const pageDir = resolve(__dirname, '../../src/main/overlay/page')
let srv: OverlayServer | null = null
afterEach(async () => { await srv?.stop(); srv = null })

function wsUrl(url: string, k?: string): string {
  const u = new URL(url)
  return `ws://${u.host}/ws?k=${k ?? u.searchParams.get('k')}`
}
function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((res, rej) => { ws.once('message', (d) => res(String(d))); ws.once('close', () => rej(new Error('closed'))) })
}
function collect(ws: WebSocket, n: number): Promise<unknown[]> {
  return new Promise((res, rej) => {
    const out: unknown[] = []
    ws.on('message', (d) => { out.push(JSON.parse(String(d))); if (out.length === n) { ws.close(); res(out) } })
    ws.once('close', () => { if (out.length < n) rej(new Error('closed early: ' + JSON.stringify(out))) })
  })
}
function closed(ws: WebSocket): Promise<void> {
  return new Promise((res) => { ws.once('close', () => res()); ws.once('error', () => undefined) })
}

describe('OverlayServer', () => {
  it('serves the page at / and only whitelisted assets', async () => {
    srv = new OverlayServer({ pageDir })
    const { url } = await srv.start()
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?k=[0-9a-f]+$/)
    const r = await fetch(url)
    expect(r.status).toBe(200)
    expect(await r.text()).toContain('id="band"')
    const base = new URL(url).origin
    expect((await fetch(base + '/overlay.js')).status).toBe(200)
    expect((await fetch(base + '/overlay.css')).status).toBe(200)
    expect((await fetch(base + '/server.ts')).status).toBe(404)
    expect((await fetch(base + '/..%2f..%2fserver.ts')).status).toBe(404)
  })

  it('binds only 127.0.0.1', async () => {
    srv = new OverlayServer({ pageDir })
    const { url } = await srv.start()
    expect((srv as unknown as { server: { address(): { address: string } } }).server.address().address).toBe('127.0.0.1')
    expect(url).toContain('127.0.0.1')
  })

  it('closes ws with wrong or missing k', async () => {
    srv = new OverlayServer({ pageDir })
    const { url } = await srv.start()
    await closed(new WebSocket(wsUrl(url, 'nope')))
    const u = new URL(url)
    await closed(new WebSocket(`ws://${u.host}/ws`))
  })

  it('rejects foreign Origin', async () => {
    srv = new OverlayServer({ pageDir })
    const { url } = await srv.start()
    await closed(new WebSocket(wsUrl(url), { origin: 'http://evil.example' }))
  })

  it('accepts matching Origin and replays reset, last final, last partial to late clients', async () => {
    srv = new OverlayServer({ pageDir })
    const { url } = await srv.start()
    srv.push({ type: 'reset' })
    srv.push({ type: 'final', text: 'a b' })
    srv.push({ type: 'partial', text: 'c' })
    srv.push({ type: 'partial', text: 'c d' })
    const got = await collect(new WebSocket(wsUrl(url), { origin: new URL(url).origin }), 3)
    expect(got).toEqual([{ type: 'reset' }, { type: 'final', text: 'a b' }, { type: 'partial', text: 'c d' }])
    srv.push({ type: 'reset' })
    expect(await collect(new WebSocket(wsUrl(url)), 1)).toEqual([{ type: 'reset' }])
  })

  it('forwards live messages to connected clients', async () => {
    srv = new OverlayServer({ pageDir })
    const { url } = await srv.start()
    const ws = new WebSocket(wsUrl(url))
    await new Promise((r) => ws.once('open', r))
    const p = nextMessage(ws)
    srv.push({ type: 'final', text: 'x' })
    expect(JSON.parse(await p)).toEqual({ type: 'final', text: 'x' })
    ws.close()
  })

  it('serves /layout.js as javascript', async () => {
    srv = new OverlayServer({ pageDir })
    const { url } = await srv.start()
    const r = await fetch(new URL('/layout.js?k=' + new URL(url).searchParams.get('k'), url))
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('text/javascript')
    expect(await r.text()).toContain('SubtitleModel')
    expect((await fetch(new URL('/layout.js', url))).status).toBe(200)
  })
})
