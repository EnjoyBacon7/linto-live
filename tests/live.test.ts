import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import {
  LiveController, MSG_BOOT_FAILED, MSG_NO_STREAM, MSG_OBS_DOWN, MSG_OBS_NOT_READY, MSG_OBS_RESTARTED, MSG_OBS_SETUP_FAILED,
  MSG_OUTPUT_FAILED, MSG_OVERLAY_FAILED, MSG_STREAM_RETRY, msgTerminated,
  type LiveDeps
} from '../src/main/live'
import type { StreamState } from '../src/main/obs/controller'
import type { LiveState } from '../src/shared/ipc'
import { UnauthorizedError, type Session, type Settings, type TranscriptUpdate } from '../src/shared/types'

const SRT_A = 'srt://linto:9000?streamid=a'
const SRT_B = 'srt://linto:9000?streamid=b'

function session(over: Partial<Session> = {}, endpoint: string | null = SRT_A): Session {
  return {
    id: 's1',
    name: 'Conf',
    status: 'active',
    channels: [{ id: 7, name: 'Conf', ...(endpoint ? { streamEndpoints: { srt: endpoint } } : {}) }],
    ...over
  }
}

function fakeController(log: string[]) {
  let stateCb: ((s: StreamState) => void) | null = null
  const c = {
    autoStop: true,
    /** stopStream() result: false = OBS answered "output not running" (e.g. still connecting). */
    stopSent: true,
    ensureScene: vi.fn(async () => {}),
    listVideoDevices: vi.fn(async () => [{ id: 'cam', name: 'Cam' }]),
    listAudioDevices: vi.fn(async () => [{ id: 'mic', name: 'Mic' }]),
    setVideoDevice: vi.fn(async () => {}),
    setAudioDevice: vi.fn(async () => {}),
    setOverlayUrl: vi.fn(async () => {}),
    audioLevel$: vi.fn(() => () => {}),
    startStream: vi.fn(async (s: { streamServiceSettings: { server: string } }) => {
      log.push(`startStream:${s.streamServiceSettings.server}`)
    }),
    stopStream: vi.fn(async (): Promise<boolean> => {
      log.push('stopStream')
      if (c.stopSent && c.autoStop) queueMicrotask(() => stateCb?.('stopped'))
      return c.stopSent
    }),
    streamState$: vi.fn((cb: (s: StreamState) => void) => {
      stateCb = cb
      return () => {
        if (stateCb === cb) stateCb = null
      }
    }),
    openOutputWindow: vi.fn(async () => {
      log.push('output-window')
    }),
    showLive: vi.fn(async () => {
      log.push('showLive')
    }),
    showPause: vi.fn(async () => {
      log.push('showPause')
    }),
    resetProjectorState: vi.fn(),
    disconnect: vi.fn(async () => {}),
    emitState: (s: StreamState) => stateCb?.(s)
  }
  return c
}
type FakeCtl = ReturnType<typeof fakeController>

