// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Login } from '../../src/renderer/screens/Login'
import { makeApi } from './helpers'

afterEach(() => { cleanup() })
const fn = (x: unknown) => x as ReturnType<typeof vi.fn>
const methods = [
  { path: 'oidc/google', from: 'oidc', name: 'Google' },
  { path: 'oidc/organization', from: 'oidc', name: 'Mon organisation' }
]

describe('Login', () => {
  it('shows the logo, the title, the instance host and one « Continuer avec » button per SSO method', async () => {
    window.lintoLive = makeApi({ auth: { methods: vi.fn().mockResolvedValue(methods) } })
    render(<Login onLoggedIn={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Connexion à LinTO' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'LinTO' })).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Continuer avec Google' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continuer avec Mon organisation' })).toBeTruthy()
    expect(screen.getByText('ou')).toBeTruthy()
    expect(screen.getByText('studio.linto.ai')).toBeTruthy()
  })

  it('has no « ou » separator without SSO methods', async () => {
    window.lintoLive = makeApi()
    render(<Login onLoggedIn={() => {}} />)
    await waitFor(() => expect(window.lintoLive.auth.methods).toHaveBeenCalled())
    expect(screen.queryByText('ou')).toBeNull()
  })

  it('logs in with email and password; Se connecter disabled until both are filled', async () => {
    const onLoggedIn = vi.fn()
    window.lintoLive = makeApi()
    render(<Login onLoggedIn={onLoggedIn} />)
    const btn = screen.getByRole('button', { name: 'Se connecter' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.c')
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'pw{Enter}')
    expect(window.lintoLive.auth.loginLocal).toHaveBeenCalledWith('a@b.c', 'pw')
    await waitFor(() => expect(onLoggedIn).toHaveBeenCalled())
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

  it('organisation SSO needs the email first', async () => {
    window.lintoLive = makeApi({ auth: { methods: vi.fn().mockResolvedValue(methods) } })
    render(<Login onLoggedIn={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Continuer avec Mon organisation' }))
    expect((await screen.findByRole('alert')).textContent).toBe("Saisis d'abord ton email pour utiliser cette connexion.")
    expect(window.lintoLive.auth.loginSso).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText('Email'), ' x@org.fr ')
    await userEvent.click(screen.getByRole('button', { name: 'Continuer avec Mon organisation' }))
    expect(window.lintoLive.auth.loginSso).toHaveBeenCalledWith('oidc/organization', 'x@org.fr')
    await userEvent.click(screen.getByRole('button', { name: 'Continuer avec Google' }))
    expect(window.lintoLive.auth.loginSso).toHaveBeenLastCalledWith('oidc/google', undefined)
  })

  it('instance: « Modifier » reveals the field; saves on blur only when changed (trailing slash ignored)', async () => {
    const api = makeApi({ setup: { load: vi.fn().mockResolvedValue({ settings: { instance: 'https://my.linto/' }, organizations: [], profiles: [], videoDevices: [], audioDevices: [] }) } })
    window.lintoLive = api
    render(<Login onLoggedIn={() => {}} />)
    expect(await screen.findByText('my.linto')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Modifier' }))
    const input = screen.getByLabelText('Instance LinTO') as HTMLInputElement
    expect(input.value).toBe('https://my.linto/')
    await userEvent.click(input)
    await userEvent.tab()
    expect(fn(api.setup.save)).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Modifier' }))
    const again = screen.getByLabelText('Instance LinTO')
    await userEvent.type(again, 'x')
    await userEvent.tab()
    expect(fn(api.setup.save)).toHaveBeenCalledWith({ instance: 'https://my.linto/x' })
    await waitFor(() => expect(fn(api.auth.methods).mock.calls.length).toBe(2))
  })

  it('embedded (sheet) variant offers Annuler', async () => {
    const onCancel = vi.fn()
    window.lintoLive = makeApi()
    render(<Login embedded onLoggedIn={() => {}} onCancel={onCancel} />)
    expect(screen.queryByRole('heading', { name: 'Connexion à LinTO' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('embedded (re-login during a show): the instance is shown but cannot be changed', async () => {
    window.lintoLive = makeApi()
    render(<Login embedded onLoggedIn={() => {}} onCancel={() => {}} />)
    expect(screen.getByText('studio.linto.ai')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Modifier' })).toBeNull()
  })
})
