// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../src/renderer/App'
import { formatElapsed } from '../../src/renderer/main/useLive'
import type { LintoLiveApi, LiveState, SetupData, StartResult } from '../../src/shared/ipc'
import type { SessionSummary, Watermark } from '../../src/shared/types'
import { makeApi, withEvents } from './helpers'

const fn = (x: unknown) => x as ReturnType<typeof vi.fn>

const WM: Watermark = { display: false, pinned: false, content: 'Transcription by LinTO.ai $linto', frequency: 600, duration: 10 }
const SESSIONS: SessionSummary[] = [
  { id: 's1', name: 'Conférence', status: 'ready', watermark: WM },
  { id: 's2', name: 'Atelier', status: 'paused', watermark: WM },
  { id: 's3', name: 'Externe', status: 'on_schedule', watermark: WM },
  { id: 's4', name: 'Plénière', status: 'active', watermark: WM }
]

const setupData = (over: Partial<SetupData['settings']> = {}, extra: Partial<SetupData> = {}): SetupData => ({
  settings: { instance: 'https://studio.linto.ai', orgId: 'o1', profileId: 1, videoDeviceId: 'v1', audioDeviceId: 'a1', ...over },
  organizations: [{ id: 'o1', name: 'Org' }],
  profiles: [{ id: 1, name: 'Français' }, { id: 2, name: 'Anglais' }],
  videoDevices: [{ id: 'v1', name: 'Capture HDMI' }, { id: 'v2', name: 'FaceTime HD' }],
  audioDevices: [{ id: 'a1', name: 'Micro USB' }],
  watermarkEnabled: true,
  ...extra
})

const IDLE: LiveState = { phase: 'idle', stream: 'off', captions: 'offline', obs: 'running', output: 'off' }
const live = (over: Partial<LiveState> = {}): LiveState => ({
  phase: 'live', session: { name: 'Conférence', status: 'active' }, stream: 'active', captions: 'live', obs: 'running',
  output: 'shown', startedAt: Date.now() - 5000, ...over
})

let api: LintoLiveApi
let emit: (evt: string, payload?: unknown) => void

function setup(over: Parameters<typeof makeApi>[0] = {}, data: SetupData = setupData(), sessions: SessionSummary[] = SESSIONS) {
  api = makeApi({
    setup: { load: vi.fn().mockResolvedValue(data) }, ...over,
    sessions: { list: vi.fn().mockResolvedValue(sessions), ...over.sessions }
  })
  emit = withEvents(api)
  window.lintoLive = api
  return api
}

async function renderMain() {
  render(<App />)
  await screen.findByRole('listbox', { name: 'Sessions' })
}
const row = (name: string) => screen.getByRole('option', { name })
const startBtn = () => screen.getByRole('button', { name: 'Démarrer' }) as HTMLButtonElement
const toolbar = () => screen.getByRole('toolbar')

