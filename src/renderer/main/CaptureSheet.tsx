import { useEffect, useState } from 'react'
import type { CaptureKind, CaptureTargets, DeviceItem, MediaAccess } from '../../shared/types'
import { ipcErrorMessage } from '../ipcError'
import { Button } from '../ui/Button'
import { PopUp } from '../ui/PopUp'
import { Sheet } from '../ui/Sheet'

export interface CaptureSheetProps {
  /** The kind of target to choose; null = closed. */
  kind: CaptureKind | null
  onPick(t: DeviceItem): void
  onCancel(): void
}

type Load = { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'denied'; access: MediaAccess } | { phase: 'ready'; items: DeviceItem[] } | { phase: 'portal' }

const TITLES: Record<CaptureKind, string> = { screen: 'Capturer un écran', window: 'Capturer une fenêtre' }
const NOUN: Record<CaptureKind, string> = { screen: 'Écran', window: 'Fenêtre' }
const PORTAL_NAME: Record<CaptureKind, string> = { screen: 'Écran (choisi dans le système)', window: 'Fenêtre (choisie dans le système)' }

/** Wayland: the target is picked in the system's dialog; a new id each time makes OBS show that dialog again. */
const portalTarget = (k: CaptureKind): DeviceItem => ({ id: `portal:${Date.now()}`, name: PORTAL_NAME[k] })

/**
 * Picks the screen or the window to capture. The list is asked of OBS only here (macOS: it needs the screen
 * recording access, which the sheet helps grant when it is missing).
 */
export function CaptureSheet({ kind, onPick, onCancel }: CaptureSheetProps) {
  const [load, setLoad] = useState<Load>({ phase: 'loading' })
  const [chosen, setChosen] = useState('')
  const [asked, setAsked] = useState(false)

  const refresh = (k: CaptureKind): void => {
    setLoad({ phase: 'loading' })
    window.lintoLive.setup.listCaptureTargets(k).then((r: CaptureTargets) => {
      if (r.ok === 'portal') return setLoad({ phase: 'portal' })
      if (!r.ok) return setLoad({ phase: 'denied', access: r.access })
      setLoad({ phase: 'ready', items: r.items })
      setChosen((c) => (r.items.some((i) => i.id === c) ? c : r.items[0]?.id ?? ''))
    }, (e: unknown) => setLoad({ phase: 'error', message: ipcErrorMessage(e) }))
  }

  useEffect(() => {
    if (!kind) return
    setChosen('')
    setAsked(false)
    refresh(kind)
  }, [kind])

  const grant = async (): Promise<void> => {
    // The first time, macOS shows its own prompt; afterwards only System Settings can grant it.
    if (asked) return void window.lintoLive.permissions.openSettings('screen').catch(() => {})
    setAsked(true)
    const access = await window.lintoLive.setup.requestScreenAccess().catch(() => 'unknown' as const)
    if (access === 'granted') refresh(kind!)
  }

  const items = load.phase === 'ready' ? load.items : []
  const target = load.phase === 'portal' && kind ? portalTarget(kind) : items.find((i) => i.id === chosen)
  return (
    <Sheet title={kind ? TITLES[kind] : ''} open={kind !== null} onClose={onCancel}
      footer={<>
        <Button size="large" onClick={onCancel}>Annuler</Button>
        <Button size="large" variant="primary" disabled={!target} onClick={() => target && onPick(target)}>Choisir</Button>
      </>}>
      <div className="sheet-form">
        {load.phase === 'loading' && <p className="sheet-detail">Recherche…</p>}
        {load.phase === 'error' && <p className="sheet-detail" role="alert">{load.message}</p>}
        {load.phase === 'denied' && (
          <>
            <p className="sheet-detail">
              macOS doit autoriser LinTO Live à enregistrer l’écran : dans Réglages Système, Confidentialité et
              sécurité › Enregistrement de l’écran, active LinTO Live, puis quitte et relance l’app.
            </p>
            <div><Button onClick={() => void grant()}>{asked ? 'Ouvrir les Réglages Système' : 'Autoriser…'}</Button></div>
          </>
        )}
        {load.phase === 'ready' && (items.length === 0
          ? <p className="sheet-detail">{kind === 'window' ? 'Aucune fenêtre à capturer.' : 'Aucun écran à capturer.'}</p>
          : <PopUp label={kind ? NOUN[kind] : ''} value={chosen} options={items.map((i) => ({ value: i.id, label: i.name }))}
              onChange={setChosen} />)}
        {load.phase === 'portal' && (
          <p className="sheet-detail">
            {kind === 'window' ? 'Après « Choisir », le système demande quelle fenêtre partager' : 'Après « Choisir », le système demande quel écran partager'}
            {' '}(onglet Écran ou Fenêtre de sa propre fenêtre). Ce choix est retenu aux démarrages suivants.
          </p>
        )}
        {kind && load.phase !== 'denied' && load.phase !== 'portal' && (
          <div><Button disabled={load.phase === 'loading'} onClick={() => refresh(kind)}>Actualiser</Button></div>
        )}
        {kind === 'window' && (load.phase === 'ready' || load.phase === 'portal') && (
          <p className="sheet-detail">Une fenêtre réduite ou fermée n’est plus capturée (la source de secours, s’il y en a une, prend le relais).</p>
        )}
      </div>
    </Sheet>
  )
}
