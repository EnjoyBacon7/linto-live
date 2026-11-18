import type { ReactNode, SVGProps } from 'react'

/** Inline SVG icons drawn like SF Symbols (1.5 px round strokes on a 16 px grid, currentColor). */

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { size?: number }

function Icon({ size = 16, className, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className ? `icon ${className}` : 'icon'}
      {...rest}
    >
      {children}
    </svg>
  )
}

export const ChevronUpDownIcon = (p: IconProps) => (
  <Icon {...p}><path d="M5 6.5 8 3.5l3 3M5 9.5l3 3 3-3" /></Icon>
)
export const PlusIcon = (p: IconProps) => <Icon {...p}><path d="M8 3v10M3 8h10" /></Icon>
export const PlayIcon = (p: IconProps) => (
  <Icon {...p}><path d="M5 3.2v9.6a.5.5 0 0 0 .76.43l7.6-4.8a.5.5 0 0 0 0-.86l-7.6-4.8A.5.5 0 0 0 5 3.2Z" fill="currentColor" /></Icon>
)
export const StopIcon = (p: IconProps) => (
  <Icon {...p}><rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" /></Icon>
)
export const RecordIcon = (p: IconProps) => <Icon {...p}><circle cx="8" cy="8" r="4.5" fill="currentColor" stroke="none" /></Icon>
/** Broadcast: a dot with radio waves on both sides. */
export const BroadcastIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
    <path d="M5.2 5.2a4 4 0 0 0 0 5.6M10.8 5.2a4 4 0 0 1 0 5.6M3.1 3.1a7 7 0 0 0 0 9.8M12.9 3.1a7 7 0 0 1 0 9.8" />
  </Icon>
)
export const CameraIcon = (p: IconProps) => (
  <Icon {...p}><rect x="1.75" y="4.25" width="9" height="7.5" rx="1.5" /><path d="m10.75 7 3.5-2v6l-3.5-2" /></Icon>
)
export const MicIcon = (p: IconProps) => (
  <Icon {...p}><rect x="5.75" y="1.75" width="4.5" height="8" rx="2.25" /><path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.25" /></Icon>
)
export const CaptionsIcon = (p: IconProps) => (
  <Icon {...p}><rect x="1.75" y="3.25" width="12.5" height="9.5" rx="2" /><path d="M4.5 9.5h3M9.5 9.5h2M4.5 7h7" /></Icon>
)
export const DisplayIcon = (p: IconProps) => (
  <Icon {...p}><rect x="1.75" y="2.25" width="12.5" height="8.5" rx="1.5" /><path d="M6 13.75h4M8 10.75v3" /></Icon>
)
export const EllipsisIcon = (p: IconProps) => (
  <Icon {...p}><circle cx="3.5" cy="8" r=".6" fill="currentColor" /><circle cx="8" cy="8" r=".6" fill="currentColor" /><circle cx="12.5" cy="8" r=".6" fill="currentColor" /></Icon>
)
export const WarningIcon = (p: IconProps) => (
  <Icon {...p}><path d="M7.13 2.5a1 1 0 0 1 1.74 0l5.5 9.75a1 1 0 0 1-.87 1.5H2.5a1 1 0 0 1-.87-1.5Z" /><path d="M8 6.25v3M8 11.5h.01" /></Icon>
)
export const ErrorIcon = (p: IconProps) => (
  <Icon {...p}><circle cx="8" cy="8" r="6.25" /><path d="M8 4.75v3.75M8 11h.01" /></Icon>
)
export const CheckIcon = (p: IconProps) => <Icon {...p}><path d="m3.5 8.5 3 3 6-7" /></Icon>
export const CloseIcon = (p: IconProps) => <Icon {...p}><path d="m4.5 4.5 7 7M11.5 4.5l-7 7" /></Icon>
export const SignOutIcon = (p: IconProps) => (
  <Icon {...p}><path d="M9.5 2.75H4a1.25 1.25 0 0 0-1.25 1.25v8A1.25 1.25 0 0 0 4 13.25h5.5M7 8h7M11.5 5.5 14 8l-2.5 2.5" /></Icon>
)
export const ChevronRightIcon = (p: IconProps) => <Icon {...p}><path d="m6 3.5 4.5 4.5L6 12.5" /></Icon>
/** Settings: two sliders (opens a « Paramètres… » sheet). */
export const SlidersIcon = (p: IconProps) => (
  <Icon {...p}><path d="M2.5 5h6M12.5 5h1M2.5 11h1M7.5 11h6" /><circle cx="10.5" cy="5" r="1.75" /><circle cx="5.5" cy="11" r="1.75" /></Icon>
)
/** Overlays: two stacked layers. */
export const LayersIcon = (p: IconProps) => (
  <Icon {...p}><path d="M8 2.5 14 5.75 8 9 2 5.75Z" /><path d="m2 9.25 6 3.25 6-3.25" /></Icon>
)
export const LockIcon = (p: IconProps) => (
  <Icon {...p}><rect x="3.25" y="7.25" width="9.5" height="6.5" rx="1.5" /><path d="M5.25 7.25V5a2.75 2.75 0 0 1 5.5 0v2.25" /></Icon>
)
export const BellIcon = (p: IconProps) => (
  <Icon {...p}><path d="M4 11.25V7a4 4 0 0 1 8 0v4.25l1.25 1.5H2.75ZM6.5 14h3" /></Icon>
)
