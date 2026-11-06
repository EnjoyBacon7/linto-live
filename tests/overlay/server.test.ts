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
    expect(await r.text()).toContain('id="captions"')
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

  it('accepts matching Origin and replays last view to late clients', async () => {
    srv = new OverlayServer({ pageDir })
    const { url } = await srv.start()
    srv.push({ lines: ['a', 'b'], partial: true })
    const ws = new WebSocket(wsUrl(url), { origin: new URL(url).origin })
    expect(JSON.parse(await nextMessage(ws))).toEqual({ lines: ['a', 'b'], partial: true })
    const p = nextMessage(ws)
    srv.push({ lines: ['c'], partial: false })
    expect(JSON.parse(await p)).toEqual({ lines: ['c'], partial: false })
    ws.close()
  })
})
