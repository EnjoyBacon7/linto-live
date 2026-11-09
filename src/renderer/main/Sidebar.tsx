import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Organization, SessionSummary } from '../../shared/types'
import { Button } from '../ui/Button'
import { StatusDot, type StatusDotProps } from '../ui/StatusDot'
import { CheckIcon, EllipsisIcon, PlusIcon, SignOutIcon } from '../ui/icons'

export const NO_STREAM_REASON =
  "LinTO Live ne peut pas envoyer le son à cette session (droits insuffisants ou pas d'entrée audio)"

export const STATUS: Record<SessionSummary['status'], { label: string; tone: StatusDotProps['tone'] }> = {
  active: { label: 'En direct', tone: 'live' },
  ready: { label: 'Prête', tone: 'ok' },
  paused: { label: 'En pause', tone: 'warn' },
  on_schedule: { label: 'Planifiée', tone: 'idle' }
}

export interface SidebarProps {
  sessions: SessionSummary[] | null
  error: string | null
  onRetry(): void
  selectedName: string | null
  /** A new session chosen in « Nouvelle session… », created on LinTO only at Démarrer. */
  pendingName: string | null
  onSelect(s: SessionSummary): void
  onNew(): void
  instance: string
  organizations: Organization[]
  orgId?: string
  onSwitchOrg(id: string): void
  onLogout(): void
  /** On air: logging out and changing organisation are refused (the show needs both). */
  onAir: boolean
}

const hostOf = (u: string): string => {
  try { return new URL(u).host || u } catch { return u }
}

export function Sidebar(p: SidebarProps) {
  const listRef = useRef<HTMLUListElement>(null)

  const onListKey = (e: KeyboardEvent<HTMLUListElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role=option]') ?? [])
    const i = items.indexOf(document.activeElement as HTMLElement)
    const next = items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
    next?.focus()
  }
  const activate = (e: KeyboardEvent<HTMLElement>, fn: () => void): void => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn() }
  }
  const org = p.organizations.find((o) => o.id === p.orgId)
  const hasSelection = (name: string): boolean => p.pendingName === null && p.selectedName === name

  return (
    <nav className="sidebar" aria-label="Barre latérale">
      <div className="sidebar-top drag" />
      <div className="sidebar-scroll">
        <h2 className="sidebar-section">Sessions</h2>
        {p.error ? (
          <div className="sidebar-note">
            <p className="selectable">{p.error}</p>
            <Button onClick={p.onRetry}>Réessayer</Button>
          </div>
        ) : p.sessions === null ? null : (
          <>
            <ul ref={listRef} className="sidebar-list" role="listbox" aria-label="Sessions" onKeyDown={onListKey}>
              {p.pendingName !== null && (
                <li
                  role="option"
                  aria-selected="true"
                  tabIndex={0}
                  className="sidebar-row is-selected is-pending"
                  title="Nouvelle session — créée sur LinTO au démarrage"
                >
                  <PlusIcon size={12} className="sidebar-row-icon" />
                  <span className="sidebar-row-name">{p.pendingName}</span>
                </li>
              )}
              {p.sessions.map((s, i) => {
                const selected = hasSelection(s.name)
                // Roving tab stop: the selected row, else the first row (the selection may not be listed).
                const tabStop = selected || (p.pendingName === null && i === 0 && !p.sessions?.some((x) => hasSelection(x.name)))
                const cls = ['sidebar-row', selected ? 'is-selected' : '', s.canStream ? '' : 'is-dimmed'].filter(Boolean).join(' ')
                return (
                  <li
                    key={s.id}
                    role="option"
                    aria-selected={selected}
                    tabIndex={tabStop ? 0 : -1}
                    className={cls}
                    title={s.canStream ? STATUS[s.status].label : NO_STREAM_REASON}
                    onClick={() => p.onSelect(s)}
                    onKeyDown={(e) => activate(e, () => p.onSelect(s))}
                  >
                    <StatusDot tone={STATUS[s.status].tone} pulse={s.status === 'active'} />
                    <span className="sidebar-row-name">{s.name}</span>
                  </li>
                )
              })}
            </ul>
            {p.sessions.length === 0 && p.pendingName === null && (
              <p className="sidebar-empty">Aucune session en cours</p>
            )}
          </>
        )}
        <button type="button" className="sidebar-row sidebar-new" onClick={p.onNew}>
          <PlusIcon size={12} className="sidebar-row-icon" />
          <span className="sidebar-row-name">Nouvelle session…</span>
        </button>
      </div>
      <div className="sidebar-footer">
        <div className="sidebar-account">
          <span className="sidebar-host selectable" title={p.instance}>{hostOf(p.instance)}</span>
          {org && p.organizations.length > 1 && <span className="sidebar-org">{org.name}</span>}
        </div>
        <AccountMenu {...p} />
      </div>
    </nav>
  )
}

function AccountMenu({ organizations, orgId, onSwitchOrg, onLogout, onAir }: SidebarProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: globalThis.KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false) } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    ref.current?.querySelector<HTMLElement>('[role^=menuitem]:not([disabled])')?.focus()
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  const pick = (fn: () => void) => () => { setOpen(false); fn() }

  return (
    <div className="account-menu" ref={ref}>
      <Button variant="plain" aria-label="Compte" title="Compte" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        icon={<EllipsisIcon />} />
      {open && (
        <div className="menu" role="menu" aria-label="Compte">
          {organizations.length > 1 && (
            <>
              <div className="menu-header">Organisation</div>
              {organizations.map((o) => (
                <button key={o.id} type="button" role="menuitemradio" aria-checked={o.id === orgId} className="menu-item" disabled={onAir}
                  onClick={pick(() => { if (o.id !== orgId) onSwitchOrg(o.id) })}>
                  <span className="menu-check">{o.id === orgId && <CheckIcon size={12} />}</span>
                  {o.name}
                </button>
              ))}
              <hr className="menu-separator" />
            </>
          )}
          <button type="button" role="menuitem" className="menu-item" disabled={onAir}
            title={onAir ? 'Arrête le direct avant de te déconnecter.' : undefined} onClick={pick(onLogout)}>
            <span className="menu-check"><SignOutIcon size={12} /></span>
            Se déconnecter
          </button>
        </div>
      )}
    </div>
  )
}
