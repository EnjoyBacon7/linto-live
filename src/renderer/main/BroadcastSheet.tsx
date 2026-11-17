import { useEffect, useState, type FormEvent } from 'react'
import { isBroadcastServer } from '../../shared/broadcast'
import { Button } from '../ui/Button'
import { Sheet } from '../ui/Sheet'
import { TextField } from '../ui/TextField'

/** `key` absent: the saved stream key is kept; '' forgets it. */
export interface BroadcastConfig { server: string; key?: string }

export interface BroadcastSheetProps {
  open: boolean
  server: string
  /** A stream key is saved (it is never sent back to the window). */
  keySet: boolean
  onApply(c: BroadcastConfig): void
  onCancel(): void
}

/** « Paramètres de diffusion »: the RTMP(S) server and the stream key the platform gives (YouTube, Twitch…). */
export function BroadcastSheet({ open, server, keySet, onApply, onCancel }: BroadcastSheetProps) {
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [forget, setForget] = useState(false)
  useEffect(() => {
    if (!open) return
    setUrl(server)
    setKey('')
    setForget(false)
  }, [open])

  const trimmed = url.trim()
  const ok = trimmed === '' || isBroadcastServer(trimmed)
  // The saved key belongs to the saved server: another server needs its own key.
  const keyKept = keySet && trimmed === server
  const submit = (e?: FormEvent): void => {
    e?.preventDefault()
    if (!ok) return
    const k = key.trim()
    onApply({ server: trimmed, ...(k ? { key: k } : forget ? { key: '' } : {}) })
  }
  return (
    <Sheet title="Paramètres de diffusion" open={open} onClose={onCancel}
      footer={<>
        <Button size="large" onClick={onCancel}>Annuler</Button>
        <Button size="large" variant="primary" disabled={!ok} onClick={() => submit()}>Appliquer</Button>
      </>}>
      <form className="sheet-form" onSubmit={submit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}>
        <TextField label="Serveur (RTMP ou RTMPS)" value={url} placeholder="rtmp://a.rtmp.youtube.com/live2"
          error={ok ? undefined : 'Saisissez une adresse commençant par rtmp:// ou rtmps://.'}
          onChange={(e) => setUrl(e.target.value)} />
        <TextField label="Clé de stream" type="password" autoComplete="off" value={key}
          placeholder={keyKept && !forget ? 'Enregistrée — laisser vide pour la garder' : ''}
          onChange={(e) => { setKey(e.target.value); setForget(false) }} />
        {keySet && !keyKept && trimmed !== '' && !key && (
          <p className="sheet-detail">La clé enregistrée appartient à l'ancien serveur : elle sera oubliée. Saisissez celle du nouveau.</p>
        )}
        {keyKept && !key && (
          <label className="check">
            <input type="checkbox" checked={forget} onChange={(e) => setForget(e.target.checked)} />
            <span>Oublier la clé enregistrée</span>
          </label>
        )}
        <p className="sheet-detail">
          La plateforme (YouTube, Twitch, PeerTube…) fournit l'adresse du serveur et la clé de stream. L'image en
          Full HD, sous-titres compris, et le son du micro y sont envoyés à chaque Démarrer. OBS ne pouvant pas
          enregistrer et diffuser en même temps, la diffusion remplace l'enregistrement.
        </p>
      </form>
    </Sheet>
  )
}
