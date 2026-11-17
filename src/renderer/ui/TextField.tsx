import { useId, type InputHTMLAttributes } from 'react'

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  /** Short error text shown under the field and tied to the input via aria-describedby. */
  error?: string
}

/** Labelled text field (11 px secondary label above a 22 px field). */
export function TextField({ label, className, error, ...rest }: TextFieldProps) {
  const errorId = useId()
  return (
    <label className={className ? `field ${className}` : 'field'}>
      <span className="field-label">{label}</span>
      <input className="field-input" spellCheck={false} {...rest}
        {...(error ? { 'aria-invalid': true, 'aria-describedby': errorId } : {})} />
      {error && <span id={errorId} role="alert" className="field-error">{error}</span>}
    </label>
  )
}
