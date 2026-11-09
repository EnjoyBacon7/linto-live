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
export const ChevronDownIcon = (p: IconProps) => <Icon {...p}><path d="m4 6 4 4 4-4" /></Icon>
export const ChevronRightIcon = (p: IconProps) => <Icon {...p}><path d="m6 4 4 4-4 4" /></Icon>
export const PlusIcon = (p: IconProps) => <Icon {...p}><path d="M8 3v10M3 8h10" /></Icon>
export const PlayIcon = (p: IconProps) => (
  <Icon {...p}><path d="M5 3.2v9.6a.5.5 0 0 0 .76.43l7.6-4.8a.5.5 0 0 0 0-.86l-7.6-4.8A.5.5 0 0 0 5 3.2Z" fill="currentColor" /></Icon>
)
export const StopIcon = (p: IconProps) => (
  <Icon {...p}><rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" /></Icon>
)
export const RecordIcon = (p: IconProps) => <Icon {...p}><circle cx="8" cy="8" r="4.5" fill="currentColor" stroke="none" /></Icon>
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
export const WaveformIcon = (p: IconProps) => <Icon {...p}><path d="M2 8h.01M4.5 6v4M7 3.5v9M9.5 5.5v5M12 7v2M14 8h.01" /></Icon>
export const GearIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="2.25" />
    <path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1.05 1.05M11.35 11.35l1.05 1.05M3.6 12.4l1.05-1.05M11.35 4.65l1.05-1.05" />
  </Icon>
)
export const PersonIcon = (p: IconProps) => (
  <Icon {...p}><circle cx="8" cy="5.5" r="2.75" /><path d="M2.75 14c.6-2.6 2.7-4 5.25-4s4.65 1.4 5.25 4" /></Icon>
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
