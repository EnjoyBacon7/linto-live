import { useCallback, useEffect, useState } from 'react'
import type { SetupData } from '../../shared/ipc'
import type { Settings } from '../../shared/types'
import { VuMeter } from '../components/VuMeter'
import { ipcErrorMessage } from '../ipcError'

export function Setup({ onStarted }: { onStarted: (reused: boolean) => void }) {
  const [data, setData] = useState<SetupData | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const d = await window.lintoLive.setup.load()
      setData(d)
      setSettings(d.settings)
      setName((n) => n || d.settings.lastSessionName || '')
    } catch (e) { setError(ipcErrorMessage(e)) }
  }, [])
  useEffect(() => { void load() }, [load])

  if (!data || !settings) return <div className="card">{error ? <p className="error" role="alert">{error}</p> : <p>Chargement…</p>}</div>

  const change = async (patch: Partial<Settings>, reload = false): Promise<void> => {
    setSettings({ ...settings, ...patch })
    try {
      await window.lintoLive.setup.save(patch)
      if (reload) await load()
    } catch (e) { setError(ipcErrorMessage(e)) }
  }
  const ready = name.trim() !== '' && !!settings.videoDeviceId && !!settings.audioDeviceId
  const start = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const r = await window.lintoLive.live.start(name.trim())
      if (r.ok) onStarted(r.reused)
      else setError(r.message)
    } catch (e) { setError(ipcErrorMessage(e)) } finally { setBusy(false) }
  }
  const displayIdx = data.displays.findIndex((d) => d.name === settings.output?.name && d.x === settings.output?.x && d.y === settings.output?.y)

  return (
    <form className="card setup" onSubmit={(e) => { e.preventDefault(); if (ready && !busy) void start() }}>
      <h1>Préparer la session</h1>
      {data.organizations.length > 1 && (
        <label>Organisation
          <select value={settings.orgId ?? ''} onChange={(e) => void change({ orgId: e.target.value }, true)}>
            <option value="" disabled>Choisir…</option>
            {data.organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
      )}
      <label>Profil de transcription
        <select value={settings.profileId ?? ''} onChange={(e) => void change({ profileId: Number(e.target.value) })}>
          <option value="" disabled>Choisir…</option>
          {data.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label>Entrée vidéo
        <select value={settings.videoDeviceId ?? ''} onChange={(e) => void change({ videoDeviceId: e.target.value })}>
          <option value="" disabled>Choisir…</option>
          {data.videoDevices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </label>
      <label>Entrée audio
        <select value={settings.audioDeviceId ?? ''} onChange={(e) => void change({ audioDeviceId: e.target.value })}>
          <option value="" disabled>Choisir…</option>
          {data.audioDevices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </label>
      <VuMeter />
      <label>Écran de sortie
        <select value={displayIdx >= 0 ? displayIdx : ''} onChange={(e) => {
          const d = data.displays[Number(e.target.value)]
          if (d) void change({ output: { name: d.name, x: d.x, y: d.y, width: d.width, height: d.height } })
        }}>
          <option value="" disabled>Choisir…</option>
          {data.displays.map((d, i) => <option key={i} value={i}>{d.name} ({d.width}×{d.height})</option>)}
        </select>
      </label>
      <label>Nom de la session
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void change({ lastSessionName: name.trim() })} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="primary big" disabled={!ready || busy}>Démarrer</button>
    </form>
  )
}
