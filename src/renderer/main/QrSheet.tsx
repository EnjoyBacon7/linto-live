import { useEffect, useState, type FormEvent } from 'react'
import type { QrSettings } from '../../shared/types'
import { Button } from '../ui/Button'
import { Sheet } from '../ui/Sheet'
import { TextField } from '../ui/TextField'

export interface QrSheetProps {
  open: boolean
  qr: QrSettings
  onApply(q: Pick<QrSettings, 'frequency' | 'duration'>): void
  onCancel(): void
}

const positive = (v: string): number | null => {
  const n = Number(v)
  return v.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null
}

/** « Paramètres du QR code »: how often and for how long the QR code appears, in seconds. */
export function QrSheet({ open, qr, onApply, onCancel }: QrSheetProps) {
  const [frequency, setFrequency] = useState('')
  const [duration, setDuration] = useState('')
  useEffect(() => {
    if (!open) return
    setFrequency(String(qr.frequency))
    setDuration(String(qr.duration))
  }, [open])

  const f = positive(frequency)
  const d = positive(duration)
  const ok = f !== null && d !== null
  const submit = (e?: FormEvent): void => {
    e?.preventDefault()
    if (ok) onApply({ frequency: f, duration: d })
  }
  return (
    <Sheet title="Paramètres du QR code" open={open} onClose={onCancel}
      footer={<>
        <Button size="large" onClick={onCancel}>Annuler</Button>
        <Button size="large" variant="primary" disabled={!ok} onClick={() => submit()}>Appliquer</Button>
      </>}>
      <form className="sheet-form" onSubmit={submit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}>
        <TextField label="Fréquence (secondes)" type="number" min={1} value={frequency}
          aria-invalid={f === null} onChange={(e) => setFrequency(e.target.value)} />
        <TextField label="Durée (secondes)" type="number" min={1} value={duration}
          aria-invalid={d === null} onChange={(e) => setDuration(e.target.value)} />
        <p className="sheet-detail">
          Le QR code du lien public de la session apparaît toutes les « fréquence » secondes pendant « durée »
          secondes, ou en permanence s'il est épinglé.
        </p>
      </form>
    </Sheet>
  )
}
