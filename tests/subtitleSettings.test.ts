import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { checkSettingsPatch } from '../src/shared/ipc'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseWatermarkConfig, STUDIO_WATERMARK_DEFAULTS } from '../src/main/linto/instance'
import { checkWatermark, resolveWatermark, WATERMARK_META_KEY } from '../src/main/linto/watermark'
import { LintoApi } from '../src/main/linto/api'
import { toSessionSummaries } from '../src/main/setupData'
import { LiveController, subtitleFontSize, type LiveDeps } from '../src/main/live'
import { ForbiddenError, subtitlePosition, subtitleSmoothingMs, type Session, type Settings, type Watermark, type WatermarkConfig } from '../src/shared/types'

const CFG: WatermarkConfig = { enabled: true, content: 'Par $linto', frequency: 30, duration: 5 }
const WM: Watermark = { display: true, pinned: false, content: 'Hello $linto', frequency: 60, duration: 8 }

describe('instance watermark config', () => {
  it('reads the live config.js (enabled, Studio defaults for the rest)', () => {
    const js = readFileSync(join(__dirname, 'fixtures/config.js'), 'utf8')
    expect(parseWatermarkConfig(js)).toEqual({ ...STUDIO_WATERMARK_DEFAULTS, enabled: true })
  })
  it('reads custom keys and ignores invalid numbers', () => {
    const js = `window.VUE_APP_CONFIG = {"VUE_APP_ENABLE_WATERMARK":"false","VUE_APP_WATERMARK_CONTENT":"Hi $linagora",
      "VUE_APP_WATERMARK_FREQUENCY":"120","VUE_APP_WATERMARK_DURATION":"abc"}`
    expect(parseWatermarkConfig(js)).toEqual({ enabled: false, content: 'Hi $linagora', frequency: 120, duration: 10 })
  })
  it('defaults to disabled when the key is absent (as LinTO Studio)', () => {
    expect(parseWatermarkConfig('window.VUE_APP_CONFIG = {}').enabled).toBe(false)
  })
})

describe('session watermark', () => {
  it('resolves meta[@watermark] with the instance defaults', () => {
    expect(resolveWatermark(undefined, CFG)).toEqual({ display: false, pinned: false, content: 'Par $linto', frequency: 30, duration: 5 })
    expect(resolveWatermark({ [WATERMARK_META_KEY]: { display: true, frequency: 90 } }, CFG))
      .toEqual({ display: true, pinned: false, content: 'Par $linto', frequency: 90, duration: 5 })
    expect(resolveWatermark({ [WATERMARK_META_KEY]: { display: 'yes', frequency: -1, content: 3 } }, CFG))
      .toEqual(resolveWatermark(undefined, CFG))
  })
  it('validates renderer input', () => {
    expect(checkWatermark(WM)).toEqual(WM)
    expect(() => checkWatermark({ ...WM, frequency: 0 })).toThrow(/positifs/)
    expect(() => checkWatermark({ ...WM, display: 1 })).toThrow(/invalides/)
    expect(() => checkWatermark({ ...WM, content: 'x'.repeat(501) })).toThrow(/trop long/)
    expect(() => checkWatermark(null)).toThrow(/invalides/)
    // extra keys are dropped
    expect(checkWatermark({ ...WM, evil: 1 })).toEqual(WM)
  })
  it('summaries carry the resolved watermark', () => {
    const s: Session = { id: 's', name: 'S', status: 'ready', channels: [{ id: 1, name: 'c', streamEndpoints: { srt: 'srt://h:1' } }], meta: { [WATERMARK_META_KEY]: WM } }
    expect(toSessionSummaries([s], CFG)[0]!.watermark).toEqual(WM)
    expect(toSessionSummaries([{ ...s, meta: undefined }], CFG)[0]!.watermark.display).toBe(false)
  })
})

