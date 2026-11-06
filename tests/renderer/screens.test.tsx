// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Login } from '../../src/renderer/screens/Login'
import { Setup } from '../../src/renderer/screens/Setup'
import { Live } from '../../src/renderer/screens/Live'
import type { LiveState } from '../../src/shared/ipc'
import { makeApi } from './helpers'

afterEach(() => { cleanup() })

const liveState = (over: Partial<LiveState> = {}): LiveState => ({
  phase: 'live', session: { name: 'Conf', status: 'active' }, stream: 'active', captions: 'live', obs: 'running', output: 'shown', ...over
})

describe('Login', () => {
  it('renders one SSO button per method', async () => {
    window.lintoLive = makeApi({
      auth: { methods: vi.fn().mockResolvedValue([
        { path: 'oidc/google', from: 'oidc', name: 'Google' },
        { path: 'oidc/organization', from: 'oidc', name: 'Mon organisation' }
      ]) }
    })
    render(<Login onLoggedIn={() => {}} />)
    expect(await screen.findByRole('button', { name: 'Se connecter avec Google' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Se connecter avec Mon organisation' })).toBeTruthy()
  })
  it('shows the inline error on bad password', async () => {
    window.lintoLive = makeApi({
      auth: { loginLocal: vi.fn().mockRejectedValue(new Error("Error invoking remote method 'x': Error: Email ou mot de passe incorrect.")) }
    })
    render(<Login onLoggedIn={() => {}} />)
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.c')
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'pw')
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Email ou mot de passe incorrect.')
  })
})

describe('Setup', () => {
  it('disables Démarrer until name, video and audio are set', async () => {
    window.lintoLive = makeApi()
    render(<Setup onStarted={() => {}} />)
    const btn = (await screen.findByRole('button', { name: 'Démarrer' })) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    await userEvent.selectOptions(screen.getByLabelText('Entrée vidéo'), 'v1')
    await userEvent.selectOptions(screen.getByLabelText('Entrée audio'), 'a1')
    expect(btn.disabled).toBe(true)
    await userEvent.type(screen.getByLabelText('Nom de la session'), 'Conf')
    expect(btn.disabled).toBe(false)
    expect((window.lintoLive.setup.save as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({ videoDeviceId: 'v1' })
  })
  it('shows the failure message when start is refused', async () => {
    window.lintoLive = makeApi({ live: { start: vi.fn().mockResolvedValue({ ok: false, message: 'La session « X » est terminée et ne peut pas être reprise. Choisis un autre nom.' }) } })
    render(<Setup onStarted={() => {}} />)
    await screen.findByRole('button', { name: 'Démarrer' })
    await userEvent.selectOptions(screen.getByLabelText('Entrée vidéo'), 'v1')
    await userEvent.selectOptions(screen.getByLabelText('Entrée audio'), 'a1')
    await userEvent.type(screen.getByLabelText('Nom de la session'), 'X')
    await userEvent.click(screen.getByRole('button', { name: 'Démarrer' }))
    expect((await screen.findByRole('alert')).textContent).toContain('est terminée')
  })
})

describe('Live', () => {
  it('shows the warning from LiveState', () => {
    window.lintoLive = makeApi()
    render(<Live state={liveState({ warning: 'Écran HDMI introuvable' })} reused={false} onStopped={() => {}} onNeedLogin={() => {}} />)
    expect(screen.getByText('Écran HDMI introuvable')).toBeTruthy()
  })
  it('requires confirmation before terminating', async () => {
    window.lintoLive = makeApi()
    const onStopped = vi.fn()
    render(<Live state={liveState()} reused={false} onStopped={onStopped} onNeedLogin={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Terminer la session' }))
    expect(screen.getByText('Terminer définitivement la session « Conf » ? Elle ne pourra plus être reprise.')).toBeTruthy()
    expect(window.lintoLive.live.terminate).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Terminer définitivement' }))
    await waitFor(() => expect(window.lintoLive.live.terminate).toHaveBeenCalled())
  })
})
