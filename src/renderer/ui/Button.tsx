import type { ButtonHTMLAttributes, ReactNode } from 'react'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'destructive' | 'plain'
  size?: 'regular' | 'large'
  icon?: ReactNode
}

/** macOS push button: 22 px (regular) / 28 px (large), 6 px radius; primary = accent fill. */
export function Button({ variant = 'default', size = 'regular', icon, className, type = 'button', children, ...rest }: ButtonProps) {
  const cls = ['btn', `btn-${variant}`, `btn-${size}`, className].filter(Boolean).join(' ')
  return (
    <button type={type} className={cls} {...rest}>
      {icon}
      {children}
    </button>
  )
}
