// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Permissions } from '../../src/renderer/screens/Permissions'
import { App } from '../../src/renderer/App'
import { makeApi } from './helpers'

afterEach(() => { cleanup() })

const status = (camera: string, microphone: string) => vi.fn().mockResolvedValue({ needed: true, camera, microphone })

describe('Permissions', () => {
  it('asks for the camera and the micro, then shows them granted', async () => {
    window.lintoLive = makeApi({ permissions: { status: status('not-determined', 'not-determined') } })
    render(<Permissions onDone={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Bienvenue dans LinTO Live' })).toBeTruthy()
    await userEvent.click(await screen.findByRole('button', { name: 'Autoriser : Caméra' }))
    expect(window.lintoLive.permissions.request).toHaveBeenCalledWith('camera')
    await userEvent.click(screen.getByRole('button', { name: 'Autoriser : Microphone' }))
    expect(window.lintoLive.permissions.request).toHaveBeenCalledWith('microphone')
    await waitFor(() => expect(screen.getAllByText('Autorisé')).toHaveLength(2))
    expect(screen.getByText(/Tout est prêt/)).toBeTruthy()
  })

  it('a refused access offers the System Settings pane', async () => {
    window.lintoLive = makeApi({ permissions: { status: status('denied', 'granted') } })
    render(<Permissions onDone={() => {}} />)
    expect(await screen.findByText('Refusé')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Ouvrir les réglages : Caméra' }))
    expect(window.lintoLive.permissions.openSettings).toHaveBeenCalledWith('camera')
    expect(screen.getByText(/Sans caméra ni micro/)).toBeTruthy()
  })

  it('sends a test notification', async () => {
    window.lintoLive = makeApi({ permissions: { status: status('granted', 'granted') } })
    render(<Permissions onDone={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Activer les notifications' }))
    expect(window.lintoLive.permissions.testNotification).toHaveBeenCalled()
    expect(await screen.findByText('Notification envoyée')).toBeTruthy()
  })

  it('Continuer finishes even with nothing granted', async () => {
    const onDone = vi.fn()
    window.lintoLive = makeApi({ permissions: { status: status('not-determined', 'denied') } })
    render(<Permissions onDone={onDone} />)
    await userEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    expect(window.lintoLive.permissions.finish).toHaveBeenCalled()
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })
})

describe('App first launch', () => {
  it('shows the permissions page first, then Login', async () => {
    window.lintoLive = makeApi({
      permissions: { status: status('not-determined', 'not-determined') },
      auth: { status: vi.fn().mockResolvedValue({ loggedIn: false }) }
    })
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Continuer' }))
    expect(await screen.findByRole('heading', { name: 'Connexion à LinTO' })).toBeTruthy()
  })

  it('goes straight to Login when the page is not needed', async () => {
    window.lintoLive = makeApi({ auth: { status: vi.fn().mockResolvedValue({ loggedIn: false }) } })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Connexion à LinTO' })).toBeTruthy()
    expect(screen.queryByText('Bienvenue dans LinTO Live')).toBeNull()
  })
})
