/**
 * #6: an OBS request that never settles (OBS crashed or frozen mid-request) must not wedge LiveController's
 * queue. Real LiveController + real ObsController, over a fake obs-websocket client that behaves like
 * obs-websocket-js 5.0.8: on a crash it emits 'ConnectionClosed' and leaves the request pending; frozen, it
 * just never answers.
 */
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { ObsController, type ObsClient } from '../src/main/obs/controller'
import { LiveController, type LiveDeps } from '../src/main/live'
import type { Session, Settings } from '../src/shared/types'

type Action = 'ok' | 'crash' | 'freeze'
const TIMEOUTS = { call: 300, slowCall: 600 }

const RESPONSES: Record<string, unknown> = {
  GetSceneList: { scenes: [{ sceneName: 'LinTO Live' }, { sceneName: 'LinTO Pause' }] },
  GetInputList: { inputs: [{ inputName: 'Salle' }, { inputName: 'Sous-titres' }, { inputName: 'Micro' }] },
  GetSceneItemList: { sceneItems: [{ sourceName: 'Salle' }, { sourceName: 'Sous-titres' }, { sourceName: 'Micro' }] },
  GetSceneItemId: { sceneItemId: 1 },
  GetStreamStatus: { outputActive: false }
}

function fakeObs() {
  const ev = new EventEmitter()
  const o = {
    rule: (_req: string): Action => 'ok',
    requests: [] as string[],
    client: {
      call(req: string) {
        o.requests.push(req)
        const action = o.rule(req)
        if (action === 'crash') {
          queueMicrotask(() => ev.emit('ConnectionClosed', new Error('closed')))
          return new Promise(() => {})
        }
        if (action === 'freeze') return new Promise(() => {})
        if (req === 'StartStream') queueMicrotask(() => ev.emit('StreamStateChanged', { outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' }))
        if (req === 'StopStream') queueMicrotask(() => ev.emit('StreamStateChanged', { outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED' }))
        return Promise.resolve(RESPONSES[req] ?? {})
      },
      on: (e: string, cb: (d: unknown) => void) => ev.on(e, cb),
      off: (e: string, cb: (d: unknown) => void) => ev.off(e, cb),
      disconnect: async () => {}
    } satisfies ObsClient
  }
  return o
}

const SESSION: Session = {
  id: 's1', name: 'Conf', status: 'active',
  channels: [{ id: 7, name: 'Conf', streamEndpoints: { srt: 'srt://linto:9000?streamid=a' } }]
}

/** OBS runs keyed by port: port 1 is the first OBS, port 2 the one ObsProcess restarts after a crash. */
function harness(runs: Record<number, ReturnType<typeof fakeObs>>) {
  const obs = Object.assign(new EventEmitter(), {
    start: vi.fn(async () => {
      const conn = { port: 1, password: 'pw' }
      obs.emit('ready', conn)
      return conn
    }),
    stop: vi.fn(async () => {})
  })
  const controllerFactory = vi.fn(async (c: { port: number }) => new ObsController(runs[c.port].client, TIMEOUTS))
  let data: Settings = { instance: 'https://studio.linto.ai', orgId: 'org1', profileId: 3, videoDeviceId: 'cam', audioDeviceId: 'mic' }
  const live = new LiveController({
    obs,
    controllerFactory,
    api: {
      searchSessions: vi.fn(async () => [SESSION]),
      getSession: vi.fn(async () => SESSION),
      createSession: vi.fn(async () => SESSION),
      terminateSession: vi.fn(async () => {})
    },
    captions: Object.assign(new EventEmitter(), { open: vi.fn(), close: vi.fn() }),
    overlay: { start: vi.fn(async () => ({ url: 'http://127.0.0.1:1/?k=t' })), push: vi.fn(), stop: vi.fn(async () => {}) },
    settings: { get: () => ({ ...data }), update: (p: Partial<Settings>) => { data = { ...data, ...p } }, setToken: vi.fn() },
    platform: 'linux'
  } satisfies LiveDeps)
  const restart = (): void => {
    obs.emit('restarting', 1)
    obs.emit('ready', { port: 2, password: 'pw2' })
  }
  return { live, controllerFactory, restart }
}

describe('LiveController after an OBS crash or freeze mid-request (#6)', () => {
  it('OBS crashes during a camera change: the change fails, the restarted OBS is attached, Arrêter/Démarrer work', async () => {
    const first = fakeObs()
    const second = fakeObs()
    const t = harness({ 1: first, 2: second })
    await t.live.boot()
    expect(t.live.getState().obs).toBe('running')

    first.rule = (req) => (req === 'SetInputSettings' ? 'crash' : 'ok')
    const save = t.live.saveSettings({ videoDeviceId: 'capture-card' })
    await expect(save).rejects.toThrow('Connexion à OBS perdue.')
    t.restart()

    await vi.waitFor(() => expect(t.live.getState().obs).toBe('running'))
    expect(t.controllerFactory).toHaveBeenCalledTimes(2)
    expect(second.requests).toContain('GetSceneList')

    const r = await t.live.start('Conf')
    expect(r.ok).toBe(true)
    await t.live.stop()
    expect(t.live.getState().phase).toBe('idle')
  })

  it('OBS crashes while a restarted OBS is queued: the re-attach is not blocked behind the dead request', async () => {
    const first = fakeObs()
    const second = fakeObs()
    const t = harness({ 1: first, 2: second })
    await t.live.boot()
    first.rule = (req) => (req === 'SetInputSettings' ? 'crash' : 'ok')
    const save = t.live.saveSettings({ audioDeviceId: 'usb-mic' })
    save.catch(() => {})
    await vi.waitFor(() => expect(first.requests).toContain('SetInputSettings')) // the request is in flight
    t.restart() // its attach is queued behind that request, as in the field
    await vi.waitFor(() => expect(t.controllerFactory).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(t.live.getState().obs).toBe('running'))
  })

  it('OBS frozen during Arrêter: stop() completes once the request times out', async () => {
    const first = fakeObs()
    const t = harness({ 1: first })
    await t.live.boot()
    expect((await t.live.start('Conf')).ok).toBe(true)
    await vi.waitFor(() => expect(t.live.getState().stream).toBe('active'))

    first.rule = (req) => (req === 'StopStream' ? 'freeze' : 'ok')
    const t0 = Date.now()
    await t.live.stop()
    expect(Date.now() - t0).toBeLessThan(2_000)
    expect(t.live.getState().phase).toBe('idle')
  })

  it('OBS frozen during a camera change: the next action runs after the timeout', async () => {
    const first = fakeObs()
    const t = harness({ 1: first })
    await t.live.boot()
    first.rule = (req) => (req === 'SetInputSettings' ? 'freeze' : 'ok')
    const save = t.live.saveSettings({ videoDeviceId: 'capture-card' })
    const stop = t.live.stop()
    await expect(save).rejects.toThrow('OBS ne répond pas (SetInputSettings')
    await expect(stop).resolves.toBeUndefined()
  })
})
