// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Login } from '../../src/renderer/screens/Login'
import { Live } from '../../src/renderer/screens/Live'
import { App } from '../../src/renderer/App'
import type { LiveState } from '../../src/shared/ipc'
import { makeApi } from './helpers'

afterEach(() => { cleanup() })
const st: LiveState = { phase: 'live', session: { name: 'Conf', status: 'active' }, stream: 'active', captions: 'live', obs: 'running', output: 'shown' }
const fn = (x: unknown) => x as ReturnType<typeof vi.fn>

describe('Login instance field', () => {
  it('does not save on blur when unchanged (trailing slash ignored)', async () => {
    const api = makeApi({ setup: { load: vi.fn().mockResolvedValue({ settings: { instance: 'https://my.linto/' }, organizations: [], profiles: [], videoDevices: [], audioDevices: [], displays: [] }) } })
    window.lintoLive = api
    render(<Login onLoggedIn={() => {}} />)
    await userEvent.click(screen.getByText('Avancé'))
    const input = await screen.findByLabelText('Instance LinTO')
    await waitFor(() => expect((input as HTMLInputElement).value).toBe('https://my.linto/'))
    await userEvent.click(input)
    await userEvent.tab()
    expect(fn(api.setup.save)).not.toHaveBeenCalled()
    await userEvent.type(input, 'x')
    await userEvent.tab()
    expect(fn(api.setup.save)).toHaveBeenCalledWith({ instance: 'https://my.linto/x' })
  })
})

describe('Live actions', () => {
  it('Arrêter calls stop once on double click, then onStopped', async () => {
    let release: () => void = () => {}
    const stop = vi.fn(() => new Promise<void>((r) => { release = r }))
    window.lintoLive = makeApi({ live: { stop } })
    const onStopped = vi.fn()
    render(<Live state={st} reused={false} onStopped={onStopped} onNeedLogin={() => {}} />)
    const btn = screen.getByRole('button', { name: 'Arrêter' })
    await userEvent.dblClick(btn)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Arrêt…' })).toBeTruthy()
    await act(async () => release())
    expect(onStopped).toHaveBeenCalled()
  })
  it('shows busy state and disables actions while terminating', async () => {
    const terminate = vi.fn(() => new Promise<void>(() => {}))
    window.lintoLive = makeApi({ live: { terminate } })
    render(<Live state={st} reused={false} onStopped={() => {}} onNeedLogin={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Terminer la session' }))
    await userEvent.click(screen.getByRole('button', { name: 'Terminer définitivement' }))
    expect((screen.getByRole('button', { name: 'Fin de session…' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Arrêter' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('Escape closes the confirmation', async () => {
    window.lintoLive = makeApi()
    render(<Live state={st} reused={false} onStopped={() => {}} onNeedLogin={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Terminer la session' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
  it('auth-required banner offers Se reconnecter', async () => {
    window.lintoLive = makeApi()
    const onNeedLogin = vi.fn()
    render(<Live state={st} reused={false} authRequired onStopped={() => {}} onNeedLogin={onNeedLogin} />)
    expect(screen.getByText('Session LinTO expirée — se reconnecter')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Se reconnecter' }))
    expect(onNeedLogin).toHaveBeenCalled()
  })
})

describe('App', () => {
  it('ignores a late auth.status result after auth-required', async () => {
    let status: (v: { loggedIn: boolean }) => void = () => {}
    const api = makeApi({ auth: { status: vi.fn(() => new Promise<{ loggedIn: boolean }>((r) => { status = r })) } })
    const handlers: Record<string, () => void> = {}
    fn(api.on).mockImplementation((evt: string, cb: () => void) => { handlers[evt] = cb; return () => {} })
    window.lintoLive = api
    render(<App />)
    act(() => handlers['auth-required']())
    await screen.findByRole('heading', { name: 'Connexion à LinTO' })
    await act(async () => status({ loggedIn: true }))
    expect(screen.getByRole('heading', { name: 'Connexion à LinTO' })).toBeTruthy()
  })
})
