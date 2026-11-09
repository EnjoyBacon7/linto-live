import type { ReactNode } from 'react'
import { ErrorIcon, WarningIcon } from './icons'

export interface BannerProps {
  tone: 'warn' | 'bad'
  children: ReactNode
  action?: ReactNode
}

/** Slim, full-width notice at the top of the content area (warning or error). */
export function Banner({ tone, children, action }: BannerProps) {
  return (
    <div role="alert" className={`banner banner-${tone}`}>
      {tone === 'warn' ? <WarningIcon className="banner-icon" /> : <ErrorIcon className="banner-icon" />}
      <div className="banner-text">{children}</div>
      {action && <div className="banner-action">{action}</div>}
    </div>
  )
}