function setup(opts: { sessions?: Session[] } = {}) {
  const log: string[] = []
  const ctls: FakeCtl[] = []
  let port = 4000
  const obs = Object.assign(new EventEmitter(), {
    start: vi.fn(async () => {
      const conn = { port: port++, password: 'pw' }
      obs.emit('ready', conn)
      return conn
    }),
    stop: vi.fn(async () => {
      log.push('obs.stop')
      obs.emit('exit', 0)
    })
  })
  const controllerFactory = vi.fn(async () => {
    const c = fakeController(log)
    ctls.push(c)
    return c
  })
  const sessions = opts.sessions ?? [session()]
  const api = {
    searchSessions: vi.fn(async (_o: string, _n: string) => sessions),
    getSession: vi.fn(async (_o: string, id: string) => sessions.find((s) => s.id === id)!),
    createSession: vi.fn(async () => session({ id: 'new' })),
    terminateSession: vi.fn(async () => {
      log.push('terminateSession')
    })
  }
  const captions = Object.assign(new EventEmitter(), {
    open: vi.fn((sid: string, ch: number) => {
      log.push(`captions.open:${sid}/${ch}`)
    }),
    close: vi.fn(() => {
      log.push('captions.close')
    })
  })
  const overlay = {
    start: vi.fn(async () => ({ url: 'http://127.0.0.1:5555/?k=t' })),
    push: vi.fn(),
    stop: vi.fn(async () => {})
  }
  let data: Settings = {
    instance: 'https://studio.linto.ai',
    orgId: 'org1',
    profileId: 3,
    videoDeviceId: 'cam',
    audioDeviceId: 'mic'
  }
  const settings = {
    get: vi.fn(() => ({ ...data })),
    update: vi.fn((p: Partial<Settings>) => {
      data = { ...data, ...p }
    }),
    setToken: vi.fn(),
    getToken: vi.fn(() => 'tok')
  }
  const deps = { obs, controllerFactory, api, captions, overlay, settings, platform: 'darwin' as const } satisfies LiveDeps
  const live = new LiveController(deps)
  const states: LiveState[] = []
  live.on('state', (s: LiveState) => states.push(s))
  const ctl = (): FakeCtl => ctls[ctls.length - 1]
  return { live, obs, controllerFactory, ctls, ctl, api, captions, overlay, settings, log, states, last: () => live.getState() }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('LiveController', () => {
  it('boot starts overlay and obs, ensures scene, applies saved devices and overlay url', async () => {
    const t = setup()
    await t.live.boot()
    expect(t.overlay.start).toHaveBeenCalled()
    expect(t.obs.start).toHaveBeenCalledTimes(1)
    expect(t.ctl().ensureScene).toHaveBeenCalledWith('darwin')
    expect(t.ctl().resetProjectorState).toHaveBeenCalled()
    expect(t.ctl().setVideoDevice).toHaveBeenCalledWith('cam')
    expect(t.ctl().setAudioDevice).toHaveBeenCalledWith('mic')
    expect(t.ctl().setOverlayUrl).toHaveBeenCalledWith('http://127.0.0.1:5555/?k=t')
    expect(t.last().obs).toBe('running')
    expect(t.last().phase).toBe('idle')
  })

  it('start reused session streams and projects', async () => {
    const t = setup()
    await t.live.boot()
    const r = await t.live.start('  Conf ')
    expect(r).toEqual({ ok: true, reused: true, canStream: true })
    expect(t.captions.open).toHaveBeenCalledWith('s1', 7)
    expect(t.overlay.push).toHaveBeenCalledWith({ type: 'reset' })
    expect(t.ctl().startStream).toHaveBeenCalledWith({
      streamServiceType: 'rtmp_custom',
      streamServiceSettings: { server: SRT_A, key: '' }
    })
    expect(t.ctl().showLive).toHaveBeenCalled()
    expect(t.ctl().openOutputWindow).toHaveBeenCalledTimes(1)
    expect(t.settings.get().lastSessionName).toBe('Conf')
    expect(t.settings.get().orgId).toBe('org1')
    expect(t.last()).toMatchObject({ phase: 'live', output: 'shown', session: { name: 'Conf', status: 'active' } })
    expect(t.last().warning).toBeUndefined()

    t.ctl().emitState('active')
    expect(t.last().stream).toBe('active')
    t.captions.emit('status', 'live')
    expect(t.last().captions).toBe('live')

    const updates: TranscriptUpdate[] = []
    t.live.on('transcript', (u: TranscriptUpdate) => updates.push(u))
    const nStates = t.states.length
    t.captions.emit('partial', { segmentId: 1, text: 'Bonjour' })
    t.captions.emit('final', { segmentId: 1, text: 'Bonjour à tous', locutor: 'Alice' })
    expect(t.overlay.push).toHaveBeenLastCalledWith({ type: 'final', text: 'Bonjour à tous' })
    expect(updates).toEqual([
      { kind: 'partial', segment: { id: 1, text: 'Bonjour' } },
      { kind: 'final', segment: { id: 1, text: 'Bonjour à tous', locutor: 'Alice' } }
    ])
    expect(t.states.length).toBe(nStates) // captions never re-send the live state

    t.overlay.push.mockClear()
    await t.live.stop()
    expect(t.overlay.push).toHaveBeenCalledWith({ type: 'reset' })
    // The transcript outlives the show, until the next start.
    expect(t.live.getTranscript()).toEqual({ finals: [{ id: 1, text: 'Bonjour à tous', locutor: 'Alice' }], partial: null })
    await t.live.start('Conf')
    expect(updates.at(-1)).toEqual({ kind: 'reset' })
    expect(t.live.getTranscript()).toEqual({ finals: [], partial: null })
  })

  it('terminated returns message and starts nothing', async () => {
    const t = setup({ sessions: [session({ status: 'terminated' })] })
    await t.live.boot()
    const r = await t.live.start('Conf')
    expect(r).toEqual({
      ok: false,
      message: 'La session « Conf » est terminée et ne peut pas être reprise. Choisis un autre nom.'
    })
    expect(t.captions.open).not.toHaveBeenCalled()
    expect(t.ctl().startStream).not.toHaveBeenCalled()
    expect(t.ctl().openOutputWindow).not.toHaveBeenCalled()
    expect(t.ctl().showLive).not.toHaveBeenCalled()
    expect(t.last().phase).toBe('idle')
  })

  it('skips streaming when no endpoint', async () => {
    const t = setup({ sessions: [session({}, null)] })
    await t.live.boot()
    const r = await t.live.start('Conf')
    expect(r).toEqual({ ok: true, reused: true, canStream: false })
    expect(t.ctl().startStream).not.toHaveBeenCalled()
    expect(t.captions.open).toHaveBeenCalledWith('s1', 7)
    expect(t.ctl().openOutputWindow).toHaveBeenCalledTimes(1)
    expect(t.last()).toMatchObject({ phase: 'live', stream: 'unavailable', warning: MSG_NO_STREAM })
    expect(MSG_NO_STREAM).toBe("Impossible d'envoyer l'audio : tu n'es pas propriétaire de cette session.")
  })

  it('reapplies live state after obs restart', async () => {
    const t = setup()
    await t.live.boot()
    await t.live.start('Conf')
    const first = t.ctl()
    t.obs.emit('restarting', 1)
    expect(t.last().obs).toBe('restarting')
    t.obs.emit('ready', { port: 4100, password: 'pw2' })
    await t.live.settled()
    expect(t.controllerFactory).toHaveBeenCalledTimes(2)
    expect(t.controllerFactory).toHaveBeenLastCalledWith({ port: 4100, password: 'pw2' })
    const c = t.ctl()
    expect(c).not.toBe(first)
    expect(c.ensureScene).toHaveBeenCalledWith('darwin')
    expect(c.resetProjectorState).toHaveBeenCalled()
    expect(c.setVideoDevice).toHaveBeenCalledWith('cam')
    expect(c.setAudioDevice).toHaveBeenCalledWith('mic')
    expect(c.setOverlayUrl).toHaveBeenCalledWith('http://127.0.0.1:5555/?k=t')
    expect(c.startStream).toHaveBeenCalledWith({ streamServiceType: 'rtmp_custom', streamServiceSettings: { server: SRT_A, key: '' } })
    expect(c.showLive).toHaveBeenCalled()
    expect(c.openOutputWindow).toHaveBeenCalledTimes(1)
    expect(t.last()).toMatchObject({ phase: 'live', obs: 'running', output: 'shown' })
    // old controller events are ignored (the only warning is the crash-restart notice, no stream retry)
    first.emitState('stopped')
    expect(t.last().warning).toBe(MSG_OBS_RESTARTED)
  })

  it('obs exit after giving up sets obs down and phase error', async () => {
    const t = setup()
    await t.live.boot()
    await t.live.start('Conf')
    t.obs.emit('exit', null)
    expect(t.last()).toMatchObject({ obs: 'down', phase: 'error', warning: MSG_OBS_DOWN })
  })

  it('obs exit after giving up during a show tears the show down (captions, session, timers)', async () => {
    const t = setup()
    await t.live.boot()
    await t.live.start('Conf')
    t.captions.emit('status', 'offline') // arms the stale-captions probe
    t.api.getSession.mockClear()
    t.obs.emit('exit', null)
    expect(t.captions.close).toHaveBeenCalled()
    const s = t.last()
    expect(s).toMatchObject({ obs: 'down', phase: 'error', stream: 'off', captions: 'offline', warning: MSG_OBS_DOWN })
    expect(s).not.toHaveProperty('session')
    expect(s).not.toHaveProperty('startedAt')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(t.api.getSession).not.toHaveBeenCalled()
    // Arrêter still works and returns to idle
    await t.live.stop()
    expect(t.last().phase).toBe('idle')
  })

  it('keeps obs running on auth error', async () => {
    const t = setup()
    await t.live.boot()
    await t.live.start('Conf')
    const authReq = vi.fn()
    t.live.on('auth-required', authReq)
    t.captions.emit('authError')
    expect(authReq).toHaveBeenCalledTimes(1)
    expect(t.last()).toMatchObject({ phase: 'live', captions: 'offline', output: 'shown' })
    expect(t.ctl().stopStream).not.toHaveBeenCalled()
    expect(t.ctl().showPause).not.toHaveBeenCalled()
    expect(t.obs.stop).not.toHaveBeenCalled()
    expect(t.settings.setToken).not.toHaveBeenCalled()
  })

  it('resumeCaptions reopens same session', async () => {
    const t = setup()
    await t.live.boot()
    await t.live.start('Conf')
    t.captions.emit('authError')
    t.live.resumeCaptions()
    expect(t.captions.open).toHaveBeenCalledTimes(2)
    expect(t.captions.open).toHaveBeenLastCalledWith('s1', 7)
  })

  it('unauthorized during start when not live clears token and asks for login', async () => {
    const t = setup()
    await t.live.boot()
    t.api.searchSessions.mockRejectedValueOnce(new UnauthorizedError())
    const authReq = vi.fn()
    t.live.on('auth-required', authReq)
    const r = await t.live.start('Conf')
    expect(r.ok).toBe(false)
    expect(authReq).toHaveBeenCalled()
    expect(t.settings.setToken).toHaveBeenCalledWith(null)
    expect(t.last().phase).toBe('idle')
  })

  it('stop does not call terminateSession', async () => {
    const t = setup()
    await t.live.boot()
    await t.live.start('Conf')
    await t.live.stop()
    expect(t.api.terminateSession).not.toHaveBeenCalled()
    expect(t.ctl().stopStream).toHaveBeenCalled()
    expect(t.ctl().showPause).toHaveBeenCalled()
    expect(t.captions.close).toHaveBeenCalled()
    expect(t.last()).toMatchObject({ phase: 'idle', stream: 'off', output: 'shown' }) // window kept open, black
    expect(t.last().warning).toBeUndefined()
  })

  it('terminate stops the stream, terminates the session, then tears down captions', async () => {
    const t = setup()
    await t.live.boot()
    await t.live.start('Conf')
    t.ctl().emitState('active')
    t.log.length = 0
    const states = t.states.length
    await t.live.terminate()
    expect(t.api.terminateSession).toHaveBeenCalledWith('org1', 's1')
    expect(t.log.indexOf('stopStream')).toBeGreaterThanOrEqual(0)
    expect(t.log.indexOf('stopStream')).toBeLessThan(t.log.indexOf('terminateSession'))
    expect(t.log.indexOf('terminateSession')).toBeLessThan(t.log.indexOf('captions.close'))
    expect(t.log).toContain('showPause')
    expect(t.last().phase).toBe('idle')
    // no false stream error / retry on the way
    expect(t.states.slice(states).some((s) => s.stream === 'error' || s.warning === MSG_STREAM_RETRY)).toBe(false)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(t.ctl().startStream).toHaveBeenCalledTimes(1)
  })

  it('a failed terminate resumes the stream and keeps the show live', async () => {
    const t = setup()
    await t.live.boot()
    await t.live.start('Conf')
    t.ctl().emitState('active')
    t.api.terminateSession.mockRejectedValueOnce(new Error('LinTO HTTP 500'))
    await expect(t.live.terminate()).rejects.toThrow('LinTO HTTP 500')
    expect(t.last().phase).toBe('live')
    expect(t.ctl().startStream).toHaveBeenCalledTimes(2)
    expect(t.captions.close).not.toHaveBeenCalled()
  })

  it('waits for stopped before switching target', async () => {
    const t = setup({ sessions: [session(), session({ id: 's2', name: 'Autre' }, SRT_B)] })
    t.api.searchSessions.mockImplementation(async (_o: string, name: string) =>
      [session(), session({ id: 's2', name: 'Autre' }, SRT_B)].filter((s) => s.name === name)
    )
    await t.live.boot()
    await t.live.start('Conf')
    const c = t.ctl()
    c.emitState('active')
    c.autoStop = false
    const p = t.live.start('Autre')
    await flush()
    expect(c.stopStream).toHaveBeenCalledTimes(1)
    expect(c.startStream).toHaveBeenCalledTimes(1)
    c.emitState('stopped')
    const r = await p
    expect(r).toEqual({ ok: true, reused: true, canStream: true })
    expect(c.startStream).toHaveBeenCalledTimes(2)
    expect(c.startStream).toHaveBeenLastCalledWith({ streamServiceType: 'rtmp_custom', streamServiceSettings: { server: SRT_B, key: '' } })
    expect(t.log.indexOf('stopStream')).toBeLessThan(t.log.lastIndexOf(`startStream:${SRT_B}`))
    expect(t.last().warning).toBeUndefined()
    expect(t.last().session?.name).toBe('Autre')
  })

  it('Arrêter during the SRT connect is prompt; a stream that connects afterwards is stopped', async () => {
    const t = setup()
    await t.live.boot()
    await t.live.start('Conf')
    const c = t.ctl()
    c.emitState('starting')
    c.stopSent = false // OBS: output not running yet
    let done = false
    const p = t.live.stop().then(() => (done = true))
    await flush()
    expect(done).toBe(true) // no 10 s wait for a 'stopped' that will not come
    await p
    expect(t.last()).toMatchObject({ phase: 'idle', stream: 'off' })
    c.stopStream.mockClear()
    c.stopSent = true
    c.emitState('active') // the connect succeeded after Arrêter
    expect(c.stopStream).toHaveBeenCalledTimes(1)
    await flush()
    expect(t.last()).toMatchObject({ phase: 'idle', stream: 'off' })
    expect(t.last().warning).toBeUndefined()
  })

  it('a stream becoming active while idle is stopped', async () => {
    const t = setup()
    await t.live.boot()
    const c = t.ctl()
    c.emitState('starting')
    c.emitState('active')
    expect(c.stopStream).toHaveBeenCalled()
    expect(t.last()).toMatchObject({ phase: 'idle', stream: 'off' })
  })

  it('serializes concurrent start and stop', async () => {
    const t = setup()
    await t.live.boot()
    const a = t.live.start('Conf')
    const b = t.live.stop()
    await Promise.all([a, b])
    expect(t.log.indexOf(`startStream:${SRT_A}`)).toBeLessThan(t.log.indexOf('stopStream'))
    expect(t.last().phase).toBe('idle')
  })

  it('retries stream after unrequested stop', async () => {
    const t = setup()
    await t.live.boot()
    await t.live.start('Conf')
    const c = t.ctl()
    c.emitState('active')
    c.emitState('stopped')
    expect(t.last()).toMatchObject({ phase: 'live', stream: 'error', warning: MSG_STREAM_RETRY })
    expect(MSG_STREAM_RETRY).toBe('Envoi audio interrompu — nouvelle tentative…')
    expect(c.startStream).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1999)
    expect(c.startStream).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(c.startStream).toHaveBeenCalledTimes(2)
    c.emitState('stopped')
    await vi.advanceTimersByTimeAsync(4999)
    expect(c.startStream).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(c.startStream).toHaveBeenCalledTimes(3)
    c.startStream.mockRejectedValueOnce(new Error('nope'))
    c.emitState('stopped')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(c.startStream).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(c.startStream).toHaveBeenCalledTimes(5)
    c.emitState('active')
    expect(t.last()).toMatchObject({ stream: 'active' })
    expect(t.last().warning).toBeUndefined()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(c.startStream).toHaveBeenCalledTimes(5)
  })

  it('shutdown stops then quits obs and overlay', async () => {
    const t = setup()
    await t.live.boot()
    await t.live.start('Conf')
    await t.live.shutdown()
    expect(t.ctl().stopStream).toHaveBeenCalled()
    expect(t.obs.stop).toHaveBeenCalled()
    expect(t.overlay.stop).toHaveBeenCalled()
    expect(t.api.terminateSession).not.toHaveBeenCalled()
    expect(t.log.indexOf('stopStream')).toBeLessThan(t.log.indexOf('obs.stop'))
  })

  describe('recovery paths', () => {
    it('boot failure (after every retry) shows obs down with a warning', async () => {
      const t = setup()
      t.obs.start.mockRejectedValue(new Error('spawn ENOENT'))
      const p = t.live.boot()
      const done = expect(p).rejects.toThrow()
      await vi.advanceTimersByTimeAsync(2_000 + 5_000 + 10_000 + 30_000)
      await done
      expect(t.obs.start).toHaveBeenCalledTimes(5)
      expect(t.last()).toMatchObject({ obs: 'down', warning: MSG_BOOT_FAILED })
      expect(MSG_BOOT_FAILED).toBe('Impossible de démarrer le moteur vidéo (OBS).')
    })

    it('overlay url failure still marks obs running and reapplies the show', async () => {
      const t = setup()
      await t.live.boot()
      await t.live.start('Conf')
      t.controllerFactory.mockImplementationOnce(async () => {
        const c = fakeController(t.log)
        c.setOverlayUrl.mockRejectedValue(new Error('no browser source'))
        t.ctls.push(c)
        return c
      })
      t.obs.emit('restarting', 1)
      t.obs.emit('ready', { port: 1, password: 'x' })
      await t.live.settled()
      expect(t.last()).toMatchObject({ obs: 'running', phase: 'live', output: 'shown' })
      expect(t.last().warning).toBe(MSG_OVERLAY_FAILED + 'no browser source')
      expect(t.ctl().startStream).toHaveBeenCalled()
      expect(t.ctl().openOutputWindow).toHaveBeenCalledTimes(1)
    })

    it('ensureScene failure sets obs down with a warning', async () => {
      const t = setup()
      t.controllerFactory.mockImplementationOnce(async () => {
        const c = fakeController(t.log)
        c.ensureScene.mockRejectedValue(new Error('scene boom'))
        t.ctls.push(c)
        return c
      })
      await expect(t.live.boot()).rejects.toThrow()
      expect(t.last().obs).toBe('down')
      expect(t.ctl().disconnect).toHaveBeenCalled()
      t.obs.emit('ready', { port: 2, password: 'y' })
      await t.live.settled()
      expect(t.last().obs).toBe('running')
      expect(t.last().warning).toBeUndefined()
      expect(MSG_OBS_SETUP_FAILED).toMatch(/OBS/)
    })

    it('failed session switch while live keeps the transcript and stream supervision', async () => {
      const t = setup()
      await t.live.boot()
      await t.live.start('Conf')
      const c = t.ctl()
      c.emitState('active')
      t.api.searchSessions.mockImplementationOnce(
        () => new Promise((_, rej) => setTimeout(() => rej(new Error('LinTO HTTP 500')), 1_000))
      )
      t.captions.emit('final', { segmentId: 1, text: 'Bonjour' })
      const p = t.live.start('Autre')
      await vi.advanceTimersByTimeAsync(400)
      c.emitState('stopped') // stream drops during resolution: still supervised
      expect(t.last()).toMatchObject({ phase: 'live', stream: 'error', warning: MSG_STREAM_RETRY })
      await vi.advanceTimersByTimeAsync(600)
      expect(await p).toEqual({ ok: false, message: 'LinTO HTTP 500' })
      expect(t.last()).toMatchObject({ phase: 'live', session: { name: 'Conf' } })
      await vi.advanceTimersByTimeAsync(2_000)
      expect(c.startStream).toHaveBeenCalledTimes(2)
      expect(t.live.getTranscript().finals).toEqual([{ id: 1, text: 'Bonjour' }])
    })

    it('shutdown waits at most 3 s for the stream to stop', async () => {
      const t = setup()
      await t.live.boot()
      await t.live.start('Conf')
      t.ctl().emitState('active')
      t.ctl().autoStop = false
      let done = false
      const p = t.live.shutdown().then(() => (done = true))
      await vi.advanceTimersByTimeAsync(2_999)
      expect(done).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await p
      expect(t.obs.stop).toHaveBeenCalled()
    })
  })
})

