// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from '../../src/renderer/main/Sidebar'

afterEach(() => cleanup())

const base = {
  sessions: [], error: null, onRetry() {}, selectedName: null, pendingName: null,
  onSelect() {}, onNew() {}, instance: 'https://x.y', organizations: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
  orgId: 'a', onSwitchOrg() {}, onLogout() {}, onAir: false
} as any

const openMenu = async () => {
  const trigger = screen.getByRole('button', { name: 'Compte' })
  await userEvent.click(trigger)
  return trigger
}
const label = () => document.activeElement?.textContent

describe('account menu keyboard contract', () => {
  it('ArrowDown/ArrowUp wrap, Home/End jump', async () => {
    render(<Sidebar {...base} />)
    await openMenu()
    expect(label()).toBe('A')
    await userEvent.keyboard('{ArrowDown}'); expect(label()).toBe('B')
    await userEvent.keyboard('{ArrowDown}'); expect(label()).toBe('Se déconnecter')
    await userEvent.keyboard('{ArrowDown}'); expect(label()).toBe('A')
    await userEvent.keyboard('{ArrowUp}'); expect(label()).toBe('Se déconnecter')
    await userEvent.keyboard('{Home}'); expect(label()).toBe('A')
    await userEvent.keyboard('{End}'); expect(label()).toBe('Se déconnecter')
  })
  it('Escape closes and returns focus to the trigger', async () => {
    render(<Sidebar {...base} />)
    const trigger = await openMenu()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
  it('Tab closes the menu', async () => {
    render(<Sidebar {...base} />)
    await openMenu()
    await userEvent.tab()
    expect(screen.queryByRole('menu')).toBeNull()
  })
  it('picking an item returns focus to the trigger', async () => {
    const onLogout = vi.fn()
    render(<Sidebar {...base} onLogout={onLogout} />)
    const trigger = await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Se déconnecter' }))
    expect(onLogout).toHaveBeenCalled()
    expect(document.activeElement).toBe(trigger)
  })
})
