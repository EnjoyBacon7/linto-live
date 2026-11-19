import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Video encoder of the recording / online-broadcast output (OBS's custom FFmpeg output, 1920×1080 at
 * 6 Mb/s, see seed.ts): the costly encode of a show. macOS always has VideoToolbox. Linux uses NVIDIA's
 * NVENC when OBS's own probe (obs-nvenc-test, shipped next to the obs binary) finds it, else x264.
 *
 * VA-API (Intel / AMD) cannot be used there: OBS's FFmpeg output never sets up the hardware frames
 * context h264_vaapi needs. The stream to LinTO (640×360, 200 kb/s) stays on x264, which costs little.
 */

export interface RecordEncoder {
  /** libavcodec encoder name (AdvOut FFVEncoder). */
  name: string
  /** FFmpeg encoder options, `key=value` separated by spaces (AdvOut FFVCustom). */
  options: string
}

export const MAC_RECORD_ENCODER: RecordEncoder = { name: 'h264_videotoolbox', options: '' }
export const X264_RECORD_ENCODER: RecordEncoder = { name: 'libx264', options: 'preset=veryfast' }
/** p4 = NVENC's balanced preset; CBR, as streaming platforms expect for the online broadcast. */
export const NVENC_RECORD_ENCODER: RecordEncoder = { name: 'h264_nvenc', options: 'preset=p4 rc=cbr' }

export const isHardwareRecordEncoder = (e: RecordEncoder): boolean => e.name !== X264_RECORD_ENCODER.name

export function defaultRecordEncoder(platform: NodeJS.Platform): RecordEncoder {
  return platform === 'darwin' ? MAC_RECORD_ENCODER : X264_RECORD_ENCODER
}

/** True when obs-nvenc-test's INI output says NVENC works and can encode H.264. */
export function nvencH264Supported(out: string): boolean {
  let section = ''
  let supported = false
  let h264 = false
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.trim()
    const header = /^\[(.+)\]$/.exec(line)
    if (header) {
      section = header[1]
      continue
    }
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (section === 'general' && key === 'nvenc_supported') supported = value === 'true'
    if (section === 'h264' && key === 'codec_supported') h264 = value === '1'
  }
  return supported && h264
}

/** Resolves the probe's stdout, also when it exits non-zero (it does when NVENC is missing); '' if it cannot run. */
export type ProbeRunner = (exe: string, env: NodeJS.ProcessEnv) => Promise<string>

const PROBE_TIMEOUT_MS = 10_000

const runProbe: ProbeRunner = (exe, env) =>
  new Promise((resolve) => {
    execFile(exe, [], { env, timeout: PROBE_TIMEOUT_MS }, (_err, out) => resolve(typeof out === 'string' ? out : ''))
  })

export interface DetectOptions {
  platform: NodeJS.Platform
  /** The OBS executable; obs-nvenc-test sits next to it. */
  obsExe: string
  /** OBS's environment (the probe loads OBS's own libraries the same way). */
  env: NodeJS.ProcessEnv
  /** Marker written once a hardware encoder failed on this machine: x264 from then on. */
  disabledMarker: string
  run?: ProbeRunner
  exists?: (p: string) => boolean
}

export async function detectRecordEncoder(o: DetectOptions): Promise<RecordEncoder> {
  if (o.platform !== 'linux') return defaultRecordEncoder(o.platform)
  const exists = o.exists ?? existsSync
  if (exists(o.disabledMarker)) return X264_RECORD_ENCODER
  const probe = join(dirname(o.obsExe), 'obs-nvenc-test')
  // Development without a bundled OBS (`obs` on the PATH): no probe next to it, no guess.
  if (!exists(probe)) return X264_RECORD_ENCODER
  const out = await (o.run ?? runProbe)(probe, o.env)
  return nvencH264Supported(out) ? NVENC_RECORD_ENCODER : X264_RECORD_ENCODER
}

/** Remembers that the hardware encoder failed here (best effort: at worst the next launch probes again). */
export function disableHardwareRecordEncoder(marker: string): void {
  try {
    mkdirSync(dirname(marker), { recursive: true })
    writeFileSync(marker, `${new Date().toISOString()}\n`)
  } catch {
    /* best effort */
  }
}
