import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface SeedOptions {
  canvas: { width: 1920; height: 1080; fps: 30 }
  platform: NodeJS.Platform
}

/**
 * Advanced output mode, two outputs on the full HD canvas. The stream output only carries the room audio to
 * LinTO, so its encoder rescales to 640×360 at a low bitrate. The recording output is OBS's « Custom Output
 * (FFmpeg) »: its URL is set at each start (ObsController.startRecord / startBroadcast), either a local MKV
 * file or an RTMP(S) server (online broadcast, see Settings.broadcast), at the full output (QR code
 * readable, sharp subtitles). OBS has a single stream output and LinTO uses it: this is the only native
 * second output. Its type is fixed when OBS creates its outputs (launch), hence always FFmpeg.
 */
const STREAM = { width: 640, height: 360, videoKbps: 200 }
const RECORD = { videoKbps: 6000, audioKbps: 128, gop: 60 }
const AUDIO_KBPS = 128
/** OBS_SCALE_BILINEAR (libobs enum obs_scale_type). */
const SCALE_BILINEAR = 3
/** FFmpeg AVCodecID values OBS stores next to the encoder names (AV_CODEC_ID_H264, AV_CODEC_ID_AAC). */
const AV_CODEC_ID_H264 = 27
const AV_CODEC_ID_AAC = 86018

/**
 * Advanced-mode stream encoder id (OBS 32 encoder ids, not the Simple-mode aliases): the hardware H.264
 * encoder (VideoToolbox) on macOS — the app ships for Apple Silicon only — and x264 on Linux.
 */
const videoEncoder = (p: NodeJS.Platform): string => (p === 'darwin' ? 'com.apple.videotoolbox.videoencoder.ave.avc' : 'obs_x264')

/** FFmpeg (libavcodec) H.264 encoder of the recording output: hardware on macOS, x264 on Linux. */
const ffVideoEncoder = (p: NodeJS.Platform): { name: string; options: string } =>
  p === 'darwin' ? { name: 'h264_videotoolbox', options: '' } : { name: 'libx264', options: 'preset=veryfast' }

/** Encoder settings, read by OBS from streamEncoder.json in the profile directory. */
function encoderSettings(p: NodeJS.Platform, kbps: number, x264Preset: string): Record<string, unknown> {
  const common = { rate_control: 'CBR', bitrate: kbps, keyint_sec: 2 }
  return p === 'darwin' ? { ...common, profile: 'high' } : { ...common, preset: x264Preset, profile: 'high' }
}

/** INI content we own: section → ordered [key, value] pairs. Other keys/sections belong to OBS or the user. */
type IniSpec = [section: string, keys: [string, string][]][]

const GENERAL: [string, string][] = [
  ['FirstRun', 'true'],
  ['LastVersion', '536936448'],
  ['InfoLastVersion', '35188667056128'],
  ['InfoIncrement', '999'],
  ['EnableAutoUpdates', 'false'],
  ['MacOSPermissionsDialogLastShown', '1'],
  ['Pre31Migrated', 'true']
]

/**
 * OBS's own tray icon. macOS: needed, upstream OBS only starts hidden with it. Linux: off, it would show
 * in the panel (Ubuntu) and offer to open or quit OBS; our patched OBS starts hidden without it
 * (scripts/obs-linux-patches).
 */
const obsTrayIcon = (p: NodeJS.Platform): string => String(p === 'darwin')

function iniSpecs(o: SeedOptions): Record<string, IniSpec> {
  const { width, height, fps } = o.canvas
  const ff = ffVideoEncoder(o.platform)
  const tray = obsTrayIcon(o.platform)
  return {
    'global.ini': [['General', GENERAL]],
    'user.ini': [
      ['General', [['FirstRun', 'true'], ['ConfirmOnExit', 'false']]],
      // ProjectorAlwaysOnTop: the output window opens above the main window. The hidden OBS cannot be
      // brought to the front (on macOS its activation policy is « prohibited »), so its window would open behind.
      ['BasicWindow', [
        ['SysTrayEnabled', tray], ['SysTrayWhenStarted', tray], ['SaveProjectors', 'false'], ['ProjectorAlwaysOnTop', 'true']
      ]]
    ],
    'basic/profiles/LinTO Live/basic.ini': [
      ['General', [['Name', 'LinTO Live']]],
      [
        'Video',
        [
          ['BaseCX', String(width)],
          ['BaseCY', String(height)],
          ['OutputCX', String(width)],
          ['OutputCY', String(height)],
          ['FPSType', '0'],
          ['FPSCommon', String(fps)]
        ]
      ],
      ['Output', [['Mode', 'Advanced']]],
      [
        'AdvOut',
        [
          ['Encoder', videoEncoder(o.platform)],
          ['TrackIndex', '1'],
          ['Rescale', 'true'],
          ['RescaleFilter', String(SCALE_BILINEAR)],
          ['RescaleRes', `${STREAM.width}x${STREAM.height}`],
          ['Track1Bitrate', String(AUDIO_KBPS)],
          ['RecType', 'FFmpeg'],
          // The URL (file path or server) is ours, set at each start: OBS must not build a file name.
          ['FFOutputToFile', 'false'],
          ['FFURL', ''],
          ['FFFormat', 'matroska'],
          ['FFFormatMimeType', 'video/x-matroska'],
          ['FFMCustom', ''],
          ['FFVEncoder', ff.name],
          ['FFVEncoderId', String(AV_CODEC_ID_H264)],
          ['FFVCustom', ff.options],
          ['FFVBitrate', String(RECORD.videoKbps)],
          // A keyframe every 2 s (30 fps): what streaming platforms ask for.
          ['FFVGOPSize', String(RECORD.gop)],
          ['FFRescale', 'false'],
          ['FFAEncoder', 'aac'],
          ['FFAEncoderId', String(AV_CODEC_ID_AAC)],
          ['FFACustom', ''],
          ['FFABitrate', String(RECORD.audioKbps)],
          // Bit mask of the audio tracks: track 1 (the micro) only.
          ['FFAudioMixes', '1']
        ]
      ]
    ]
  }
}

