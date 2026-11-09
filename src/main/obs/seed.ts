import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface SeedOptions {
  canvas: { width: 1920; height: 1080; fps: 30 }
  platform: NodeJS.Platform
}

/**
 * The stream only carries the room audio to LinTO: its video is scaled down and cheap to encode.
 * The canvas stays full HD for the projector (output window).
 */
const STREAM = { width: 640, height: 360, videoKbps: 200 }

/**
 * Simple output mode encoder (OBS 32 frontend ids): the hardware H.264 encoder (VideoToolbox) on macOS —
 * the app ships for Apple Silicon only — and x264 at its cheapest preset on Linux.
 */
const streamEncoder = (p: NodeJS.Platform): [string, string][] =>
  p === 'darwin' ? [['StreamEncoder', 'apple_h264']] : [['StreamEncoder', 'x264'], ['Preset', 'ultrafast']]

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

function iniSpecs(o: SeedOptions): Record<string, IniSpec> {
  const { width, height, fps } = o.canvas
  return {
    'global.ini': [['General', GENERAL]],
    'user.ini': [
      ['General', [['FirstRun', 'true'], ['ConfirmOnExit', 'false']]],
      ['BasicWindow', [['SysTrayEnabled', 'true'], ['SysTrayWhenStarted', 'true'], ['SaveProjectors', 'false']]]
    ],
    'basic/profiles/LinTO Live/basic.ini': [
      ['General', [['Name', 'LinTO Live']]],
      [
        'Video',
        [
          ['BaseCX', String(width)],
          ['BaseCY', String(height)],
          ['OutputCX', String(STREAM.width)],
          ['OutputCY', String(STREAM.height)],
          ['FPSType', '0'],
          ['FPSCommon', String(fps)]
        ]
      ],
      ['Output', [['Mode', 'Simple']]],
      ['SimpleOutput', [['VBitrate', String(STREAM.videoKbps)], ['ABitrate', '128'], ...streamEncoder(o.platform)]]
    ]
  }
}

const renderSection = ([name, keys]: IniSpec[number]): string => `[${name}]\n${keys.map(([k, v]) => `${k}=${v}`).join('\n')}\n`
const renderIni = (spec: IniSpec): string => spec.map(renderSection).join('\n')

export function seedFiles(o: SeedOptions): Record<string, string> {
  const ini = Object.fromEntries(Object.entries(iniSpecs(o)).map(([rel, spec]) => [rel, renderIni(spec)]))
  return {
    ...ini,
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
