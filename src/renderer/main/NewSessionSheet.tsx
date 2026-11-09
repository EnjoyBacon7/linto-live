import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { Organization, TranscriberProfile } from '../../shared/types'
import { Button } from '../ui/Button'
import { PopUp } from '../ui/PopUp'
import { Sheet } from '../ui/Sheet'
import { TextField } from '../ui/TextField'

export interface NewSessionSheetProps {
  open: boolean
  organizations: Organization[]
  orgId?: string
  profiles: TranscriberProfile[]
  profileId?: number
  onOrgChange(id: string): void
  onSubmit(name: string, profileId: number | undefined): void
  onCancel(): void
}

/** « Nouvelle session… »: name + transcription profile (+ organisation). Creates nothing on LinTO. */
export function NewSessionSheet(p: NewSessionSheetProps) {
  const [name, setName] = useState('')
  const [profile, setProfile] = useState<number | undefined>(p.profileId)
  useEffect(() => {
    if (!p.open) return
    setName('')
    setProfile(p.profileId)
  }, [p.open])
  // The profile list changes with the organisation: keep a valid choice.
  useEffect(() => {
    if (p.profiles.length > 0 && !p.profiles.some((x) => x.id === profile)) setProfile(p.profileId ?? p.profiles[0]!.id)
  }, [p.profiles])

  const ok = name.trim() !== '' && (p.profiles.length === 0 || profile !== undefined)
  const submit = (e?: FormEvent | KeyboardEvent): void => {
    e?.preventDefault()
    if (ok) p.onSubmit(name.trim(), profile)
  }
  return (
    <Sheet title="Nouvelle session" open={p.open} onClose={p.onCancel}
      footer={<>
        <Button size="large" onClick={p.onCancel}>Annuler</Button>
        <Button size="large" variant="primary" disabled={!ok} onClick={() => submit()}>OK</Button>
      </>}>
      <form className="sheet-form" onSubmit={submit}>
        <TextField label="Nom" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(e) }} placeholder="Ex. Conférence du 12 mars" />
        {p.organizations.length > 1 && (
          <label className="field">
            <span className="field-label">Organisation</span>
            <PopUp label="Organisation" value={p.orgId ?? ''} placeholder="Choisir…"
              options={p.organizations.map((o) => ({ value: o.id, label: o.name }))} onChange={p.onOrgChange} />
          </label>
        )}
        <label className="field">
          <span className="field-label">Profil de transcription</span>
          <PopUp label="Profil de transcription" value={profile === undefined ? '' : String(profile)} placeholder="Choisir…"
            options={p.profiles.map((x) => ({ value: String(x.id), label: x.name }))} onChange={(v) => setProfile(Number(v))} />
        </label>
      </form>
    </Sheet>
  )
}
