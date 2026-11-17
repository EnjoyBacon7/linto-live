import { useId, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'destructive' | 'plain'
  size?: 'regular' | 'large'
  icon?: ReactNode
  /**
   * The action is unavailable for this reason. The button looks disabled but stays focusable
   * (aria-disabled), the reason is its accessible description, and clicks are ignored here, so
   * callers need no guard of their own. Use plain `disabled` for transient states (busy…).
   */
  blockedReason?: string
}

/** macOS push button: 22 px (regular) / 28 px (large), 6 px radius; primary = accent fill. */
export function Button({ variant = 'default', size = 'regular', icon, className, type = 'button', children, blockedReason, onClick, ...rest }: ButtonProps) {
  const reasonId = useId()
  const cls = ['btn', `btn-${variant}`, `btn-${size}`, className].filter(Boolean).join(' ')
  const blocked = blockedReason !== undefined && !rest.disabled
  const click = (e: MouseEvent<HTMLButtonElement>): void => {
    if (blocked) { e.preventDefault(); return }
    onClick?.(e)
  }
  // Same element tree whether blocked or not (no remount, focus kept). The reason sits next to the
  // button, not inside it, so it describes the button without joining its accessible name.
  return (
    <>
      <button type={type} className={cls} {...rest} onClick={click}
        {...(blocked ? { 'aria-disabled': true, 'aria-describedby': reasonId, title: rest.title ?? blockedReason } : {})}>
        {icon}
        {children}
      </button>
      {blocked && <span id={reasonId} className="sr-only">{blockedReason}</span>}
    </>
  )
}
