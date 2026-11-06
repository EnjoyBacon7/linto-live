// Spike 1: hidden OBS + program projector.
// Usage: node hidden-projector.mjs [--no-tray] [--monitor <index>]   (default monitor -1 = windowed)
import { startObs, sleep } from './obs-common.mjs'

const noTray = process.argv.includes('--no-tray')
const mi = process.argv.indexOf('--monitor')
const monitorIndex = mi > 0 ? Number(process.argv[mi + 1]) : -1

const { obs, child, home, stop } = await startObs({ noTray })
console.log('OBS pid', child.pid, 'home', home)
try {
  const ver = await obs.call('GetVersion')
  console.log('obs', ver.obsVersion, 'ws', ver.obsWebSocketVersion)
  await obs.call('CreateInput', {
    sceneName: 'LinTO Live', inputName: 'spike-color', inputKind: 'color_source_v3',
    inputSettings: { color: 0xff00aa00, width: 1920, height: 1080 }
  })
  const { monitors } = await obs.call('GetMonitorList')
  console.log('monitors', JSON.stringify(monitors))
  await obs.call('OpenVideoMixProjector', {
    videoMixType: 'OBS_WEBSOCKET_VIDEO_MIX_TYPE_PROGRAM', monitorIndex
  })
  console.log('projector opened, monitorIndex', monitorIndex, '- inspect windows now (HOLD_MS, default 8 s)')
  await sleep(Number(process.env.HOLD_MS || 8000))
} finally {
  await stop()
}