describe('LiveController final fixes', () => {
  describe('output window', () => {
    const opened = (t: ReturnType<typeof setup>): number => t.log.filter((l) => l === 'output-window').length

    it('the first start opens the window once; stop then start does not open a second one', async () => {
      const t = setup()
      await t.live.boot()
      expect(opened(t)).toBe(0)
      await t.live.start('Conf')
      expect(opened(t)).toBe(1)
      expect(t.last().output).toBe('shown')
      await t.live.stop()
      expect(t.ctl().showPause).toHaveBeenCalled() // kept open, black
      await t.live.start('Conf')
      expect(opened(t)).toBe(1)
      expect(t.last()).toMatchObject({ phase: 'live', output: 'shown' })
      expect(t.obs.stop).not.toHaveBeenCalled()
    })

    it('showOutputWindow opens another window even if one is open', async () => {
      const t = setup()
      await t.live.boot()
      await t.live.start('Conf')
      await t.live.showOutputWindow()
      expect(opened(t)).toBe(2)
      expect(t.last().output).toBe('shown')
      await t.live.stop()
      await t.live.showOutputWindow() // idle but attached: still opens
      expect(opened(t)).toBe(3)
      expect(t.obs.stop).not.toHaveBeenCalled()
    })

    it('showOutputWindow without OBS attached does nothing', async () => {
      const t = setup()
      await expect(t.live.showOutputWindow()).resolves.toBeUndefined()
      expect(opened(t)).toBe(0)
      expect(t.last().output).toBe('off')
    })

    it('after an OBS restart the next live show opens the window again', async () => {
      const t = setup()
      await t.live.boot()
      await t.live.start('Conf')
      await t.live.stop()
      t.obs.emit('restarting', 1)
      expect(t.last().output).toBe('off')
      t.obs.emit('ready', { port: 4300, password: 'p' })
      await t.live.settled()
      expect(opened(t)).toBe(1) // idle: nothing reopened by the attach
      await t.live.start('Conf')
      expect(opened(t)).toBe(2)
      expect(t.ctl().openOutputWindow).toHaveBeenCalledTimes(1)
      expect(t.last().output).toBe('shown')
    })

    it('a failure to open the window is reported and retried on the next start', async () => {
      const t = setup()
      await t.live.boot()
      t.ctl().openOutputWindow.mockRejectedValueOnce(new Error('nope'))
      const r = await t.live.start('Conf')
      expect(r.ok).toBe(true)
      expect(t.ctl().startStream).toHaveBeenCalled()
      expect(t.last()).toMatchObject({ phase: 'live', output: 'off', warning: 'Fenêtre de sortie : nope' })
      await t.live.stop()
      await t.live.start('Conf')
      expect(opened(t)).toBe(1)
      expect(t.last().output).toBe('shown')
    })

    it('startedAt is set when the session goes live and cleared on stop', async () => {
      const t = setup()
      await t.live.boot()
      expect(t.last().startedAt).toBeUndefined()
      const before = Date.now()
      await t.live.start('Conf')
      const at = t.last().startedAt
      expect(typeof at).toBe('number')
      expect(at!).toBeGreaterThanOrEqual(before)
      expect(at!).toBeLessThanOrEqual(Date.now())
      await t.live.stop()
      expect(t.last()).not.toHaveProperty('startedAt')
    })
  })

  describe('transcript', () => {
    it('a partial left when the show stops is dropped; the finals stay', async () => {
      const t = setup()
      await t.live.boot()
      await t.live.start('Conf')
      const updates: TranscriptUpdate[] = []
      t.live.on('transcript', (u: TranscriptUpdate) => updates.push(u))
      t.captions.emit('final', { segmentId: 1, text: 'Bonjour' })
      t.captions.emit('partial', { segmentId: 2, text: 'et bien' })
      t.captions.emit('partial', { segmentId: 3, text: '   ' }) // blank: ignored
      expect(t.live.getTranscript().partial).toEqual({ id: 2, text: 'et bien' })
      await t.live.stop()
      expect(updates.at(-1)).toEqual({ kind: 'partial', segment: null })
      expect(t.live.getTranscript()).toEqual({ finals: [{ id: 1, text: 'Bonjour' }], partial: null })
    })
  })

  describe('without a camera (plain LinTO client)', () => {
    it('Démarrer streams and transcribes but opens no output window', async () => {
      const t = setup()
      await t.live.saveSettings({ videoDeviceId: '' })
      await t.live.boot()
      expect(t.ctl().setVideoDevice).not.toHaveBeenCalled()
      await t.live.start('Conf')
      expect(t.ctl().startStream).toHaveBeenCalled()
      expect(t.captions.open).toHaveBeenCalledWith('s1', 7)
      expect(t.ctl().openOutputWindow).not.toHaveBeenCalled()
      expect(t.last()).toMatchObject({ phase: 'live', output: 'off' })
      await t.live.showOutputWindow() // still available on demand (menu)
      expect(t.ctl().openOutputWindow).toHaveBeenCalledTimes(1)
    })

    it('choosing a camera during the show opens the output window once', async () => {
      const t = setup()
      await t.live.saveSettings({ videoDeviceId: '' })
      await t.live.boot()
      await t.live.start('Conf')
      await t.live.saveSettings({ videoDeviceId: 'cam' })
      expect(t.ctl().openOutputWindow).toHaveBeenCalledTimes(1)
      expect(t.last().output).toBe('shown')
      await t.live.saveSettings({ videoDeviceId: 'cam2' })
      expect(t.ctl().openOutputWindow).toHaveBeenCalledTimes(1)
    })
  })

  it('choosing no camera empties the OBS video source', async () => {
    const t = setup()
    await t.live.boot()
    await t.live.saveSettings({ videoDeviceId: '' })
    expect(t.ctl().setVideoDevice).toHaveBeenLastCalledWith('')
  })

  describe('audio level only while someone looks at it', () => {
    it('audio levels are not forwarded while the window is hidden', async () => {
      const t = setup()
      await t.live.boot()
      const cb = (t.ctl().audioLevel$.mock.calls as unknown as [(db: number) => void][])[0][0]
      const levels: number[] = []
      t.live.on('audio-level', (db: number) => levels.push(db))
      cb(-20)
      t.live.setWindowVisible(false)
      cb(-10)
      t.live.setWindowVisible(true)
      cb(-5)
      expect(levels).toEqual([-20, -5])
    })
  })

  describe('I2 OBS down is recoverable', () => {
    it('boot retries obs start with backoff', async () => {
      const t = setup()
      t.obs.start.mockRejectedValueOnce(new Error('not yet'))
      const p = t.live.boot()
      await vi.advanceTimersByTimeAsync(2_000)
      await p
      expect(t.obs.start).toHaveBeenCalledTimes(2)
      expect(t.last().obs).toBe('running')
      expect(t.last().warning).toBeUndefined()
    })

    it('start when obs is down restarts obs first, then goes live', async () => {
      const t = setup()
      await t.live.boot()
      await t.live.start('Conf')
      t.obs.emit('exit', null) // restarts exhausted
      expect(t.last()).toMatchObject({ obs: 'down', phase: 'error' })
      const r = await t.live.start('Conf')
      await t.live.settled()
      expect(r).toEqual({ ok: true, reused: true, canStream: true })
      expect(t.obs.start).toHaveBeenCalledTimes(2)
      expect(t.controllerFactory).toHaveBeenCalledTimes(2) // the queued 'ready' does not attach twice
      expect(t.ctl().startStream).toHaveBeenCalledTimes(1)
      expect(t.log.filter((l) => l === 'output-window')).toHaveLength(2)
      expect(t.last()).toMatchObject({ phase: 'live', obs: 'running', output: 'shown' })
      expect(t.last().warning).toBeUndefined()
    })

    it('start after an attach failure restarts obs', async () => {
      const t = setup()
      t.controllerFactory.mockImplementationOnce(async () => {
        const c = fakeController(t.log)
        c.ensureScene.mockRejectedValue(new Error('scene boom'))
        t.ctls.push(c)
        return c
      })
      await expect(t.live.boot()).rejects.toThrow()
      const r = await t.live.start('Conf')
      expect(r.ok).toBe(true)
      expect(t.obs.stop).toHaveBeenCalledTimes(1)
      expect(t.obs.start).toHaveBeenCalledTimes(2)
      expect(t.last()).toMatchObject({ phase: 'live', obs: 'running' })
    })

    it('start when obs cannot be restarted reports the failure', async () => {
      const t = setup()
      await t.live.boot()
      t.obs.emit('exit', null)
      t.obs.start.mockRejectedValue(new Error('dead'))
      const p = t.live.start('Conf')
      await vi.advanceTimersByTimeAsync(2_000 + 5_000 + 10_000 + 30_000)
      expect(await p).toEqual({ ok: false, message: MSG_BOOT_FAILED })
      expect(t.last()).toMatchObject({ obs: 'down', warning: MSG_BOOT_FAILED })
      expect(t.captions.open).not.toHaveBeenCalled()
    })

    it('start while obs is still booting is refused without killing the booting OBS', async () => {
      const t = setup()
      let release: () => void = () => {}
      t.obs.start.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => {
              const conn = { port: 4900, password: 'pw' }
              t.obs.emit('ready', conn)
              resolve(conn)
            }
          })
      )
      const boot = t.live.boot()
      await flush()
      expect(await t.live.start('Conf')).toEqual({ ok: false, message: MSG_OBS_NOT_READY })
      expect(t.obs.stop).not.toHaveBeenCalled()
      expect(t.obs.start).toHaveBeenCalledTimes(1)
      release()
      await boot
      expect(t.last().obs).toBe('running')
      expect((await t.live.start('Conf')).ok).toBe(true)
      expect(t.obs.start).toHaveBeenCalledTimes(1)
    })

    it('start while obs is restarting is refused', async () => {
      const t = setup()
      await t.live.boot()
      t.obs.emit('restarting', 1)
      expect(await t.live.start('Conf')).toEqual({ ok: false, message: MSG_OBS_NOT_READY })
    })

    it('a crash restart shows a notice, cleared by the next start or stop', async () => {
      const t = setup()
      await t.live.boot()
      await t.live.start('Conf')
      t.obs.emit('restarting', 1)
      t.obs.emit('ready', { port: 4200, password: 'p' })
      await t.live.settled()
      expect(t.last().warning).toBe(MSG_OBS_RESTARTED)
      expect(MSG_OBS_RESTARTED).toBe('OBS a redémarré automatiquement.')
      await t.live.stop()
      expect(t.last().warning).toBeUndefined()
      t.obs.emit('restarting', 1)
      t.obs.emit('ready', { port: 4201, password: 'p' })
      await t.live.settled()
      expect(t.last().warning).toBe(MSG_OBS_RESTARTED)
      await t.live.start('Conf')
      expect(t.last().warning).toBeUndefined()
    })
  })

  describe('I4 captions offline while live', () => {
    it('after 30 s offline probes the session; 401 asks for login and stops the captions', async () => {
      const t = setup()
      await t.live.boot()
      await t.live.start('Conf')
      const authReq = vi.fn()
      t.live.on('auth-required', authReq)
      t.api.getSession.mockClear()
      t.api.getSession.mockRejectedValue(new UnauthorizedError())
      t.captions.emit('status', 'offline')
      await vi.advanceTimersByTimeAsync(29_999)
      expect(t.api.getSession).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(t.api.getSession).toHaveBeenCalledWith('org1', 's1')
      expect(authReq).toHaveBeenCalledTimes(1)
      expect(t.captions.close).toHaveBeenCalled()
      expect(t.settings.setToken).not.toHaveBeenCalled()
      expect(t.last()).toMatchObject({ phase: 'live', captions: 'offline' })
      t.captions.emit('status', 'offline')
      await vi.advanceTimersByTimeAsync(120_000)
      expect(t.api.getSession).toHaveBeenCalledTimes(1)
      expect(authReq).toHaveBeenCalledTimes(1)
      t.live.resumeCaptions() // after re-login, supervision resumes
      t.captions.emit('status', 'connecting')
      await vi.advanceTimersByTimeAsync(30_000)
      expect(t.api.getSession).toHaveBeenCalledTimes(2)
    })

    it('other probe errors keep waiting and probe again', async () => {
      const t = setup()
      await t.live.boot()
      await t.live.start('Conf')
      const authReq = vi.fn()
      t.live.on('auth-required', authReq)
      t.api.getSession.mockClear()
      t.api.getSession.mockRejectedValue(new Error('LinTO HTTP 502'))
      t.captions.emit('status', 'offline')
      await vi.advanceTimersByTimeAsync(30_000)
      expect(t.api.getSession).toHaveBeenCalledTimes(1)
      expect(authReq).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(t.api.getSession).toHaveBeenCalledTimes(2)
      expect(t.captions.close).not.toHaveBeenCalled()
    })

    it('a session terminated elsewhere is detected by the probe: the show stops with a message', async () => {
      const t = setup()
      await t.live.boot()
      await t.live.start('Conf')
      t.ctl().emitState('active')
      t.api.getSession.mockResolvedValue(session({ status: 'terminated' }))
      t.captions.emit('status', 'offline')
      await vi.advanceTimersByTimeAsync(30_000)
      await t.live.settled()
      expect(t.ctl().stopStream).toHaveBeenCalled()
      expect(t.captions.close).toHaveBeenCalled()
      expect(t.ctl().showPause).toHaveBeenCalled()
      expect(t.last()).toMatchObject({ phase: 'error', stream: 'off', warning: msgTerminated('Conf') })
      expect(t.last()).not.toHaveProperty('session')
      expect(t.api.terminateSession).not.toHaveBeenCalled()
    })

    it('a session terminated elsewhere is detected after failed stream retries', async () => {
      const t = setup()
      await t.live.boot()
      await t.live.start('Conf')
      const c = t.ctl()
      t.captions.emit('status', 'live')
      c.emitState('active')
      t.api.getSession.mockResolvedValue(session({ status: 'terminated' }))
      c.startStream.mockRejectedValue(new Error('SRT refused'))
      c.emitState('stopped')
      await vi.advanceTimersByTimeAsync(2_000 + 5_000 + 10_000 + 30_000)
      await t.live.settled()
      expect(t.last()).toMatchObject({ phase: 'error', stream: 'off', warning: msgTerminated('Conf') })
      const n = c.startStream.mock.calls.length
      await vi.advanceTimersByTimeAsync(120_000)
      expect(c.startStream.mock.calls.length).toBe(n) // no more retries
    })

    it('captions back live before 30 s cancels the probe', async () => {
      const t = setup()
      await t.live.boot()
      await t.live.start('Conf')
      t.api.getSession.mockClear()
      t.captions.emit('status', 'offline')
      await vi.advanceTimersByTimeAsync(20_000)
      t.captions.emit('status', 'live')
      await vi.advanceTimersByTimeAsync(60_000)
      expect(t.api.getSession).not.toHaveBeenCalled()
    })

    it('no probe once stopped', async () => {
      const t = setup()
      await t.live.boot()
      await t.live.start('Conf')
      t.api.getSession.mockClear()
      t.captions.emit('status', 'offline')
      await t.live.stop()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(t.api.getSession).not.toHaveBeenCalled()
    })

    it('stale captions: hides the overlay box after 30 s offline, restores on next caption', async () => {
      const t = setup()
      await t.live.boot()
      await t.live.start('Conf')
      t.captions.emit('status', 'live')
      t.captions.emit('final', { segmentId: 1, text: 'Bonjour' })
      expect(t.overlay.push).toHaveBeenLastCalledWith({ type: 'final', text: 'Bonjour' })
      t.captions.emit('status', 'offline')
      await vi.advanceTimersByTimeAsync(29_000)
      expect(t.overlay.push).toHaveBeenLastCalledWith({ type: 'final', text: 'Bonjour' })
      await vi.advanceTimersByTimeAsync(1_000)
      expect(t.overlay.push).toHaveBeenLastCalledWith({ type: 'reset' })
      t.captions.emit('status', 'live')
      t.captions.emit('partial', { segmentId: 2, text: 'à tous' })
      expect(t.overlay.push).toHaveBeenLastCalledWith({ type: 'partial', text: 'à tous' })
    })
  })

  describe('auth loss is a single transition', () => {
    it('two consecutive REST 401 while live emit auth-required once; captions untouched', async () => {
      const t = setup()
      await t.live.boot()
      await t.live.start('Conf')
      t.captions.emit('status', 'live')
      const authReq = vi.fn()
      t.live.on('auth-required', authReq)
      t.live.reportUnauthorized()
      t.live.reportUnauthorized()
      expect(authReq).toHaveBeenCalledTimes(1)
      expect(t.last()).toMatchObject({ phase: 'live', captions: 'live' })
      expect(t.captions.close).not.toHaveBeenCalled()
      expect(t.settings.setToken).not.toHaveBeenCalled()
    })

    it('a REST 401 does not disable caption supervision', async () => {
      const t = setup()
      await t.live.boot()
      await t.live.start('Conf')
      t.live.reportUnauthorized()
      t.api.getSession.mockClear()
      t.captions.emit('status', 'offline')
      await vi.advanceTimersByTimeAsync(30_000)
      expect(t.api.getSession).toHaveBeenCalledTimes(1)
    })

    it('a caption socket auth failure after a REST 401 marks captions offline without a second emission', async () => {
      const t = setup()
      await t.live.boot()
      await t.live.start('Conf')
      t.captions.emit('status', 'live')
      const authReq = vi.fn()
      t.live.on('auth-required', authReq)
      t.live.reportUnauthorized()
      t.captions.emit('authError')
      expect(authReq).toHaveBeenCalledTimes(1)
      expect(t.last().captions).toBe('offline')
    })

    it('re-login (resumeCaptions) and stop re-arm the notification', async () => {
      const t = setup()
      await t.live.boot()
      await t.live.start('Conf')
      const authReq = vi.fn()
      t.live.on('auth-required', authReq)
      t.live.reportUnauthorized()
      t.live.resumeCaptions()
      t.live.reportUnauthorized()
      expect(authReq).toHaveBeenCalledTimes(2)
      await t.live.stop()
      t.live.reportUnauthorized()
      expect(authReq).toHaveBeenCalledTimes(3)
    })
  })

  it('a later successful output window clears the output failure warning', async () => {
    const t = setup()
    await t.live.boot()
    t.ctl().openOutputWindow.mockRejectedValueOnce(new Error('boom'))
    await t.live.start('Conf')
    expect(t.last().warning).toBe(MSG_OUTPUT_FAILED + 'boom')
    await t.live.showOutputWindow()
    expect(t.last().warning).toBeUndefined()
    expect(t.last().output).toBe('shown')
  })
})
