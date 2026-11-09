import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'

export interface SheetProps {
  title: string
  open: boolean
  onClose(): void
  children: ReactNode
  footer: ReactNode
}

const FOCUSABLE =
  'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
const FIELDS = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])'

/**
 * Modal sheet dropping from the top of the content area (macOS NSWindow sheet). Esc closes it,
 * Tab stays inside, the first field gets the focus, and focus returns to the opener on close.
 */
export function Sheet({ title, open, onClose, children, footer }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = ref.current
    const first = root?.querySelector<HTMLElement>(FIELDS) ?? root?.querySelector<HTMLElement>(FOCUSABLE) ?? root
    first?.focus()
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault()
        closeRef.current()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (opener?.isConnected) opener.focus()
    }
  }, [open])

  if (!open) return null

  const trapTab = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Tab' || !ref.current) return
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (items.length === 0) {
      e.preventDefault()
      return
    }
    const first = items[0]!
    const last = items[items.length - 1]!
    const active = document.activeElement
    if (e.shiftKey && (active === first || !ref.current.contains(active))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || !ref.current.contains(active))) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="sheet-backdrop">
      <div ref={ref} className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={trapTab}>
        <div className="sheet-body">
          <h2 id={titleId} className="sheet-title">{title}</h2>
          {children}
        </div>
        {footer && <div className="sheet-footer">{footer}</div>}
      </div>
    </div>
  )
}
