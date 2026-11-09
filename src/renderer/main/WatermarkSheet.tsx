import { useEffect, useState, type FormEvent } from 'react'
import type { Watermark } from '../../shared/types'
import { Button } from '../ui/Button'
import { Sheet } from '../ui/Sheet'
import { TextField } from '../ui/TextField'

export interface WatermarkSheetProps {
  open: boolean
  watermark: Watermark | null
  onApply(w: Pick<Watermark, 'content' | 'frequency' | 'duration'>): void
  onCancel(): void
}

const positive = (v: string): number | null => {
  const n = Number(v)
  return v.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null
}

/** « Paramètres du filigrane » (same fields as LinTO Studio): text, frequency and duration in seconds. */
export function WatermarkSheet({ open, watermark, onApply, onCancel }: WatermarkSheetProps) {
  const [content, setContent] = useState('')
  const [frequency, setFrequency] = useState('')
  const [duration, setDuration] = useState('')
  useEffect(() => {
    if (!open || !watermark) return
    setContent(watermark.content)
    setFrequency(String(watermark.frequency))
    setDuration(String(watermark.duration))
  }, [open])

  const f = positive(frequency)
  const d = positive(duration)
  const ok = f !== null && d !== null
  const submit = (e?: FormEvent): void => {
    e?.preventDefault()
    if (ok) onApply({ content, frequency: f, duration: d })
  }
  return (
    <Sheet title="Paramètres du filigrane" open={open} onClose={onCancel}
      footer={<>
        <Button size="large" onClick={onCancel}>Annuler</Button>
        <Button size="large" variant="primary" disabled={!ok} onClick={() => submit()}>Appliquer</Button>
      </>}>
      <form className="sheet-form" onSubmit={submit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}>
        <TextField label="Texte" value={content} maxLength={500} onChange={(e) => setContent(e.target.value)} />
        <TextField label="Fréquence (secondes)" type="number" min={1} value={frequency}
          aria-invalid={f === null} onChange={(e) => setFrequency(e.target.value)} />
        <TextField label="Durée (secondes)" type="number" min={1} value={duration}
          aria-invalid={d === null} onChange={(e) => setDuration(e.target.value)} />
        <p className="sheet-detail">
          Le filigrane apparaît toutes les « fréquence » secondes pendant « durée » secondes, ou en permanence
          s'il est épinglé. $linto et $linagora sont remplacés par les logos. Enregistré sur la session LinTO,
          comme dans LinTO Studio.
        </p>
      </form>
    </Sheet>
  )
}
