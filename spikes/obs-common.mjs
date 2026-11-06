// Shared helpers for the spikes: seed an isolated OBS config dir, spawn OBS hidden, connect.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'
import { OBSWebSocket } from 'obs-websocket-js'

export const OBS_BIN = '/Applications/OBS.app/Contents/MacOS/OBS'
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function seed(home) {
  const root = join(home, 'Library', 'Application Support', 'obs-studio')
  const w = (rel, s) => {
    const p = join(root, rel)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, s)
  }
  w('global.ini', `[General]
FirstRun=true
LastVersion=536936448
InfoLastVersion=35188667056128
InfoIncrement=999
EnableAutoUpdates=false
MacOSPermissionsDialogLastShown=1
Pre31Migrated=true
`)
  w('user.ini', `[General]
FirstRun=true
ConfirmOnExit=false

[BasicWindow]
SysTrayEnabled=true
SysTrayWhenStarted=true
SaveProjectors=false
`)
  w('basic/profiles/LinTO Live/basic.ini', `[General]
Name=LinTO Live

[Video]
BaseCX=1920
BaseCY=1080
OutputCX=1920
OutputCY=1080
FPSType=0
FPSCommon=30
`)
  w('basic/scenes/LinTO Live.json', JSON.stringify({
    name: 'LinTO Live',
    current_scene: 'LinTO Live',
    current_program_scene: 'LinTO Live',
    scene_order: [{ name: 'LinTO Live' }],
    sources: [{ id: 'scene', name: 'LinTO Live', versioned_id: 'scene', settings: { items: [], id_counter: 0 } }],
    groups: [],
    transitions: [],
    modules: {}
  }, null, 2))
  w('plugin_config/obs-websocket/config.json', JSON.stringify({
    first_load: false, server_enabled: true, auth_required: true, alerts_enabled: false
  }, null, 2))
}

function freePort() {
  return new Promise((res, rej) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) })
    s.on('error', rej)
  })
}

// opts.noTray: drop --minimize-to-tray
export async function startObs({ noTray = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'linto-live-spike-'))
  seed(home)
  const port = await freePort()
  const password = randomBytes(12).toString('hex')
  const args = [
    '--multi', ...(noTray ? [] : ['--minimize-to-tray']), '--disable-updater', '--disable-missing-files-check',
    '--collection', 'LinTO Live', '--profile', 'LinTO Live', '--scene', 'LinTO Live',
    '--websocket_port', String(port), '--websocket_password', password
  ]
  const child = spawn(OBS_BIN, args, { env: { ...process.env, CFFIXED_USER_HOME: home }, stdio: 'ignore' })
  const obs = new OBSWebSocket()
  const deadline = Date.now() + 30000
  for (;;) {
    try { await obs.connect(`ws://127.0.0.1:${port}`, password); break }
    catch (e) { if (Date.now() > deadline) { child.kill('SIGTERM'); throw e } await sleep(500) }
  }
  const stop = async () => {
    try { await obs.disconnect() } catch {}
    child.kill('SIGTERM')
    await sleep(1500)
    rmSync(home, { recursive: true, force: true })
  }
  return { obs, child, home, stop }
}
