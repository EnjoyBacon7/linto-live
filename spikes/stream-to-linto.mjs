// Spike 2: OBS -> LinTO audio streaming. NOT to be run without credentials.
// Env: LINTO_TOKEN  or  LINTO_EMAIL + LINTO_PASSWORD
//      LINTO_INSTANCE (default https://studio.linto.ai), LINTO_ORG_ID (default first org),
//      LINTO_PROFILE_ID (default first transcriber profile), SPIKE_PROTOCOL=srt|rtmp (default srt),
//      SPIKE_AUDIO_DEVICE (CoreAudio device_id, optional), SPIKE_AUDIO_FILE (local file looped instead of the mic),
//      SPIKE_DURATION_S (default 60)
// Usage: node stream-to-linto.mjs
import { io } from 'socket.io-client'
import { startObs, sleep } from './obs-common.mjs'

const instance = (process.env.LINTO_INSTANCE || 'https://studio.linto.ai').replace(/\/$/, '')
const protocol = process.env.SPIKE_PROTOCOL || 'srt'
const duration = Number(process.env.SPIKE_DURATION_S || 60)

if (!process.env.LINTO_TOKEN && !(process.env.LINTO_EMAIL && process.env.LINTO_PASSWORD)) {
  console.error('Missing credentials: set LINTO_TOKEN, or LINTO_EMAIL and LINTO_PASSWORD (optionally LINTO_INSTANCE, LINTO_ORG_ID, LINTO_PROFILE_ID).')
  process.exit(2)
}

const cfgText = await (await fetch(`${instance}/config.js`)).text()
const cfg = (k) => cfgText.match(new RegExp(`"${k}":\\s*"([^"]*)"`))?.[1]
const API = cfg('VUE_APP_CONVO_API'), AUTH = cfg('VUE_APP_CONVO_AUTH')
const WS = cfg('VUE_APP_SESSION_WS'), WS_PATH = cfg('VUE_APP_SESSION_WS_PATH')
console.log({ API, AUTH, WS, WS_PATH })

let token = process.env.LINTO_TOKEN
if (!token) {
  const r = await fetch(`${AUTH}/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.LINTO_EMAIL, password: process.env.LINTO_PASSWORD })
  })
  if (!r.ok) throw new Error(`login failed ${r.status} ${await r.text()}`)
  token = (await r.json()).auth_token
}
const api = async (path, init = {}) => {
  const r = await fetch(`${API}${path}`, {
    ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers }
  })
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${path} -> ${r.status} ${await r.text()}`)
  return r.status === 204 ? null : r.json()
}

const orgId = process.env.LINTO_ORG_ID || (await api('/organizations'))[0]?._id || (await api('/organizations'))[0]?.id
const profiles = await api(`/organizations/${orgId}/transcriber_profiles`)
const profileId = process.env.LINTO_PROFILE_ID ? Number(process.env.LINTO_PROFILE_ID) : profiles[0]?.id
console.log({ orgId, profileId })

const session = await api(`/organizations/${orgId}/sessions`, {
  method: 'POST',
  body: JSON.stringify({
    name: `linto-live spike ${new Date().toISOString()}`,
    channels: [{ transcriberProfileId: profileId, name: 'spike', translations: [], diarization: false, keepAudio: false, compressAudio: true }],
    meta: {}, scheduleOn: null, endOn: null, autoStart: true, autoEnd: false, visibility: 'organization'
  })
})
const channel = session.channels[0]
const endpoints = channel.streamEndpoints || {}
console.log('session', session.id, 'status', session.status, 'endpoints', endpoints)

// Mapping (Task 5)
let service
if (protocol === 'srt' && endpoints.srt) service = { server: endpoints.srt, key: '' }
else if (endpoints.rtmp) {
  const i = endpoints.rtmp.lastIndexOf('/')
  service = { server: endpoints.rtmp.slice(0, i), key: endpoints.rtmp.slice(i + 1) }
} else throw new Error('no usable endpoint')

const sock = io(WS, { path: WS_PATH, transports: ['websocket'], auth: { token } })
const t0 = Date.now()
sock.on('connect', () => { console.log('socket connected'); sock.emit('join_room', `${session.id}/${channel.id}`) })
sock.on('partial', (m) => console.log('partial', m.text))
sock.on('final', (m) => console.log(`final +${((Date.now() - t0) / 1000).toFixed(1)}s [${m.start}-${m.end}]`, m.text))
sock.on('connect_error', (e) => console.error('socket error', e.message))

const { obs, stop } = await startObs()
try {
  if (process.env.SPIKE_AUDIO_FILE) {
    // Deterministic test audio: a local file played in a loop by OBS (no mic needed)
    await obs.call('CreateInput', {
      sceneName: 'LinTO Live', inputName: 'speech', inputKind: 'ffmpeg_source',
      inputSettings: { local_file: process.env.SPIKE_AUDIO_FILE, looping: true, restart_on_activate: false }
    })
  } else {
    await obs.call('CreateInput', {
      sceneName: 'LinTO Live', inputName: 'mic', inputKind: 'coreaudio_input_capture',
      inputSettings: process.env.SPIKE_AUDIO_DEVICE ? { device_id: process.env.SPIKE_AUDIO_DEVICE } : {}
    })
  }
  await obs.call('SetStreamServiceSettings', { streamServiceType: 'rtmp_custom', streamServiceSettings: service })
  await obs.call('StartStream')
  console.log(`streaming via ${protocol}; speak now (${duration}s)`)
  for (let i = 0; i < duration / 5; i++) {
    await sleep(5000)
    const s = await api(`/organizations/${orgId}/sessions/${session.id}`)
    console.log('session status', s.status)
  }
} finally {
  try { await obs.call('StopStream') } catch {}
  sock.close()
  try { await api(`/organizations/${orgId}/sessions/${session.id}/stop?force=true&waitFinal=true`, { method: 'PUT' }) } catch (e) { console.error(e.message) }
  await stop()
}
