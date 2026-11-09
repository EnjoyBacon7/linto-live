export interface StatusDotProps {
  tone: 'live' | 'ok' | 'warn' | 'bad' | 'idle'
  pulse?: boolean
  className?: string
}

/** 8 px status light; purely visual — pair it with a text label. */
export function StatusDot({ tone, pulse, className }: StatusDotProps) {
  const cls = ['dot', `dot-${tone}`, pulse ? 'dot-pulse' : '', className].filter(Boolean).join(' ')
  return <span className={cls} aria-hidden="true" />
}