describe('LintoApi meta', () => {
  const urls = { instance: 'https://s', api: 'https://s/api', auth: 'https://s/auth', wsUrl: 'https://s', wsPath: '/io' }
  it('keeps meta and patches it whole', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const f = (async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init })
      return new Response(init.method === 'PATCH' ? '' : JSON.stringify({ id: 's', name: 'N', status: 'ready', channels: [], meta: { a: 1 } }))
    }) as unknown as typeof fetch
    const api = new LintoApi(urls, () => 't', f)
    expect((await api.getSession('o', 's')).meta).toEqual({ a: 1 })
    await api.patchSessionMeta('o', 's', { a: 1, [WATERMARK_META_KEY]: WM })
    expect(calls[1]!.url).toBe('https://s/api/organizations/o/sessions/s')
    expect(calls[1]!.init.method).toBe('PATCH')
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ meta: { a: 1, '@watermark': WM } })
  })
})

describe('subtitlePosition', () => {
  it('defaults to the bottom, clamps to 0..100 and rounds', () => {
    expect(subtitlePosition({})).toBe(0)
    expect(subtitlePosition({ subtitlePosition: -5 })).toBe(0)
    expect(subtitlePosition({ subtitlePosition: 140 })).toBe(100)
    expect(subtitlePosition({ subtitlePosition: 33.6 })).toBe(34)
    expect(subtitlePosition({ subtitlePosition: NaN })).toBe(0)
  })
})

describe('subtitleFontSize', () => {
  it('clamps and defaults', () => {
    expect(subtitleFontSize({})).toBe(48)
    expect(subtitleFontSize({ subtitleFontSize: 4 })).toBe(12)
    expect(subtitleFontSize({ subtitleFontSize: 500 })).toBe(96)
    expect(subtitleFontSize({ subtitleFontSize: 40.4 })).toBe(40)
    expect(subtitleFontSize({ subtitleFontSize: NaN })).toBe(48)
  })
})

// ---- LiveController: what the overlay is told -------------------------------------------------------

function setup(meta?: Record<string, unknown>) {
  const sessions: Session[] = [{
    id: 's1', name: 'Conf', status: 'active',
    channels: [{ id: 7, name: 'Conf', streamEndpoints: { srt: 'srt://linto:9000?streamid=a' } }],
    ...(meta ? { meta } : {})
  }]
  const obs = Object.assign(new EventEmitter(), {
    start: vi.fn(async () => { const c = { port: 1, password: 'p' }; obs.emit('ready', c); return c }),
    stop: vi.fn(async () => {})
  })
  const ctl = {
    ensureScene: vi.fn(async () => {}), listVideoDevices: vi.fn(async () => []), listAudioDevices: vi.fn(async () => []),
    setSource: vi.fn(async () => {}), setBackupVisible: vi.fn(async () => {}), probePrimary: vi.fn(async () => ''),
    setAudioDevice: vi.fn(async () => {}), setAudioMonitor: vi.fn(async () => {}), setMicGain: vi.fn(async () => {}), setOverlayUrl: vi.fn(async () => {}),
    audioLevel$: vi.fn(() => () => {}), screenshot: vi.fn(async () => ''), startStream: vi.fn(async () => {}),
    stopStream: vi.fn(async () => true), streamState$: vi.fn(() => () => {}), openOutputWindow: vi.fn(async () => {}),
    showLive: vi.fn(async () => {}), showPause: vi.fn(async () => {}), resetProjectorState: vi.fn(), disconnect: vi.fn(async () => {}), ping: vi.fn(async () => {}),
    virtualCamAvailable: vi.fn(async () => true), setVirtualCam: vi.fn(async () => {}), virtualCamState$: vi.fn(() => () => {}),
    startRecord: vi.fn(async () => {}), startBroadcast: vi.fn(async () => {}), stopRecord: vi.fn(async () => null), recordState$: vi.fn(() => () => {})
  }
  const overlay = { start: vi.fn(async () => ({ url: 'http://127.0.0.1:1/?k=t' })), push: vi.fn(), stop: vi.fn(async () => {}) }
  let data: Settings = { instance: 'https://x', orgId: 'o', profileId: 1, primarySource: { kind: 'device', id: 'v' }, audioDeviceId: 'a' }
  const settings = { get: vi.fn(() => ({ ...data })), update: vi.fn((p: Partial<Settings>) => { data = { ...data, ...p } }), setToken: vi.fn(), getBroadcastKey: vi.fn(() => null) }
  const deps = {
    obs, controllerFactory: vi.fn(async () => ctl),
    api: {
      searchSessions: vi.fn(async () => sessions), getSession: vi.fn(async () => sessions[0]!),
      createSession: vi.fn(async () => sessions[0]!), terminateSession: vi.fn(async () => {}),
      clearSession: vi.fn(async (_o: string, _s: string) => {})
    },
    captions: Object.assign(new EventEmitter(), { open: vi.fn(), close: vi.fn() }),
    overlay, settings, platform: 'darwin' as const, qrSvg: async () => '<svg/>', decodeLuma: () => null, watermarkConfig: () => CFG,
    mkdirp: async () => {}, defaultRecordDir: '/rec',
    openBroadcast: async () => ({ url: 'unix:/tmp/l/obs.sock', onClose: () => {}, close: () => {} })
  } satisfies LiveDeps
  const live = new LiveController(deps)
  const styles = () => overlay.push.mock.calls.map((c) => c[0]).filter((m) => m.type === 'style')
  return { live, overlay, settings, styles, captions: deps.captions, api: deps.api }
}