beforeEach(() => { vi.useRealTimers() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Sidebar', () => {
  it('lists the sessions with a status (title)', async () => {
    setup()
    await renderMain()
    expect(row('Conférence').getAttribute('title')).toBe('Prête')
    expect(row('Atelier').getAttribute('title')).toBe('En pause')
    expect(row('Plénière').getAttribute('title')).toBe('En direct')
    const ext = row('Externe')
    expect(ext.getAttribute('title')).toBe('Planifiée')
    expect(ext.className).not.toContain('is-dimmed')
    expect(ext.querySelector('.dot-idle')).toBeTruthy()
    expect(row('Plénière').querySelector('.dot-live')).toBeTruthy()
    expect(row('Conférence').querySelector('.dot-ok')).toBeTruthy()
    expect(row('Atelier').querySelector('.dot-warn')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Nouvelle session…' })).toBeTruthy()
  })

  it('shows an empty state', async () => {
    setup({}, setupData(), [])
    await renderMain()
    expect(screen.getByText('Aucune session en cours')).toBeTruthy()
  })

  it('shows a readable list error with Réessayer', async () => {
    const list = vi.fn()
      .mockRejectedValueOnce(new Error("Error invoking remote method 'sessions:list': Error: Trop de sessions dans l'organisation."))
      .mockResolvedValue(SESSIONS)
    setup({ sessions: { list } })
    render(<App />)
    expect(await screen.findByText("Trop de sessions dans l'organisation.")).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByRole('option', { name: 'Conférence' })).toBeTruthy()
    expect(screen.queryByText("Trop de sessions dans l'organisation.")).toBeNull()
  })

  it('preselects the last session used', async () => {
    setup({}, setupData({ lastSessionName: 'Atelier' }))
    await renderMain()
    await waitFor(() => expect(row('Atelier').getAttribute('aria-selected')).toBe('true'))
  })

  it('refreshes the list every 30 s', async () => {
    vi.useFakeTimers()
    setup()
    render(<App />)
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    const calls = fn(api.sessions.list).mock.calls.length
    expect(calls).toBeGreaterThanOrEqual(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(fn(api.sessions.list).mock.calls.length).toBe(calls + 1)
  })

  it('footer shows the instance host; the menu logs out', async () => {
    setup()
    await renderMain()
    expect(screen.getByText('studio.linto.ai')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Compte' }))
    expect(screen.queryByRole('menuitemradio')).toBeNull() // single organisation: no switch
    await userEvent.click(screen.getByRole('menuitem', { name: 'Se déconnecter' }))
    expect(api.auth.logout).toHaveBeenCalled()
    expect(await screen.findByRole('heading', { name: 'Connexion à LinTO' })).toBeTruthy()
  })

  it('the menu switches organisation when there are several, then reloads the lists', async () => {
    setup({}, setupData({}, { organizations: [{ id: 'o1', name: 'Org' }, { id: 'o2', name: 'Autre org' }] }))
    await renderMain()
    const loads = fn(api.setup.load).mock.calls.length
    const lists = fn(api.sessions.list).mock.calls.length
    await userEvent.click(screen.getByRole('button', { name: 'Compte' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Autre org' }))
    expect(api.setup.save).toHaveBeenCalledWith({ orgId: 'o2' })
    await waitFor(() => expect(fn(api.setup.load).mock.calls.length).toBe(loads + 1))
    await waitFor(() => expect(fn(api.sessions.list).mock.calls.length).toBe(lists + 1))
  })
})

describe('Démarrer', () => {
  it('is disabled without a session or a micro; the camera is optional', async () => {
    setup({}, setupData({ videoDeviceId: undefined, audioDeviceId: undefined }))
    await renderMain()
    expect(startBtn().disabled).toBe(true)
    await userEvent.click(row('Conférence'))
    expect(startBtn().disabled).toBe(true)
    expect((screen.getByLabelText('Caméra') as HTMLSelectElement).value).toBe('') // « Aucune »
    await userEvent.selectOptions(screen.getByLabelText('Micro'), 'a1')
    expect(startBtn().disabled).toBe(false)
  })

  it('the camera can be set back to « Aucune »', async () => {
    setup()
    await renderMain()
    await userEvent.selectOptions(screen.getByLabelText('Caméra'), 'Aucune')
    expect(api.setup.save).toHaveBeenCalledWith({ videoDeviceId: '' })
  })

  it('starts an existing session and shows « réutilisée », then refreshes the list', async () => {
    setup({ live: { start: vi.fn().mockResolvedValue({ ok: true, reused: true, canStream: true }) } })
    await renderMain()
    await userEvent.click(row('Conférence'))
    const lists = fn(api.sessions.list).mock.calls.length
    await userEvent.click(startBtn())
    expect(api.live.start).toHaveBeenCalledWith('Conférence')
    act(() => emit('live-state', live()))
    expect(within(toolbar()).getByText('réutilisée')).toBeTruthy()
    await waitFor(() => expect(fn(api.sessions.list).mock.calls.length).toBeGreaterThan(lists))
  })

  it('shows the refusal message', async () => {
    const msg = 'La session « Conférence » est terminée et ne peut pas être reprise. Choisis un autre nom.'
    setup({ live: { start: vi.fn().mockResolvedValue({ ok: false, message: msg }) } })
    await renderMain()
    await userEvent.click(row('Conférence'))
    await userEvent.click(startBtn())
    expect(await screen.findByText(msg)).toBeTruthy()
  })

  it('ignores a second click while starting (busy guard)', async () => {
    let release: (r: StartResult) => void = () => {}
    const start = vi.fn(() => new Promise<StartResult>((r) => { release = r }))
    setup({ live: { start } })
    await renderMain()
    await userEvent.click(row('Conférence'))
    await userEvent.click(startBtn())
    const busy = screen.getByRole('button', { name: 'Démarrage…' }) as HTMLButtonElement
    expect(busy.disabled).toBe(true)
    await userEvent.click(busy)
    expect(start).toHaveBeenCalledTimes(1)
    await act(async () => release({ ok: true, reused: false, canStream: true }))
  })
})

describe('Nouvelle session…', () => {
  it('selects a pending session (not created) and saves the profile before starting it', async () => {
    setup()
    await renderMain()
    await userEvent.click(screen.getByRole('button', { name: 'Nouvelle session…' }))
    const sheet = screen.getByRole('dialog', { name: 'Nouvelle session' })
    await userEvent.type(within(sheet).getByLabelText('Nom'), '  Débat ')
    await userEvent.selectOptions(within(sheet).getByLabelText('Profil de transcription'), '2')
    await userEvent.click(within(sheet).getByRole('button', { name: 'OK' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.setup.save).not.toHaveBeenCalledWith({ profileId: 2 })
    expect(row('Débat').getAttribute('aria-selected')).toBe('true')
    expect(within(toolbar()).getByText('nouvelle')).toBeTruthy()
    expect(screen.getByText('Anglais')).toBeTruthy() // inspector: profile of the pending session

    await userEvent.click(startBtn())
    expect(api.setup.save).toHaveBeenCalledWith({ profileId: 2 })
    expect(api.live.start).toHaveBeenCalledWith('Débat')
    const saveOrder = fn(api.setup.save).mock.invocationCallOrder.at(-1)!
    expect(saveOrder).toBeLessThan(fn(api.live.start).mock.invocationCallOrder[0]!)
  })

  it('typing an existing name says so, then selects that session on « Utiliser »', async () => {
    setup({ sessions: { lookup: vi.fn().mockResolvedValue('usable') } })
    await renderMain()
    await userEvent.click(screen.getByRole('button', { name: 'Nouvelle session…' }))
    await userEvent.type(screen.getByLabelText('Nom'), 'Atelier{Enter}')
    expect(api.sessions.lookup).toHaveBeenCalledWith('Atelier')
    const d = await screen.findByRole('dialog', { name: 'La session « Atelier » existe déjà.' })
    expect(within(d).getByText('Utiliser cette session ?')).toBeTruthy()
    await userEvent.click(within(d).getByRole('button', { name: 'Utiliser' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getAllByRole('option', { name: 'Atelier' })).toHaveLength(1)
    expect(row('Atelier').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Défini par la session')).toBeTruthy()
    await userEvent.click(startBtn())
    expect(api.live.start).toHaveBeenCalledWith('Atelier')
    expect(fn(api.setup.save).mock.calls.some(([p]) => 'profileId' in (p as object))).toBe(false)
  })

  it('Annuler on « existe déjà » selects nothing', async () => {
    setup({ sessions: { lookup: vi.fn().mockResolvedValue('usable') } })
    await renderMain()
    await userEvent.click(screen.getByRole('button', { name: 'Nouvelle session…' }))
    await userEvent.type(screen.getByLabelText('Nom'), 'Atelier{Enter}')
    await userEvent.click(await screen.findByRole('button', { name: 'Annuler' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(row('Atelier').getAttribute('aria-selected')).toBe('false')
  })

  it('refuses the name of a session the user has no rights on (not listed)', async () => {
    setup({ sessions: { lookup: vi.fn().mockResolvedValue('forbidden') } })
    await renderMain()
    await userEvent.click(screen.getByRole('button', { name: 'Nouvelle session…' }))
    await userEvent.type(screen.getByLabelText('Nom'), 'Privée{Enter}')
    const d = await screen.findByRole('dialog', { name: 'La session « Privée » existe déjà.' })
    expect(within(d).getByText("Tu n'as pas les droits suffisants pour l'utiliser. Choisis un autre nom.")).toBeTruthy()
    expect(within(d).queryByRole('button', { name: 'Utiliser' })).toBeNull()
    await userEvent.click(within(d).getByRole('button', { name: 'OK' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('option', { name: 'Privée' })).toBeNull()
    expect(api.live.start).not.toHaveBeenCalled()
  })

  it('refuses the name of a terminated session', async () => {
    setup({ sessions: { lookup: vi.fn().mockResolvedValue('terminated') } })
    await renderMain()
    await userEvent.click(screen.getByRole('button', { name: 'Nouvelle session…' }))
    await userEvent.type(screen.getByLabelText('Nom'), 'Ancienne{Enter}')
    const d = await screen.findByRole('dialog', { name: 'La session « Ancienne » existe déjà.' })
    expect(within(d).getByText('Elle est terminée et ne peut pas être reprise. Choisis un autre nom.')).toBeTruthy()
    await userEvent.click(within(d).getByRole('button', { name: 'OK' }))
    expect(screen.queryByRole('option', { name: 'Ancienne' })).toBeNull()
  })

  it('OK is disabled without a name; Escape cancels', async () => {
    setup()
    await renderMain()
    await userEvent.click(screen.getByRole('button', { name: 'Nouvelle session…' }))
    expect((screen.getByRole('button', { name: 'OK' }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('offers the organisation when there are several', async () => {
    setup({}, setupData({}, { organizations: [{ id: 'o1', name: 'Org' }, { id: 'o2', name: 'Autre org' }] }))
    await renderMain()
    await userEvent.click(screen.getByRole('button', { name: 'Nouvelle session…' }))
    await userEvent.selectOptions(screen.getByLabelText('Organisation'), 'o2')
    expect(api.setup.save).toHaveBeenCalledWith({ orgId: 'o2' })
  })
})

describe('Live toolbar', () => {
  it('shows EN DIRECT with the elapsed time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-09T10:00:00Z'))
    setup()
    render(<App />)
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    act(() => emit('live-state', live({ startedAt: Date.now() - 5000 })))
    expect(screen.getByText('EN DIRECT 00:05')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByText('EN DIRECT 00:06')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Démarrer' })).toBeNull()
    expect(within(toolbar()).getByText('Conférence')).toBeTruthy()
  })

  it('formats past an hour as h:mm:ss', () => {
    expect(formatElapsed(5_000)).toBe('00:05')
    expect(formatElapsed(42 * 60_000 + 17_000)).toBe('42:17')
    expect(formatElapsed(3_600_000 + 65_000)).toBe('1:01:05')
    expect(formatElapsed(-50)).toBe('00:00')
  })

  it('Arrêter calls stop once on double click, shows Arrêt…, then refreshes the list', async () => {
    let release: () => void = () => {}
    const stop = vi.fn(() => new Promise<void>((r) => { release = r }))
    setup({ live: { stop } })
    await renderMain()
    act(() => emit('live-state', live()))
    const lists = fn(api.sessions.list).mock.calls.length
    await userEvent.dblClick(screen.getByRole('button', { name: 'Arrêter' }))
    expect(stop).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: 'Arrêt…' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => release())
    act(() => emit('live-state', IDLE))
    await waitFor(() => expect(fn(api.sessions.list).mock.calls.length).toBeGreaterThan(lists))
    expect(startBtn()).toBeTruthy()
  })

  it('« Afficher la fenêtre de sortie » asks main to open one', async () => {
    setup()
    await renderMain()
    act(() => emit('live-state', live()))
    await userEvent.click(screen.getByRole('button', { name: 'Afficher la fenêtre de sortie' }))
    expect(api.live.showOutputWindow).toHaveBeenCalledTimes(1)
  })

  it('« Afficher la fenêtre de sortie » is there off air too, once OBS runs', async () => {
    setup()
    await renderMain()
    act(() => emit('live-state', { ...IDLE, obs: 'down' }))
    const btn = () => screen.getByRole('button', { name: 'Afficher la fenêtre de sortie' }) as HTMLButtonElement
    expect(btn().disabled).toBe(true)
    act(() => emit('live-state', IDLE))
    expect(btn().disabled).toBe(false)
    await userEvent.click(btn())
    expect(api.live.showOutputWindow).toHaveBeenCalledTimes(1)
  })
})

describe('Terminer…', () => {
  it('asks for confirmation; Annuler and Escape close it', async () => {
    setup()
    await renderMain()
    act(() => emit('live-state', live()))
    await userEvent.click(screen.getByRole('button', { name: 'Terminer…' }))
    expect(screen.getByText('Terminer définitivement « Conférence » ?')).toBeTruthy()
    expect(document.activeElement?.textContent).toBe('Annuler')
    await userEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Terminer…' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.live.terminate).not.toHaveBeenCalled()
  })

  it('terminates on confirm, with busy state disabling the actions', async () => {
    let release: () => void = () => {}
    const terminate = vi.fn(() => new Promise<void>((r) => { release = r }))
    setup({ live: { terminate } })
    await renderMain()
    act(() => emit('live-state', live()))
    await userEvent.click(screen.getByRole('button', { name: 'Terminer…' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Terminer' }))
    expect(terminate).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: 'Fin de session…' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Arrêter' }) as HTMLButtonElement).disabled).toBe(true)
    const lists = fn(api.sessions.list).mock.calls.length
    await act(async () => release())
    await waitFor(() => expect(fn(api.sessions.list).mock.calls.length).toBeGreaterThan(lists))
  })
})

describe('Switch while live', () => {
  it('asks « Basculer le direct sur … ? » and switches; selection follows on success', async () => {
    setup({ live: { start: vi.fn().mockResolvedValue({ ok: true, reused: true, canStream: true }) } })
    await renderMain()
    act(() => emit('live-state', live()))
    await userEvent.click(row('Atelier'))
    expect(row('Conférence').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Basculer le direct sur « Atelier » ?')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Basculer' }))
    expect(api.live.start).toHaveBeenCalledWith('Atelier')
    await waitFor(() => expect(row('Atelier').getAttribute('aria-selected')).toBe('true'))
    expect(within(toolbar()).getByText('Atelier')).toBeTruthy()
    expect(within(toolbar()).getByText('réutilisée')).toBeTruthy()
  })

  it('a refused switch keeps the current session and shows the message', async () => {
    const msg = 'La session « Atelier » est terminée et ne peut pas être reprise. Choisis un autre nom.'
    setup({ live: { start: vi.fn().mockResolvedValue({ ok: false, message: msg }) } })
    await renderMain()
    act(() => emit('live-state', live()))
    await userEvent.click(row('Atelier'))
    await userEvent.click(screen.getByRole('button', { name: 'Basculer' }))
    expect(await screen.findByText(msg)).toBeTruthy()
    expect(row('Conférence').getAttribute('aria-selected')).toBe('true')
    expect(within(toolbar()).getByText('Conférence')).toBeTruthy()
  })

  it('respects the busy guard while switching', async () => {
    let release: (r: StartResult) => void = () => {}
    const start = vi.fn(() => new Promise<StartResult>((r) => { release = r }))
    setup({ live: { start } })
    await renderMain()
    act(() => emit('live-state', live()))
    await userEvent.click(row('Atelier'))
    await userEvent.click(screen.getByRole('button', { name: 'Basculer' }))
    expect((screen.getByRole('button', { name: 'Arrêter' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Terminer…' }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(row('Plénière'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(start).toHaveBeenCalledTimes(1)
    await act(async () => release({ ok: true, reused: false, canStream: true }))
    expect((screen.getByRole('button', { name: 'Arrêter' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('an existing name typed while live offers to switch to it', async () => {
    setup({ sessions: { lookup: vi.fn().mockResolvedValue('usable') } })
    await renderMain()
    act(() => emit('live-state', live()))
    await userEvent.click(screen.getByRole('button', { name: 'Nouvelle session…' }))
    await userEvent.type(screen.getByLabelText('Nom'), 'Atelier{Enter}')
    const d = await screen.findByRole('dialog', { name: 'La session « Atelier » existe déjà.' })
    expect(within(d).getByText('Basculer le direct sur cette session ?')).toBeTruthy()
    await userEvent.click(within(d).getByRole('button', { name: 'Basculer' }))
    expect(api.live.start).toHaveBeenCalledWith('Atelier')
    expect(fn(api.setup.save).mock.calls.some(([p]) => 'profileId' in (p as object))).toBe(false)
  })

  it('a new session typed while live asks to switch, saving its profile first', async () => {
    setup()
    await renderMain()
    act(() => emit('live-state', live()))
    await userEvent.click(screen.getByRole('button', { name: 'Nouvelle session…' }))
    await userEvent.type(screen.getByLabelText('Nom'), 'Débat{Enter}')
    expect(screen.getByText('Basculer le direct sur « Débat » ?')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Basculer' }))
    expect(api.setup.save).toHaveBeenCalledWith({ profileId: 1 })
    expect(api.live.start).toHaveBeenCalledWith('Débat')
  })
})

describe('Stage, inspector and status bar', () => {
  it('shows the camera preview above the transcript once a camera is chosen', async () => {
    setup({}, setupData({ videoDeviceId: undefined }))
    await renderMain()
    expect(screen.queryByText('Aperçu en attente…')).toBeNull()
    expect(api.preview.subscribe).not.toHaveBeenCalled() // no camera: no screenshot polling
    await userEvent.selectOptions(screen.getByLabelText('Caméra'), 'v2')
    expect(api.preview.subscribe).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Aperçu en attente…')).toBeTruthy()
    act(() => emit('preview', 'data:image/jpeg;base64,AAA'))
    expect((screen.getByRole('img', { name: 'Aperçu de la caméra' }) as HTMLImageElement).src).toBe('data:image/jpeg;base64,AAA')
    expect(screen.getByText('La transcription s’affichera ici au démarrage du direct.')).toBeTruthy() // transcript still there
    await userEvent.selectOptions(screen.getByLabelText('Caméra'), 'Aucune')
    expect(api.preview.unsubscribe).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('img', { name: 'Aperçu de la caméra' })).toBeNull()
  })

  it('the preview subscription is dropped when the main window unmounts', async () => {
    setup()
    await renderMain()
    expect(api.preview.subscribe).toHaveBeenCalledTimes(1)
    cleanup()
    expect(api.preview.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('shows the transcript fetched on mount, then follows the transcript events', async () => {
    setup()
    const at = new Date(2026, 10, 10, 14, 3, 12).getTime()
    fn(api.live.getTranscript).mockResolvedValue({
      finals: [{ id: 1, text: 'Bonjour à tous', at, endAt: at + 1000, lang: 'fr-FR', locutor: 'Alice' }], partial: null
    })
    await renderMain()
    const log = await screen.findByRole('log')
    expect(within(log).getByText('Bonjour à tous')).toBeTruthy()
    expect(within(log).getByText('Alice')).toBeTruthy()
    // As on LinTO Studio: the time and the language next to the turn.
    expect(within(log).getByText('14:03:12')).toBeTruthy()
    expect(within(log).getByText('fr-FR')).toBeTruthy()
    act(() => emit('transcript', { kind: 'partial', segment: { id: 2, text: 'bienvenue', at: at + 2000, lang: 'fr-FR', locutor: 'Alice' } }))
    expect(within(log).getByText('bienvenue').className).toContain('is-partial')
    expect(within(log).getAllByText('Alice')).toHaveLength(1) // same speaker: no second label
    expect(within(log).getAllByText('fr-FR')).toHaveLength(1) // same language: no second tag
    expect(within(log).queryByText('14:03:14')).toBeNull() // same speaker, no pause: no second time
    act(() => emit('transcript', { kind: 'final', segment: { id: 2, text: 'bienvenue à la conférence', at: at + 2000, lang: 'fr-FR', locutor: 'Bob' } }))
    expect(within(log).getByText('14:03:14')).toBeTruthy()
    expect(within(log).queryByText('bienvenue')).toBeNull()
    expect(within(log).getByText('bienvenue à la conférence').className).not.toContain('is-partial')
    expect(within(log).getByText('Bob')).toBeTruthy()
    act(() => emit('transcript', { kind: 'reset' }))
    expect(screen.queryByRole('log')).toBeNull()
    expect(screen.getByText('La transcription s’affichera ici au démarrage du direct.')).toBeTruthy()
  })

  it('offers the export once the show has ended, not while on air', async () => {
    setup()
    fn(api.live.getTranscript).mockResolvedValue({ finals: [{ id: 1, text: 'Bonjour', at: Date.now() }], partial: null })
    await renderMain()
    await screen.findByRole('log')
    const pick = screen.getByLabelText('Exporter la transcription')
    expect(screen.getByText('Transcription terminée · 1 segment')).toBeTruthy()
    await userEvent.selectOptions(pick, 'srt')
    expect(api.live.exportTranscript).toHaveBeenCalledWith('srt')
    expect(await screen.findByText('Transcription exportée.')).toBeTruthy()

    fn(api.live.exportTranscript).mockRejectedValueOnce(new Error("Error invoking remote method 'live:export-transcript': Error: Disque plein"))
    await userEvent.selectOptions(screen.getByLabelText('Exporter la transcription'), 'txt')
    expect(await screen.findByText('Disque plein')).toBeTruthy()

    act(() => emit('live-state', live()))
    expect(screen.queryByLabelText('Exporter la transcription')).toBeNull()
  })

  it('on air with nothing said yet, waits for words', async () => {
    setup()
    await renderMain()
    act(() => emit('live-state', live()))
    expect(screen.getByText('En attente de paroles…')).toBeTruthy()
  })

  it('micro change is saved; the level meter follows audio-level', async () => {
    setup({}, setupData({ audioDeviceId: undefined }))
    await renderMain()
    await userEvent.selectOptions(screen.getByLabelText('Micro'), 'a1')
    expect(api.setup.save).toHaveBeenCalledWith({ audioDeviceId: 'a1' })
    act(() => emit('audio-level', -12))
    expect(screen.getByRole('meter', { name: 'Niveau audio' }).getAttribute('aria-valuenow')).toBe('-12')
  })

  it('camera and micro stay editable while live', async () => {
    setup()
    await renderMain()
    act(() => emit('live-state', live()))
    expect((screen.getByLabelText('Caméra') as HTMLSelectElement).disabled).toBe(false)
    await userEvent.selectOptions(screen.getByLabelText('Caméra'), 'v2')
    expect(api.setup.save).toHaveBeenCalledWith({ videoDeviceId: 'v2' })
  })

  it('shows the warning carried by live-state, also while idle, and clears it', async () => {
    setup()
    await renderMain()
    act(() => emit('live-state', { ...IDLE, obs: 'down', warning: 'Impossible de démarrer le moteur vidéo (OBS).' }))
    expect(screen.getByText('Impossible de démarrer le moteur vidéo (OBS).')).toBeTruthy()
    act(() => emit('live-state', IDLE))
    expect(screen.queryByText('Impossible de démarrer le moteur vidéo (OBS).')).toBeNull()
  })

  it('shows a setup.load error readably', async () => {
    setup({ setup: { load: vi.fn().mockRejectedValue(new Error("Error invoking remote method 'setup:load': Error: LinTO injoignable.")) } })
    render(<App />)
    expect(await screen.findByText('LinTO injoignable.')).toBeTruthy()
  })
})

describe('Authentication', () => {
  it('while live, auth-required shows a banner; Se reconnecter opens Login in a sheet', async () => {
    setup()
    await renderMain()
    act(() => emit('live-state', live()))
    act(() => emit('auth-required'))
    expect(screen.getByText('Session LinTO expirée — le direct continue.')).toBeTruthy()
    expect(screen.getByRole('listbox', { name: 'Sessions' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Se reconnecter' }))
    const sheet = screen.getByRole('dialog')
    await userEvent.type(within(sheet).getByLabelText('Email'), 'a@b.c')
    await userEvent.type(within(sheet).getByLabelText('Mot de passe'), 'pw')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Se connecter' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByText('Session LinTO expirée — le direct continue.')).toBeNull()
  })

  it('while idle, auth-required goes back to the login screen', async () => {
    setup()
    await renderMain()
    act(() => emit('auth-required'))
    expect(await screen.findByRole('heading', { name: 'Connexion à LinTO' })).toBeTruthy()
  })

  it('ignores a late auth.status result after auth-required', async () => {
    let status: (v: { loggedIn: boolean }) => void = () => {}
    setup({ auth: { status: vi.fn(() => new Promise<{ loggedIn: boolean }>((r) => { status = r })) } })
    render(<App />)
    act(() => emit('auth-required'))
    await screen.findByRole('heading', { name: 'Connexion à LinTO' })
    await act(async () => status({ loggedIn: true }))
    expect(screen.getByRole('heading', { name: 'Connexion à LinTO' })).toBeTruthy()
  })

  it('logs in from the login screen into the main window', async () => {
    setup({ auth: { status: vi.fn().mockResolvedValue({ loggedIn: false }) } })
    render(<App />)
    await userEvent.type(await screen.findByLabelText('Email'), 'a@b.c')
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'pw')
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
    expect(await screen.findByRole('listbox', { name: 'Sessions' })).toBeTruthy()
  })

  it('has no uninstall link in the window', async () => {
    setup()
    await renderMain()
    expect(screen.queryByText(/Désinstaller/)).toBeNull()
  })
})

describe('Review fixes', () => {
  it('the new-session sheet does not offer the organisation while on air', async () => {
    setup({}, setupData({}, { organizations: [{ id: 'o1', name: 'Org' }, { id: 'o2', name: 'Autre org' }] }))
    await renderMain()
    act(() => emit('live-state', live()))
    await userEvent.click(screen.getByRole('button', { name: 'Nouvelle session…' }))
    expect(within(screen.getByRole('dialog')).queryByLabelText('Organisation')).toBeNull()
    expect(api.setup.save).not.toHaveBeenCalledWith({ orgId: 'o2' })
  })

  it('keeps the list reachable by keyboard when the selection is not listed', async () => {
    setup({ live: { start: vi.fn().mockResolvedValue({ ok: true, reused: false, canStream: true }) } })
    await renderMain()
    act(() => emit('live-state', live({ session: { name: 'Ailleurs', status: 'active' } })))
    const tabbable = screen.getAllByRole('option').filter((o) => o.tabIndex === 0)
    expect(tabbable.map((o) => o.textContent)).toEqual(['Conférence'])
  })

  it('Démarrer stays disabled while a start launched elsewhere is in progress', async () => {
    setup({}, setupData({ lastSessionName: 'Conférence' }))
    await renderMain()
    await waitFor(() => expect(startBtn().disabled).toBe(false))
    act(() => emit('live-state', { ...IDLE, phase: 'starting' }))
    expect(startBtn().disabled).toBe(true)
    act(() => emit('live-state', { ...IDLE, phase: 'error', warning: 'Échec' }))
    expect(startBtn().disabled).toBe(false)
  })

  it('a failed list then auth-required while idle goes to Login', async () => {
    setup({ sessions: { list: vi.fn().mockRejectedValue(new Error('Unauthorized')) } })
    render(<App />)
    expect(await screen.findByText('Unauthorized')).toBeTruthy()
    act(() => emit('auth-required'))
    expect(await screen.findByRole('heading', { name: 'Connexion à LinTO' })).toBeTruthy()
  })
})

describe('Commands (menu/tray hooks)', () => {
  it('exposes start, new-session, terminate and logout as plain functions', async () => {
    setup({}, setupData({ lastSessionName: 'Conférence' }))
    const ref: { current: import('../../src/renderer/screens/MainWindow').MainWindowCommands | null } = { current: null }
    render(<App commands={ref} />)
    await screen.findByRole('listbox', { name: 'Sessions' })
    await waitFor(() => expect(row('Conférence').getAttribute('aria-selected')).toBe('true'))
    await act(async () => { ref.current!.run('start') })
    expect(api.live.start).toHaveBeenCalledWith('Conférence')
    act(() => ref.current!.run('new-session'))
    expect(screen.getByRole('dialog', { name: 'Nouvelle session' })).toBeTruthy()
  })
})

describe('Commands from the app menu / tray (evt:command)', () => {
  it("command 'start' does what Démarrer does", async () => {
    setup({}, setupData({ lastSessionName: 'Conférence' }))
    await renderMain()
    await waitFor(() => expect(startBtn().disabled).toBe(false))
    await act(async () => emit('command', 'start'))
    expect(api.live.start).toHaveBeenCalledWith('Conférence')
    expect(api.live.start).toHaveBeenCalledTimes(1)
  })

  it("command 'start' is ignored when Démarrer is disabled", async () => {
    setup()
    await renderMain()
    await act(async () => emit('command', 'start'))
    expect(api.live.start).not.toHaveBeenCalled()
  })

  it("command 'new-session' opens the sheet", async () => {
    setup()
    await renderMain()
    act(() => emit('command', 'new-session'))
    expect(screen.getByRole('dialog', { name: 'Nouvelle session' })).toBeTruthy()
  })

  it("command 'terminate' asks for confirmation while live", async () => {
    setup()
    await renderMain()
    act(() => emit('live-state', live()))
    act(() => emit('command', 'terminate'))
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Terminer' })).toBeTruthy()
  })

  it("command 'logout' logs out and shows Login", async () => {
    setup()
    await renderMain()
    await act(async () => emit('command', 'logout'))
    expect(api.auth.logout).toHaveBeenCalled()
    expect(await screen.findByRole('heading', { name: 'Connexion à LinTO' })).toBeTruthy()
  })

  it('reports the shell state (logged in, selected session, Démarrer possible) to main', async () => {
    setup({}, setupData({ lastSessionName: 'Conférence' }))
    await renderMain()
    await waitFor(() =>
      expect(api.app.reportShellState).toHaveBeenLastCalledWith({ loggedIn: true, sessionName: 'Conférence', canStart: true })
    )
    act(() => emit('live-state', live()))
    await waitFor(() =>
      expect(api.app.reportShellState).toHaveBeenLastCalledWith({ loggedIn: true, sessionName: 'Conférence', canStart: false })
    )
  })

  it('reports logged out on the Login screen', async () => {
    setup({ auth: { status: vi.fn().mockResolvedValue({ loggedIn: false }) } })
    render(<App />)
    await screen.findByRole('heading', { name: 'Connexion à LinTO' })
    await waitFor(() => expect(api.app.reportShellState).toHaveBeenLastCalledWith({ loggedIn: false, canStart: false }))
  })
})

describe('Final review fixes', () => {
  it('does not poll the session list while LinTO asks to log in again', async () => {
    vi.useFakeTimers()
    setup()
    render(<App />)
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    act(() => emit('live-state', live()))
    act(() => emit('auth-required'))
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    const calls = fn(api.sessions.list).mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000) })
    expect(fn(api.sessions.list).mock.calls.length).toBe(calls)
  })

  it('takes the current LiveState from main on mount (the first push may be missed)', async () => {
    setup({ live: { getState: vi.fn().mockResolvedValue(live()) } })
    await renderMain()
    expect(await screen.findByRole('button', { name: 'Arrêter' })).toBeTruthy()
  })

  it('a pushed LiveState wins over a late getState result', async () => {
    let resolve!: (s: LiveState) => void
    setup({ live: { getState: vi.fn(() => new Promise<LiveState>((r) => { resolve = r })) } })
    await renderMain()
    act(() => emit('live-state', live()))
    await act(async () => { resolve(IDLE) })
    expect(screen.getByRole('button', { name: 'Arrêter' })).toBeTruthy()
  })

  it('a menu command does not replace an open sheet', async () => {
    setup()
    await renderMain()
    act(() => emit('live-state', live()))
    await userEvent.click(row('Atelier'))
    expect(screen.getByText('Basculer le direct sur « Atelier » ?')).toBeTruthy()
    act(() => emit('command', 'new-session'))
    act(() => emit('command', 'terminate'))
    expect(screen.getByText('Basculer le direct sur « Atelier » ?')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Nouvelle session' })).toBeNull()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })
})

describe('Devices at launch', () => {
  it('reloads the setup data when OBS becomes running, so the saved camera shows its name', async () => {
    const load = vi.fn()
      .mockResolvedValueOnce(setupData({}, { videoDevices: [], audioDevices: [] }))
      .mockResolvedValue(setupData())
    setup({ live: { getState: vi.fn().mockResolvedValue({ ...IDLE, obs: 'down' }) } as never, setup: { load } as never })
    await renderMain()
    expect(load).toHaveBeenCalledTimes(1)
    const cam = () => screen.getByLabelText('Caméra') as HTMLSelectElement
    expect(cam().selectedOptions[0]?.textContent).toBe('Choisir…')
    act(() => emit('live-state', IDLE))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(cam().selectedOptions[0]?.textContent).toBe('Capture HDMI'))
    act(() => emit('live-state', { ...IDLE, output: 'shown' }))
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('Inspector: subtitles (LinTO Studio settings)', () => {
  const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement
  const btn = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement

  it('subtitle visibility and font size are saved locally', async () => {
    setup()
    await renderMain()
    expect(box('Afficher le sous-titre').checked).toBe(true)
    const size = screen.getByRole('spinbutton', { name: 'Taille de la police (px)' }) as HTMLInputElement
    expect(size.value).toBe('48')
    await userEvent.clear(size)
    await userEvent.type(size, '6')
    expect(fn(api.setup.save)).not.toHaveBeenCalledWith({ subtitleFontSize: 6 }) // out of range: not saved
    await userEvent.type(size, '0')
    expect(fn(api.setup.save)).toHaveBeenCalledWith({ subtitleFontSize: 60 })
    await userEvent.click(box('Afficher le sous-titre'))
    expect(fn(api.setup.save)).toHaveBeenCalledWith({ subtitlesVisible: false })
    expect(screen.queryByRole('spinbutton', { name: 'Taille de la police (px)' })).toBeNull()
  })

  it('watermark controls need a session that exists on LinTO, and save on it', async () => {
    setup()
    await renderMain()
    expect(box('Afficher le filigrane').disabled).toBe(true)
    await userEvent.click(row('Conférence'))
    expect(box('Afficher le filigrane').disabled).toBe(false)
    expect(box('Épingler le filigrane').disabled).toBe(true) // only once displayed
    await userEvent.click(box('Afficher le filigrane'))
    expect(fn(api.sessions.setWatermark)).toHaveBeenLastCalledWith('s1', { ...WM, display: true })
    expect(box('Afficher le filigrane').checked).toBe(true)
    await userEvent.click(box('Épingler le filigrane'))
    expect(fn(api.sessions.setWatermark)).toHaveBeenLastCalledWith('s1', { ...WM, display: true, pinned: true })
  })

  it('« Paramètres du filigrane… » edits text, frequency and duration', async () => {
    setup()
    await renderMain()
    await userEvent.click(row('Conférence'))
    await userEvent.click(btn('Paramètres du filigrane…'))
    const dialog = screen.getByRole('dialog', { name: 'Paramètres du filigrane' })
    const text = within(dialog).getByLabelText('Texte') as HTMLInputElement
    expect(text.value).toBe(WM.content)
    await userEvent.clear(text)
    await userEvent.type(text, 'Sous-titres $linto')
    const freq = within(dialog).getByLabelText('Fréquence (secondes)')
    await userEvent.clear(freq)
    expect((within(dialog).getByRole('button', { name: 'Appliquer' }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.type(freq, '120')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Appliquer' }))
    expect(fn(api.sessions.setWatermark)).toHaveBeenLastCalledWith('s1', { ...WM, content: 'Sous-titres $linto', frequency: 120 })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a refused save is shown and the list re-read', async () => {
    setup({ sessions: { list: vi.fn().mockResolvedValue(SESSIONS), setWatermark: vi.fn().mockRejectedValue(new Error(
      "Error invoking remote method 'sessions:set-watermark': Error: Tu n'as pas le droit de modifier cette session.")) } })
    await renderMain()
    await userEvent.click(row('Conférence'))
    const calls = fn(api.sessions.list).mock.calls.length
    await userEvent.click(box('Afficher le filigrane'))
    expect(await screen.findByText("Tu n'as pas le droit de modifier cette session.")).toBeTruthy()
    await waitFor(() => expect(fn(api.sessions.list).mock.calls.length).toBeGreaterThan(calls))
  })

  it('no watermark controls when the instance does not offer them', async () => {
    setup({}, setupData({}, { watermarkEnabled: false }))
    await renderMain()
    expect(screen.queryByRole('checkbox', { name: 'Afficher le filigrane' })).toBeNull()
  })

  it('« Effacer les sous-titres » only on air', async () => {
    setup({ live: { getState: vi.fn().mockResolvedValue(IDLE) } })
    await renderMain()
    expect(btn('Effacer les sous-titres').disabled).toBe(true)
    act(() => emit('live-state', live()))
    await waitFor(() => expect(btn('Effacer les sous-titres').disabled).toBe(false))
    await userEvent.click(btn('Effacer les sous-titres'))
    expect(fn(api.live.clearSubtitles)).toHaveBeenCalled()
  })
})

describe('organisation rights', () => {
  const REASON = "Ton rôle dans l'organisation ne permet pas de créer, modifier ni terminer des sessions (il faut être gestionnaire de réunion)."
  const member = () => setupData({}, {
    organizations: [{ id: 'o1', name: 'Org', rights: { manageSessions: false, readProfiles: false, reason: REASON } }],
    profiles: []
  })

  it('without the right: « Nouvelle session… » and Terminer are disabled and say why; menu commands explain', async () => {
    setup({}, member())
    await renderMain()
    const newRow = await screen.findByRole('button', { name: 'Nouvelle session…' }) as HTMLButtonElement
    await waitFor(() => expect(newRow.disabled).toBe(true))
    expect(newRow.title).toBe(REASON)
    act(() => emit('command', 'new-session'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText(REASON)).toBeTruthy()

    act(() => emit('live-state', live()))
    const term = screen.getByRole('button', { name: 'Terminer…' }) as HTMLButtonElement
    expect(term.disabled).toBe(true)
    expect(term.title).toBe(REASON)
    act(() => emit('command', 'terminate'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('without the right: the watermark of a session cannot be changed', async () => {
    setup({}, member())
    await renderMain()
    await userEvent.click(row('Conférence'))
    const box = screen.getByRole('checkbox', { name: 'Afficher le filigrane' }) as HTMLInputElement
    expect(box.disabled).toBe(true)
    expect(screen.getAllByText(REASON).length).toBeGreaterThan(0)
  })

  it('rights unknown (older LinTO): everything stays available', async () => {
    setup()
    await renderMain()
    expect((screen.getByRole('button', { name: 'Nouvelle session…' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('no organisation: says so', async () => {
    setup({}, setupData({ orgId: undefined }, { organizations: [] }), [])
    render(<App />)
    expect(await screen.findByText(/n’appartient à aucune organisation/)).toBeTruthy()
  })

  it('several organisations and none chosen: asks to pick one; Démarrer says why', async () => {
    setup({}, setupData({ orgId: undefined }, { organizations: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }), [])
    render(<App />)
    expect(await screen.findByText(/Choisis une organisation dans le menu Compte/)).toBeTruthy()
    expect(startBtn().title).toBe('Choisis une organisation.')
  })

  it('« Nouvelle session » without any transcriber profile: OK disabled and explained', async () => {
    setup({}, setupData({}, { profiles: [] }))
    await renderMain()
    await userEvent.click(screen.getByRole('button', { name: 'Nouvelle session…' }))
    await userEvent.type(screen.getByLabelText('Nom'), 'Conf')
    const dlg = screen.getByRole('dialog', { name: 'Nouvelle session' })
    expect((within(dlg).getByRole('button', { name: 'OK' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(dlg).getByText(/Aucun profil de transcription disponible/)).toBeTruthy()
  })
})
