// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Button } from '../../src/renderer/ui/Button'
import { PopUp } from '../../src/renderer/ui/PopUp'
import { TextField } from '../../src/renderer/ui/TextField'
import { StatusDot } from '../../src/renderer/ui/StatusDot'
import { Banner } from '../../src/renderer/ui/Banner'
import { Sheet } from '../../src/renderer/ui/Sheet'
import { applyPlatform } from '../../src/renderer/ui/platform'

afterEach(() => { cleanup() })

describe('Button', () => {
  it('renders a native button with the variant and size classes, type=button by default', async () => {
    const onClick = vi.fn()
    render(<Button variant="primary" size="large" onClick={onClick}>Démarrer</Button>)
    const b = screen.getByRole('button', { name: 'Démarrer' })
    expect(b.getAttribute('type')).toBe('button')
    expect(b.className).toContain('btn-primary')
    expect(b.className).toContain('btn-large')
    await userEvent.click(b)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
  it('keeps an explicit type and extra className', () => {
    render(<Button type="submit" className="x">OK</Button>)
    const b = screen.getByRole('button', { name: 'OK' })
    expect(b.getAttribute('type')).toBe('submit')
    expect(b.className).toContain('btn-default')
    expect(b.className).toContain('x')
  })
})

describe('PopUp', () => {
  const options = [
    { value: 'v1', label: 'Capture HDMI' },
    { value: 'v2', label: 'FaceTime HD' },
    { value: 'v3', label: 'Débranchée', disabled: true }
  ]
  it('exposes aria-label and calls onChange with the option value', async () => {
    const onChange = vi.fn()
    render(<PopUp label="Caméra" value="v1" options={options} onChange={onChange} />)
    const sel = screen.getByRole('combobox', { name: 'Caméra' })
    expect(sel.getAttribute('aria-label')).toBe('Caméra')
    await userEvent.selectOptions(sel, 'FaceTime HD')
    expect(onChange).toHaveBeenCalledWith('v2')
    expect((screen.getByRole('option', { name: 'Débranchée' }) as HTMLOptionElement).disabled).toBe(true)
  })
  it('shows a disabled placeholder when the value is empty', () => {
    render(<PopUp label="Micro" value="" options={options} onChange={() => {}} placeholder="Choisir…" />)
    const sel = screen.getByRole('combobox', { name: 'Micro' }) as HTMLSelectElement
    expect(sel.value).toBe('')
    expect(sel.selectedOptions[0]?.textContent).toBe('Choisir…')
  })
  it('can be disabled', () => {
    render(<PopUp label="Micro" value="v1" options={options} onChange={() => {}} disabled />)
    expect((screen.getByRole('combobox', { name: 'Micro' }) as HTMLSelectElement).disabled).toBe(true)
  })
})

describe('TextField', () => {
  it('is labelled and forwards input attributes', async () => {
    const onChange = vi.fn()
    render(<TextField label="Instance" value="" onChange={onChange} placeholder="https://…" />)
    const input = screen.getByLabelText('Instance')
    expect(input.getAttribute('placeholder')).toBe('https://…')
    await userEvent.type(input, 'a')
    expect(onChange).toHaveBeenCalled()
  })
})

describe('StatusDot', () => {
  it('renders the tone and pulse classes, hidden from assistive tech', () => {
    const { container } = render(<StatusDot tone="live" pulse />)
    const dot = container.firstElementChild as HTMLElement
    expect(dot.className).toContain('dot-live')
    expect(dot.className).toContain('dot-pulse')
    expect(dot.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('Banner', () => {
  it('has role=alert, the tone class and an optional action', () => {
    render(<Banner tone="warn" action={<Button>Reconnecter</Button>}>Session expirée</Banner>)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Session expirée')
    expect(alert.className).toContain('banner-warn')
    expect(screen.getByRole('button', { name: 'Reconnecter' })).toBeTruthy()
  })
})

describe('Sheet', () => {
  function Harness({ onClose }: { onClose: () => void }) {
    const [open, setOpen] = useState(true)
    return (
      <Sheet title="Nouvelle session" open={open} onClose={() => { onClose(); setOpen(false) }} footer={<Button>Créer</Button>}>
        <TextField label="Nom" />
      </Sheet>
    )
  }
  it('is absent when open=false', () => {
    render(<Sheet title="X" open={false} onClose={() => {}} footer={null}><p>contenu</p></Sheet>)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('contenu')).toBeNull()
  })
  it('is a labelled modal dialog that focuses its first field', () => {
    render(<Harness onClose={() => {}} />)
    const d = screen.getByRole('dialog', { name: 'Nouvelle session' })
    expect(d.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(screen.getByLabelText('Nom'))
  })
  it('closes on Escape', async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('traps Tab focus inside the sheet', async () => {
    render(<Harness onClose={() => {}} />)
    const field = screen.getByLabelText('Nom')
    const btn = screen.getByRole('button', { name: 'Créer' })
    await userEvent.tab()
    expect(document.activeElement).toBe(btn)
    await userEvent.tab()
    expect(document.activeElement).toBe(field)
    await userEvent.tab({ shift: true })
    expect(document.activeElement).toBe(btn)
  })
})

describe('applyPlatform', () => {
  it('exposes the platform on the root element', () => {
    applyPlatform(document, 'darwin')
    expect(document.documentElement.dataset.platform).toBe('darwin')
    applyPlatform(document, 'linux')
    expect(document.documentElement.dataset.platform).toBe('linux')
  })
})
