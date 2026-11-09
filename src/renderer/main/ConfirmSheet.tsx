import { Sheet } from '../ui/Sheet'
import { Button } from '../ui/Button'

export interface ConfirmSheetProps {
  open: boolean
  message: string
  detail?: string
  confirmLabel: string
  destructive?: boolean
  onConfirm(): void
  onCancel(): void
}

/** Confirmation sheet: « Annuler » first (focused by default, Esc), then the action. */
export function ConfirmSheet({ open, message, detail, confirmLabel, destructive, onConfirm, onCancel }: ConfirmSheetProps) {
  return (
    <Sheet title={message} open={open} onClose={onCancel}
      footer={<>
        <Button size="large" onClick={onCancel}>Annuler</Button>
        <Button size="large" variant={destructive ? 'destructive' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
      </>}>
      {detail && <p className="sheet-detail">{detail}</p>}
    </Sheet>
  )
}
