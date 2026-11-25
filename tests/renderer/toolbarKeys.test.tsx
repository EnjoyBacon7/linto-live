// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Toolbar, type ToolbarProps } from '../../src/renderer/main/Toolbar'

afterEach(cleanup)

const base: ToolbarProps = {
  title: 's', caption: null, onAir: false, busy: null, canStart: true, onStart() {}, onStop() {},
  canShowOutput: true, onShowOutput() {}, subtitlesOpen: false, onToggleSubtitles() {}, onTerminate() {}
}

describe('Toolbar button identity (A-020)', () => {
  it('does not reuse the Démarrer DOM node for another control on air', () => {
    const { rerender } = render(<Toolbar {...base} />)
    const start = screen.getByRole('button', { name: 'Démarrer' })
    rerender(<Toolbar {...base} onAir={true} startedAt={1} />)
    expect(start.isConnected).toBe(false)
  })
  it('does not reuse the Arrêter DOM node for another control off air', () => {
    const { rerender } = render(<Toolbar {...base} onAir={true} startedAt={1} />)
    const stop = screen.getByRole('button', { name: 'Arrêter' })
    rerender(<Toolbar {...base} />)
    expect(stop.isConnected).toBe(false)
  })
  it('keeps the output and subtitles buttons mounted across the swap', () => {
    const { rerender } = render(<Toolbar {...base} />)
    const out = screen.getByRole('button', { name: 'Afficher la fenêtre de sortie' })
    rerender(<Toolbar {...base} onAir={true} startedAt={1} />)
    expect(out.isConnected).toBe(true)
  })
})
