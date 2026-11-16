import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import { decode, encode } from '@msgpack/msgpack'
import { guardClient, ObsCallError } from '../../src/main/obs/guardedClient'
import { ObsController, type ObsClient } from '../../src/main/obs/controller'

/** A client whose calls settle only when the test says so. */
function fakeClient() {
  const ee = new EventEmitter()
  const calls: { req: string; resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = []
  const client: ObsClient = {
    call: (req) => new Promise((resolve, reject) => calls.push({ req, resolve, reject })),
    on: (e, cb) => ee.on(e, cb),
    off: (e, cb) => ee.off(e, cb),
    disconnect: async () => {}
  }
  return { client, calls, close: () => ee.emit('ConnectionClosed', new Error('closed')) }
}

describe('guardClient (issue #6: OBS calls that never settle)', () => {
  it('passes results and OBS errors through', async () => {
    const f = fakeClient()
    const g = guardClient(f.client)
    const a = g.call('GetVersion')
    f.calls[0].resolve({ v: 1 })
    expect(await a).toEqual({ v: 1 })
    const b = g.call('StopStream')
    const err = Object.assign(new Error('not running'), { code: 501 })
    f.calls[1].reject(err)
    await expect(b).rejects.toBe(err)
  })

  it('rejects calls in flight when the connection closes, and later calls at once', async () => {
    const f = fakeClient()
    const g = guardClient(f.client)
    const p = g.call('SetInputSettings', {})
    f.close()
    await expect(p).rejects.toBeInstanceOf(ObsCallError)
    await expect(g.call('GetVersion')).rejects.toThrow('Connexion à OBS perdue.')
  })

  it('rejects calls in flight on disconnect', async () => {
    const f = fakeClient()
    const g = guardClient(f.client)
    const p = g.call('GetSourceScreenshot')
    await g.disconnect()
    await expect(p).rejects.toThrow('Connexion à OBS fermée.')
  })

  it('times out a frozen OBS, giving device requests more time', async () => {
    const f = fakeClient()
    const g = guardClient(f.client, { timeoutMs: 20, slowTimeoutMs: 200 })
    const t0 = Date.now()
    await expect(g.call('StopStream')).rejects.toThrow('OBS ne répond pas (StopStream).')
    expect(Date.now() - t0).toBeLessThan(150)
    const slow = g.call('SetInputSettings')
    let settled = false
    slow.catch(() => (settled = true))
    await new Promise((r) => setTimeout(r, 60))
    expect(settled).toBe(false)
    await expect(slow).rejects.toThrow('OBS ne répond pas (SetInputSettings).')
  })

  it('a late answer after a timeout is ignored', async () => {
    const f = fakeClient()
    const g = guardClient(f.client, { timeoutMs: 10 })
    const p = g.call('GetVersion')
    await expect(p).rejects.toThrow()
    f.calls[0].resolve('late') // no unhandled rejection, no double settle
  })
})

describe('ObsController with the real obs-websocket-js', () => {
  it('an OBS crash during a request rejects it instead of leaving it pending', async () => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0, handleProtocols: () => 'obswebsocket.msgpack' })
    await new Promise<void>((r) => wss.once('listening', () => r()))
    const sockets = new Set<WebSocket>()
    wss.on('connection', (ws) => {
      sockets.add(ws)
      const send = (op: number, d: unknown): void => ws.send(encode({ op, d }))
      send(0, { obsWebSocketVersion: '5.7.2', rpcVersion: 1 })
      ws.on('message', (raw) => {
        const { op, d } = decode(raw as Buffer) as { op: number; d: { requestType: string; requestId: string } }
        if (op === 1) return send(2, { negotiatedRpcVersion: 1 })
        if (op !== 6) return
        if (d.requestType === 'SetInputSettings') return ws.terminate() // OBS died mid-request
        send(7, { requestType: d.requestType, requestId: d.requestId, requestStatus: { result: true, code: 100 }, responseData: {} })
      })
    })
    try {
      const ctl = await ObsController.connect({ port: (wss.address() as AddressInfo).port, password: 'pw' })
      const t0 = Date.now()
      await expect(ctl.setAudioDevice('mic2')).rejects.toThrow()
      expect(Date.now() - t0).toBeLessThan(2000)
    } finally {
      sockets.forEach((s) => s.terminate())
      await new Promise<void>((r) => wss.close(() => r()))
    }
  })
})
