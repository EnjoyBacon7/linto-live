import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import { languageLabel } from '../../shared/subtitleLanguage'
import type { NewSessionOptions, Organization, TranscriberProfile } from '../../shared/types'
import { Button } from '../ui/Button'
import { PopUp } from '../ui/PopUp'
import { Sheet } from '../ui/Sheet'
import { TextField } from '../ui/TextField'
import { Check } from './Inspector'

export interface NewSessionSheetProps {
  open: boolean
  organizations: Organization[]
  orgId?: string
  profiles: TranscriberProfile[]
  profileId?: number
  onOrgChange(id: string): void
  onSubmit(name: string, profileId: number | undefined, opts: NewSessionOptions): void
  onCancel(): void
}

/** « Nouvelle session… »: name + transcription profile (+ organisation). Creates nothing on LinTO. */
export function NewSessionSheet(p: NewSessionSheetProps) {
  const [name, setName] = useState('')
  const [profile, setProfile] = useState<number | undefined>(p.profileId)
  const [translations, setTranslations] = useState<string[]>([])
  const [visibility, setVisibility] = useState<NewSessionOptions['visibility']>('organization')
  const [password, setPassword] = useState('')
  useEffect(() => {
    if (!p.open) return
    setName('')
    setProfile(p.profileId)
    setVisibility('organization')
    setPassword('')
  }, [p.open])
  // Translations belong to the profile: none ticked on open or when the profile changes.
  useEffect(() => setTranslations([]), [p.open, profile])
  // The profile list changes with the organisation: keep a valid choice.
  useEffect(() => {
    if (p.profiles.length > 0 && !p.profiles.some((x) => x.id === profile)) setProfile(p.profileId ?? p.profiles[0]!.id)
  }, [p.profiles])

  // A session cannot be created without a profile: none listed means the role or the organisation offers none.
  const current = p.profiles.find((x) => x.id === profile)
  const ok = name.trim() !== '' && current !== undefined && (visibility !== 'password' || password.trim() !== '')
  const submit = (e?: FormEvent | KeyboardEvent): void => {
    e?.preventDefault()
    if (!ok) return
    const opts: NewSessionOptions = { translations, visibility }
    if (visibility === 'password') opts.password = password
    p.onSubmit(name.trim(), profile, opts)
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
            options={p.profiles.map((x) => ({ value: String(x.id), label: x.name }))} onChange={(v) => setProfile(Number(v))}
            disabled={p.profiles.length === 0} />
        </label>
        {current?.translations && current.translations.length > 0 && (
          <fieldset className="field sheet-checks">
            <legend className="field-label">Traductions</legend>
            {current.translations.map((code) => (
              <Check key={code} label={languageLabel(code)} checked={translations.includes(code)}
                onChange={(v) => setTranslations((t) => v ? [...t, code] : t.filter((c) => c !== code))} />
            ))}
          </fieldset>
        )}
        <label className="field">
          <span className="field-label">Visibilité</span>
          <PopUp label="Visibilité" value={visibility}
            options={[
              { value: 'organization', label: 'Organisation' }, { value: 'public', label: 'Public' },
              { value: 'password', label: 'Protégée par mot de passe' }, { value: 'private', label: 'Privée' }
            ]}
            onChange={(v) => setVisibility(v as NewSessionOptions['visibility'])} />
        </label>
        {visibility === 'password' && (
          <TextField label="Mot de passe" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        )}
        {p.profiles.length === 0 && (
          <p className="sheet-detail" role="note">
            Aucun profil de transcription disponible dans cette organisation : impossible d’y créer une session.
          </p>
        )}
      </form>
    </Sheet>
  )
}