const renderSection = ([name, keys]: IniSpec[number]): string => `[${name}]\n${keys.map(([k, v]) => `${k}=${v}`).join('\n')}\n`
const renderIni = (spec: IniSpec): string => spec.map(renderSection).join('\n')

const PROFILE_DIR = 'basic/profiles/LinTO Live/'

/** Files we own entirely: rewritten on every launch (so updates reach existing installs). */
function ownedFiles(o: SeedOptions): Record<string, string> {
  const json = (v: unknown): string => JSON.stringify(v, null, 2)
  return {
    [PROFILE_DIR + 'streamEncoder.json']: json(encoderSettings(o.platform, STREAM.videoKbps, 'ultrafast'))
  }
}

export function seedFiles(o: SeedOptions): Record<string, string> {
  const ini = Object.fromEntries(Object.entries(iniSpecs(o)).map(([rel, spec]) => [rel, renderIni(spec)]))
  return {
    ...ini,
    ...ownedFiles(o),
    'basic/scenes/LinTO Live.json': JSON.stringify(
      {
        name: 'LinTO Live',
        current_scene: 'LinTO Live',
        current_program_scene: 'LinTO Live',
        scene_order: [{ name: 'LinTO Live' }],
        sources: [
          { id: 'scene', name: 'LinTO Live', versioned_id: 'scene', settings: { items: [], id_counter: 0 } }
        ],
        groups: [],
        transitions: [],
        modules: {}
      },
      null,
      2
    ),
    'plugin_config/obs-websocket/config.json': JSON.stringify(
      { first_load: false, server_enabled: true, auth_required: true, alerts_enabled: false },
      null,
      2
    )
  }
}

/**
 * Re-applies our keys to an existing INI file: in each section we own, our keys are rewritten (at the
 * end of the section); every other key and section (written by OBS or the user) is kept as is.
 * Missing sections are appended.
 */
export function mergeIni(existing: string, spec: IniSpec): string {
  const owned = new Map(spec.map(([name, keys]) => [name, keys]))
  const managed = (section: string | null, line: string): boolean => {
    const keys = section === null ? undefined : owned.get(section)
    if (!keys || !line.includes('=')) return false
    const k = line.split('=')[0].trim()
    return keys.some(([key]) => key === k)
  }
  const out: string[] = []
  const seen = new Set<string>()
  let section: string | null = null
  const closeSection = (): void => {
    const keys = section === null ? undefined : owned.get(section)
    if (!keys) return
    let blank = 0
    while (out.length && out[out.length - 1].trim() === '') {
      out.pop()
      blank++
    }
    out.push(...keys.map(([k, v]) => `${k}=${v}`))
    for (let i = 0; i < blank; i++) out.push('')
  }
  for (const line of existing.split(/\r?\n/)) {
    const header = /^\s*\[(.+)\]\s*$/.exec(line)
    if (header) {
      closeSection()
      section = header[1]
      seen.add(section)
      out.push(line)
      continue
    }
    if (managed(section, line)) continue
    out.push(line)
  }
  closeSection()
  while (out.length && out[out.length - 1].trim() === '') out.pop()
  const missing = spec.filter(([name]) => !seen.has(name))
  let res = out.join('\n')
  if (missing.length) res = (res ? res + '\n\n' : '') + renderIni(missing)
  return res.endsWith('\n') ? res : res + '\n'
}

export async function writeSeed(obsConfigDir: string, o: SeedOptions): Promise<void> {
  const specs = iniSpecs(o)
  const owned = ownedFiles(o)
  for (const [rel, content] of Object.entries(seedFiles(o))) {
    const p = join(obsConfigDir, rel)
    await mkdir(dirname(p), { recursive: true })
    const spec = specs[rel]
    if (spec) {
      // INI files: our keys are re-applied on every launch (so updates reach existing installs).
      let existing: string | null = null
      try {
        existing = await readFile(p, 'utf8')
      } catch {
        /* absent */
      }
      await writeFile(p, existing === null ? content : mergeIni(existing, spec))
    } else if (rel in owned) {
      await writeFile(p, content)
    } else {
      await writeFile(p, content, { flag: 'wx' }).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'EEXIST') throw e
      })
    }
  }
  const sentinel = join(obsConfigDir, '.sentinel')
  const names = await readdir(sentinel).catch(() => [] as string[])
  await Promise.all(names.filter((n) => n.startsWith('run_')).map((n) => rm(join(sentinel, n), { force: true, recursive: true })))
}
