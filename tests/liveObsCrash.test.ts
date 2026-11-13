/**
 * Issue #6: an OBS call in flight when OBS crashes used to never settle, wedging LiveController's queue (the
 * restarted OBS was never re-attached, Arrêter / Démarrer hung). Real obs-websocket-js, ObsController and
 * LiveController against a fake obs-websocket v5 server (msgpack).
 */
import { afterEach, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import { decode, encode } from '@msgpack/msgpack'
import { ObsController } from '../src/main/obs/controller'
import { LiveController, type LiveDeps } from '../src/main/live'
import type { Session, Settings } from '../src/shared/types'

interface FakeObs { port: number; crashOn: string | null; connections: number; close(): Promise<void> }

const RESPONSES: Record<string, unknown> = {
  GetSceneList: { scenes: [{ sceneName: 'LinTO Live' }, { sceneName: 'LinTO Pause' }] },
  GetInputList: { inputs: [{ inputName: 'Salle' }, { inputName: 'Sous-titres' }, { inputName: 'Micro' }] },
  GetSceneItemList: { sceneItems: [{ sourceName: 'Salle' }, { sourceName: 'Sous-titres' }, { sourceName: 'Micro' }] },
  GetSceneItemId: { sceneItemId: 1 },
  GetStreamStatus: { outputActive: false }
}

const servers: FakeObs[] = []
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => s.close())) })

async function fakeObs(): Promise<FakeObs> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0, handleProtocols: () => 'obswebsocket.msgpack' })
  await new Promise<void>((r) => wss.once('listening', () => r()))
  const sockets = new Set<WebSocket>()
  const f: FakeObs = {
    port: (wss.address() as AddressInfo).port, crashOn: null, connections: 0,
    close: () => new Promise<void>((r) => { sockets.forEach((s) => s.terminate()); wss.close(() => r()) })
  }
  wss.on('connection', (ws) => {
    f.connections++
    sockets.add(ws)
    ws.on('close', () => sockets.delete(ws))
    const send = (op: number, d: unknown): void => ws.send(encode({ op, d }))
    send(0, { obsWebSocketVersion: '5.7.2', rpcVersion: 1 })
    ws.on('message', (raw) => {
      const { op, d } = decode(raw as Buffer) as { op: number; d: { requestType: string; requestId: string } }
      if (op === 1) return send(2, { negotiatedRpcVersion: 1 })
      if (op !== 6) return
      if (d.requestType === f.crashOn) return ws.terminate()
      send(7, {
        requestType: d.requestType, requestId: d.requestId, requestStatus: { result: true, code: 100 },
        responseData: RESPONSES[d.requestType] ?? {}
      })
    })
  })
  servers.push(f)
  return f
}

const SESSION: Session = {
  id: 's1', name: 'Conf', status: 'active',
  channels: [{ id: 7, name: 'Conf', streamEndpoints: { srt: 'srt://linto:9000?streamid=a' } }]
}

it('OBS crashing during a camera change: the restarted OBS is re-attached and Arrêter still works', async () => {
  const obs1 = await fakeObs()
  const obs2 = await fakeObs()
  const obs = Object.assign(new EventEmitter(), {
    start: vi.fn(async () => { const c = { port: obs1.port, password: 'pw' }; obs.emit('ready', c); return c }),
    stop: vi.fn(async () => {})
  })
  let data: Settings = { instance: 'https://studio.linto.ai', orgId: 'org1', profileId: 3, videoDeviceId: 'cam', audioDeviceId: 'mic' }
  const live = new LiveController({
    obs,
    controllerFactory: (c: { port: number; password: string }) => ObsController.connect(c),
    api: {
      searchSessions: vi.fn(async () => [SESSION]), getSession: vi.fn(async () => SESSION),
      createSession: vi.fn(async () => SESSION), terminateSession: vi.fn(async () => {})
    },
    captions: Object.assign(new EventEmitter(), { open: vi.fn(), close: vi.fn() }),
    overlay: { start: vi.fn(async () => ({ url: 'http://127.0.0.1:1/?k=t' })), push: vi.fn(), stop: vi.fn(async () => {}) },
    settings: { get: () => ({ ...data }), update: (p: Partial<Settings>) => { data = { ...data, ...p } }, setToken: vi.fn() },
    platform: 'linux'
  } satisfies LiveDeps)
  await live.boot()
  expect(live.getState().obs).toBe('running')

  obs1.crashOn = 'SetInputSettings' // e.g. a capture card that crashes OBS
  const save = live.saveSettings({ videoDeviceId: 'capture-card' })
  await new Promise((r) => setTimeout(r, 200))
  obs.emit('restarting', 1) // what ObsProcess does after the crash
  obs.emit('ready', { port: obs2.port, password: 'pw2' })

  await expect(save).rejects.toThrow()
  await vi.waitFor(() => expect(live.getState().obs).toBe('running'), { timeout: 3000 })
  expect(obs2.connections).toBe(1)
  await live.stop()
}, 10_000)
