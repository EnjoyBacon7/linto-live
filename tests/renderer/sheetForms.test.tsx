// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewSessionSheet } from '../../src/renderer/main/NewSessionSheet'
import { QrSheet } from '../../src/renderer/main/QrSheet'
import { WatermarkSheet } from '../../src/renderer/main/WatermarkSheet'

afterEach(() => cleanup())

describe('A-016 sheets', () => {
  it('Enter in the password field submits', async () => {
    const onSubmit = vi.fn()
    render(<NewSessionSheet open organizations={[]} profiles={[{ id: 1, name: 'P' } as any]} profileId={1}
      onOrgChange={() => {}} onSubmit={onSubmit} onCancel={() => {}} />)
    await userEvent.type(screen.getByLabelText('Nom'), 'Talk')
    await userEvent.selectOptions(screen.getAllByLabelText('Visibilité')[0]!, 'password')
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'secret{Enter}')
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
  it('QR sheet explains an invalid number', async () => {
    render(<QrSheet open qr={{ display: true, pinned: false, frequency: 30, duration: 10 } as any} onApply={() => {}} onCancel={() => {}} />)
    const f = screen.getByLabelText('Fréquence (secondes)')
    await userEvent.clear(f); await userEvent.type(f, '0')
    expect(f.getAttribute('aria-invalid')).toBe('true')
    const msg = document.getElementById(f.getAttribute('aria-describedby')!)
    expect(msg?.textContent).toMatch(/supérieur à 0/)
  })
  it('Watermark sheet explains an invalid number', async () => {
    render(<WatermarkSheet open watermark={{ content: 'x', frequency: 30, duration: 10 } as any} onApply={() => {}} onCancel={() => {}} />)
    const d = screen.getByLabelText('Durée (secondes)')
    await userEvent.clear(d)
    expect(document.getElementById(d.getAttribute('aria-describedby')!)?.textContent).toMatch(/supérieur à 0/)
  })
})
