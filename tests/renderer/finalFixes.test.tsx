// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Setup } from '../../src/renderer/screens/Setup'
import { Live } from '../../src/renderer/screens/Live'
import type { LiveState, SetupData, StartResult } from '../../src/shared/ipc'
import { makeApi } from './helpers'

afterEach(() => { cleanup() })

const live: LiveState = { phase: 'live', session: { name: 'Conf', status: 'active' }, stream: 'active', captions: 'live', obs: 'running', output: 'shown' }

function withListeners(api: ReturnType<typeof makeApi>) {
  const listeners: Record<string, (p: unknown) => void> = {}
  api.on = vi.fn((evt: string, cb: (p: unknown) => void) => {
    listeners[evt] = cb
    return () => { delete listeners[evt] }
  }) as never
  return listeners
}

const setupData = (over: Partial<SetupData> = {}): SetupData => ({
  settings: { instance: 'https://studio.linto.ai', videoDeviceId: 'v1', audioDeviceId: 'a1' },
  organizations: [{ id: 'o1', name: 'Org' }],
  profiles: [{ id: 1, name: 'Français' }],
  videoDevices: [{ id: 'v1', name: 'Capture HDMI' }],
  audioDevices: [{ id: 'a1', name: 'Micro' }],
  displays: [
    { index: 0, name: 'Écran intégré', x: 0, y: 0, width: 1512, height: 982 },
    { index: 1, name: 'HDMI', x: 1512, y: 0, width: 1920, height: 1080 }
  ],
  appDisplay: { x: 0, y: 0, width: 1512, height: 982 },
  ...over
})

describe('Setup final fixes', () => {
  it('shows the OBS warning carried by live-state', async () => {
    const api = makeApi()
    const listeners = withListeners(api)
    window.lintoLive = api
    render(<Setup onStarted={() => {}} />)
    await screen.findByRole('button', { name: 'Démarrer' })
    act(() => listeners['live-state']({ phase: 'idle', stream: 'off', captions: 'offline', obs: 'down', output: 'off', warning: 'Impossible de démarrer le moteur vidéo (OBS).' }))
    expect(screen.getByText('Impossible de démarrer le moteur vidéo (OBS).')).toBeTruthy()
    act(() => listeners['live-state']({ phase: 'idle', stream: 'off', captions: 'offline', obs: 'running', output: 'off' }))
    expect(screen.queryByText('Impossible de démarrer le moteur vidéo (OBS).')).toBeNull()
  })

  it("marks the app window's display and warns when it is chosen as output", async () => {
    window.lintoLive = makeApi({ setup: { load: vi.fn().mockResolvedValue(setupData()) } })
    render(<Setup onStarted={() => {}} />)
    const sel = await screen.findByLabelText('Écran de sortie')
    expect(screen.getByRole('option', { name: 'Écran intégré (1512×982) (écran de cette fenêtre)' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'HDMI (1920×1080)' })).toBeTruthy()
    expect(screen.queryByText(/couvrira cette fenêtre/)).toBeNull()
    await userEvent.selectOptions(sel, '0')
    expect(screen.getByText(/couvrira cette fenêtre/)).toBeTruthy()
    await userEvent.selectOptions(sel, '1')
    expect(screen.queryByText(/couvrira cette fenêtre/)).toBeNull()
  })
})

describe('Live: Changer de session', () => {
  it('switches to the new session while live', async () => {
    const start = vi.fn().mockResolvedValue({ ok: true, reused: true, canStream: true })
    window.lintoLive = makeApi({ live: { start } })
    const onSwitched = vi.fn()
    render(<Live state={live} reused={false} onStopped={() => {}} onNeedLogin={() => {}} onSwitched={onSwitched} />)
    await userEvent.click(screen.getByRole('button', { name: 'Changer de session' }))
    const input = screen.getByLabelText('Nom de la nouvelle session') as HTMLInputElement
    expect(input.value).toBe('')
    const go = screen.getByRole('button', { name: 'Basculer' }) as HTMLButtonElement
    expect(go.disabled).toBe(true)
    await userEvent.type(input, '  Autre ')
    await userEvent.click(go)
    expect(start).toHaveBeenCalledWith('Autre')
    await waitFor(() => expect(onSwitched).toHaveBeenCalledWith(true))
    expect(screen.queryByLabelText('Nom de la nouvelle session')).toBeNull()
  })

  it('shows a refused switch inline and keeps the field', async () => {
    const msg = 'La session « Autre » est terminée et ne peut pas être reprise. Choisis un autre nom.'
    window.lintoLive = makeApi({ live: { start: vi.fn().mockResolvedValue({ ok: false, message: msg }) } })
    const onSwitched = vi.fn()
    render(<Live state={live} reused={false} onStopped={() => {}} onNeedLogin={() => {}} onSwitched={onSwitched} />)
    await userEvent.click(screen.getByRole('button', { name: 'Changer de session' }))
    await userEvent.type(screen.getByLabelText('Nom de la nouvelle session'), 'Autre{Enter}')
    expect((await screen.findByRole('alert')).textContent).toBe(msg)
    expect(screen.getByLabelText('Nom de la nouvelle session')).toBeTruthy()
    expect(onSwitched).not.toHaveBeenCalled()
  })

  it('respects the busy guard while switching', async () => {
    let release: (r: StartResult) => void = () => {}
    const start = vi.fn(() => new Promise<StartResult>((r) => { release = r }))
    window.lintoLive = makeApi({ live: { start } })
    render(<Live state={live} reused={false} onStopped={() => {}} onNeedLogin={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Changer de session' }))
    await userEvent.type(screen.getByLabelText('Nom de la nouvelle session'), 'Autre')
    await userEvent.click(screen.getByRole('button', { name: 'Basculer' }))
    await userEvent.click(screen.getByRole('button', { name: 'Bascule…' }))
    expect(start).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: 'Bascule…' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Arrêter' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Terminer la session' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => release({ ok: true, reused: false, canStream: true }))
    expect((screen.getByRole('button', { name: 'Arrêter' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
