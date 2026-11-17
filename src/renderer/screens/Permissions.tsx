import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { MediaAccess, MediaPermission } from '../../shared/types'
import { ipcErrorMessage } from '../ipcError'
import { Button } from '../ui/Button'
import { BellIcon, CameraIcon, CheckIcon, MicIcon, WarningIcon } from '../ui/icons'
import logo from '../assets/linto.svg'
import './permissions.css'

interface MediaRow {
  kind: MediaPermission
  title: string
  why: string
  icon: ReactNode
}

const MEDIA: MediaRow[] = [
  {
    kind: 'camera',
    title: 'Caméra',
    why: 'Pour afficher la vidéo de la salle, depuis une caméra ou une carte de capture.',
    icon: <CameraIcon size={20} />
  },
  {
    kind: 'microphone',
    title: 'Microphone',
    why: 'Pour envoyer le son du micro choisi à LinTO, qui le transcrit en direct.',
    icon: <MicIcon size={20} />
  }
]

export interface PermissionsProps {
  /** The user is done (whatever they granted): main remembers it and starts OBS. */
  onDone: () => void
}

/** First-launch page (macOS): asks for the camera, the microphone and the notifications, saying why. */
export function Permissions({ onDone }: PermissionsProps) {
  const [access, setAccess] = useState<Record<MediaPermission, MediaAccess>>({ camera: 'unknown', microphone: 'unknown' })
  const [busy, setBusy] = useState<MediaPermission | 'finish' | null>(null)
  const [notified, setNotified] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    window.lintoLive.permissions.status()
      .then((s) => setAccess({ camera: s.camera, microphone: s.microphone }))
      .catch((e) => setError(ipcErrorMessage(e)))
  }, [])
  useEffect(() => {
    refresh()
    // Back from System Settings: show what the user changed there.
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  const request = async (kind: MediaPermission): Promise<void> => {
    setBusy(kind)
    setError(null)
    try {
      const a = await window.lintoLive.permissions.request(kind)
      setAccess((cur) => ({ ...cur, [kind]: a }))
    } catch (e) {
      setError(ipcErrorMessage(e))
    } finally {
      setBusy(null)
    }
  }
  const openSettings = (kind: MediaPermission | 'notifications'): void => {
    setError(null)
    window.lintoLive.permissions.openSettings(kind).catch((e) => setError(ipcErrorMessage(e)))
  }
  const testNotification = (): void => {
    setError(null)
    window.lintoLive.permissions.testNotification()
      .then(() => setNotified(true))
      .catch((e) => setError(ipcErrorMessage(e)))
  }
  const finish = async (): Promise<void> => {
    setBusy('finish')
    setError(null)
    try {
      await window.lintoLive.permissions.finish()
      onDone()
    } catch (e) {
      setError(ipcErrorMessage(e))
      setBusy(null)
    }
  }

  const allGranted = access.camera === 'granted' && access.microphone === 'granted'

  return (
    <div className="perm-window">
      <div className="perm-titlebar drag" />
      <div className="perm-scroll">
        <div className="perm-page">
          <div className="perm-head">
            <img className="perm-logo" src={logo} alt="LinTO" width={64} height={64} draggable={false} />
            <h1 className="perm-title">Bienvenue dans LinTO Live</h1>
            <p className="perm-lead secondary">
              Pour filmer et transcrire tes directs, LinTO Live a besoin de quelques autorisations de macOS.
            </p>
          </div>

          <ul className="perm-list" aria-label="Autorisations">
            {MEDIA.map((m) => (
              <PermissionRow key={m.kind} icon={m.icon} title={m.title} why={m.why}>
                <MediaAction
                  title={m.title}
                  access={access[m.kind]}
                  busy={busy === m.kind}
                  disabled={busy !== null}
                  onRequest={() => void request(m.kind)}
                  onOpenSettings={() => openSettings(m.kind)}
                />
              </PermissionRow>
            ))}
            <PermissionRow
              icon={<BellIcon size={20} />}
              title="Notifications"
              why="Pour te prévenir quand le direct démarre, s’arrête ou rencontre un problème alors que la fenêtre est cachée. Facultatif."
            >
              {notified ? (
                <div className="perm-action">
                  <span className="perm-state secondary">Notification envoyée</span>
                  <Button variant="plain" onClick={() => openSettings('notifications')} aria-label="Ouvrir les réglages des notifications">
                    Réglages…
                  </Button>
                </div>
              ) : (
                <Button onClick={testNotification} disabled={busy !== null} aria-label="Activer les notifications">Activer</Button>
              )}
            </PermissionRow>
          </ul>

          {error && <p className="perm-error" role="alert">{error}</p>}

          <p className="perm-note secondary">
            {allGranted
              ? 'Tout est prêt. Tu pourras changer ces accès à tout moment dans Réglages Système › Confidentialité et sécurité.'
              : 'Tu peux continuer sans tout autoriser et changer ces accès plus tard dans Réglages Système › Confidentialité et sécurité. Sans caméra ni micro, le direct n’aura ni image ni transcription.'}
          </p>

          <div className="perm-actions">
            <Button variant="primary" size="large" disabled={busy !== null} onClick={() => void finish()}>Continuer</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function PermissionRow({ icon, title, why, children }: { icon: ReactNode; title: string; why: string; children: ReactNode }) {
  return (
    <li className="perm-row">
      <span className="perm-icon">{icon}</span>
      <div className="perm-text">
        <span className="perm-name">{title}</span>
        <span className="perm-why secondary">{why}</span>
      </div>
      {children}
    </li>
  )
}

function MediaAction({ title, access, busy, disabled, onRequest, onOpenSettings }: {
  title: string
  access: MediaAccess
  busy: boolean
  disabled: boolean
  onRequest: () => void
  onOpenSettings: () => void
}) {
  if (access === 'granted') {
    return (
      <span className="perm-state perm-granted">
        <CheckIcon className="perm-check" />
        Autorisé
      </span>
    )
  }
  if (access === 'denied' || access === 'restricted') {
    return (
      <div className="perm-action">
        <span className="perm-state perm-denied">
          <WarningIcon className="perm-warn" />
          {access === 'restricted' ? 'Bloqué' : 'Refusé'}
        </span>
        {access === 'denied' && (
          <Button onClick={onOpenSettings} aria-label={`Ouvrir les réglages : ${title}`}>Réglages…</Button>
        )}
      </div>
    )
  }
  // 'unknown' while the status loads: the button waits for it.
  return (
    <Button onClick={onRequest} disabled={disabled || access === 'unknown'} aria-label={`Autoriser : ${title}`}>
      {busy ? 'Demande…' : 'Autoriser'}
    </Button>
  )
}
