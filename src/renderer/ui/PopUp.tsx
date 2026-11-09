import type { ChangeEvent } from 'react'
import { ChevronUpDownIcon } from './icons'

export interface PopUpOption { value: string; label: string; disabled?: boolean }

export interface PopUpProps {
  label: string
  value: string
  options: PopUpOption[]
  onChange(v: string): void
  disabled?: boolean
  placeholder?: string
  className?: string
  id?: string
}

/** macOS pop-up button: a native <select> (system menu, keyboard, a11y) styled with the accent chevron. */
export function PopUp({ label, value, options, onChange, disabled, placeholder, className, id }: PopUpProps) {
  const missing = !options.some((o) => o.value === value)
  return (
    <span className={className ? `popup ${className}` : 'popup'}>
      <select
        id={id}
        aria-label={label}
        className={missing ? 'popup-select is-placeholder' : 'popup-select'}
        value={missing ? '' : value}
        disabled={disabled}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
      >
        {missing && <option value="" disabled>{placeholder ?? ''}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
        ))}
      </select>
      <span className="popup-chevron" aria-hidden="true"><ChevronUpDownIcon size={12} strokeWidth={1.75} /></span>
    </span>
  )
}