describe('LiveController subtitle style', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }) })
  afterEach(() => { vi.useRealTimers() })

  it('boot sends the local settings with no watermark', async () => {
    const t = setup()
    await t.live.boot()
    expect(t.styles()).toEqual([{ type: 'style', visible: true, fontSize: 48, position: 0, watermark: resolveWatermark(undefined, CFG), qr: null }])
  })

  it('start uses the session watermark (before the reset), stop drops it', async () => {
    const t = setup({ [WATERMARK_META_KEY]: WM })
    await t.live.boot()
    t.overlay.push.mockClear()
    await t.live.start('Conf')
    const msgs = t.overlay.push.mock.calls.map((c) => c[0])
    expect(msgs[0]).toEqual({ type: 'style', visible: true, fontSize: 48, position: 0, watermark: WM, qr: null })
    expect(msgs[1]).toEqual({ type: 'reset' })
    const stopped = t.live.stop()
    await vi.advanceTimersByTimeAsync(10_000) // the fake OBS never reports the stream stopped
    await stopped
    expect(t.styles().at(-1)!.watermark.display).toBe(false)
  })

  it('local settings changes are pushed right away', async () => {
    const t = setup()
    await t.live.boot()
    await t.live.saveSettings({ subtitleFontSize: 60, subtitlesVisible: false })
    expect(t.styles().at(-1)).toMatchObject({ visible: false, fontSize: 60 })
    await t.live.saveSettings({ subtitlePosition: 70 })
    expect(t.styles().at(-1)).toMatchObject({ position: 70 })
    const n = t.styles().length
    await t.live.saveSettings({ primarySource: { kind: 'device', id: 'v2' } })
    expect(t.styles().length).toBe(n)
  })

  it('a watermark saved or re-read for the session on air reaches the overlay, others do not', async () => {
    const t = setup()
    await t.live.boot()
    await t.live.start('Conf')
    const n = t.styles().length
    t.live.watermarkChanged('other', WM)
    expect(t.styles().length).toBe(n)
    t.live.watermarkChanged('s1', WM)
    expect(t.styles().at(-1)!.watermark).toEqual(WM)
    t.live.syncWatermarks([{ id: 's1', name: 'Conf', status: 'active', watermark: WM, languages: [] }])
    expect(t.styles().length).toBe(n + 1) // unchanged: not sent again
    const pinned = { ...WM, pinned: true }
    t.live.syncWatermarks([{ id: 's1', name: 'Conf', status: 'active', watermark: pinned, languages: [] }])
    expect(t.styles().at(-1)!.watermark).toEqual(pinned)
  })

  it('off air, a watermark change is ignored', async () => {
    const t = setup()
    await t.live.boot()
    const n = t.styles().length
    t.live.watermarkChanged('s1', WM)
    expect(t.styles().length).toBe(n)
  })

  it('clearTranscript clears the session on LinTO, then the band and the transcript', async () => {
    const t = setup()
    await t.live.boot()
    await t.live.start('Conf')
    expect(t.captions.open).toHaveBeenLastCalledWith('s1', 7, 'o')
    t.captions.emit('final', { segmentId: 1, text: 'Bonjour' })
    const sent: unknown[] = []
    t.live.on('transcript', (u) => sent.push(u))
    await t.live.clearTranscript()
    expect(t.api.clearSession).toHaveBeenCalledWith('o', 's1')
    expect(t.overlay.push).toHaveBeenLastCalledWith({ type: 'reset' })
    const tr = t.live.getTranscript()
    expect(tr.finals).toEqual([])
    expect(tr.sessionName).toBe('Conf')
    expect(sent).toEqual([{ kind: 'reset', sessionName: 'Conf', startedAt: tr.startedAt }])
  })

  it('clearTranscript keeps everything when LinTO refuses', async () => {
    const t = setup()
    await t.live.boot()
    await t.live.start('Conf')
    t.captions.emit('final', { segmentId: 1, text: 'Bonjour' })
    t.api.clearSession.mockRejectedValueOnce(new ForbiddenError(403, 'nope'))
    const pushes = t.overlay.push.mock.calls.length
    await expect(t.live.clearTranscript()).rejects.toThrow(/effacer la transcription/)
    expect(t.overlay.push.mock.calls.length).toBe(pushes)
    expect(t.live.getTranscript().finals).toHaveLength(1)
  })

  it('a clear announced by LinTO (e.g. from LinTO Studio) empties the band and the transcript', async () => {
    const t = setup()
    await t.live.boot()
    await t.live.start('Conf')
    t.captions.emit('final', { segmentId: 1, text: 'Bonjour' })
    t.captions.emit('cleared')
    expect(t.overlay.push).toHaveBeenLastCalledWith({ type: 'reset' })
    expect(t.live.getTranscript().finals).toEqual([])
    expect(t.api.clearSession).not.toHaveBeenCalled()
    t.captions.emit('final', { segmentId: 2, text: 'Reprise' })
    expect(t.live.getTranscript().finals).toMatchObject([{ id: 2, text: 'Reprise' }])
  })
})

describe('subtitle smoothing setting', () => {
  it('uses the saved delay on a 250 ms step within 0..10 s, else 0', () => {
    expect(subtitleSmoothingMs({})).toBe(0)
    expect(subtitleSmoothingMs({ subtitleSmoothingMs: 1500 })).toBe(1500)
    expect(subtitleSmoothingMs({ subtitleSmoothingMs: 1600 })).toBe(1500)
    expect(subtitleSmoothingMs({ subtitleSmoothingMs: 20000 })).toBe(10000)
    expect(subtitleSmoothingMs({ subtitleSmoothingMs: -5 })).toBe(0)
    expect(subtitleSmoothingMs({ subtitleSmoothingMs: NaN })).toBe(0)
  })
  it('is checked when saved from the renderer', () => {
    expect(checkSettingsPatch({ subtitleSmoothingMs: 10000 })).toEqual({ subtitleSmoothingMs: 10000 })
    expect(() => checkSettingsPatch({ subtitleSmoothingMs: 10001 })).toThrow(/invalides/)
    expect(() => checkSettingsPatch({ subtitleSmoothingMs: '1000' })).toThrow(/invalides/)
  })
})
