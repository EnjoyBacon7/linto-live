import type { InputHTMLAttributes } from 'react'

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
}

/** Labelled text field (11 px secondary label above a 22 px field). */
export function TextField({ label, className, ...rest }: TextFieldProps) {
  return (
    <label className={className ? `field ${className}` : 'field'}>
      <span className="field-label">{label}</span>
      <input className="field-input" spellCheck={false} {...rest} />
    </label>
  )
}
