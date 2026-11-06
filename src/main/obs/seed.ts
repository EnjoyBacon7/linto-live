import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface SeedOptions {
  canvas: { width: 1920; height: 1080; fps: 30 }
}

const GENERAL: [string, string][] = [
  ['FirstRun', 'true'],
  ['LastVersion', '536936448'],
  ['InfoLastVersion', '35188667056128'],
  ['InfoIncrement', '999'],
  ['EnableAutoUpdates', 'false'],
  ['MacOSPermissionsDialogLastShown', '1'],
  ['Pre31Migrated', 'true']
]

const generalSection = (): string => `[General]\n${GENERAL.map(([k, v]) => `${k}=${v}`).join('\n')}\n`

export function seedFiles(o: SeedOptions): Record<string, string> {
  const { width, height, fps } = o.canvas
  return {
    'global.ini': generalSection(),
    'user.ini': `[General]
FirstRun=true
ConfirmOnExit=false

[BasicWindow]
SysTrayEnabled=true
SysTrayWhenStarted=true
SaveProjectors=false
`,
    'basic/profiles/LinTO Live/basic.ini': `[General]
Name=LinTO Live

[Video]
BaseCX=${width}
BaseCY=${height}
OutputCX=${width}
OutputCY=${height}
FPSType=0
FPSCommon=${fps}

[Output]
Mode=Simple

[SimpleOutput]
VBitrate=800
ABitrate=128
`,
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

// Replace the [General] section of an existing global.ini, keeping every other section/key.
function mergeGlobalIni(existing: string): string {
  const lines = existing.split(/\r?\n/)
  const out: string[] = []
  const managed = new Set(GENERAL.map(([k]) => k))
  let inGeneral = false
  let sawGeneral = false
  for (const line of lines) {
    const header = /^\s*\[(.+)\]\s*$/.exec(line)
    if (header) {
      if (inGeneral) out.push(...GENERAL.map(([k, v]) => `${k}=${v}`))
      inGeneral = header[1] === 'General'
      sawGeneral ||= inGeneral
      out.push(line)
      continue
    }
    if (inGeneral && managed.has(line.split('=')[0].trim())) continue
    out.push(line)
  }
  if (inGeneral) {
    while (out.length && out[out.length - 1] === '') out.pop()
    out.push(...GENERAL.map(([k, v]) => `${k}=${v}`), '')
  }
  let res = out.join('\n')
  if (!sawGeneral) res = generalSection() + '\n' + res
  return res.endsWith('\n') ? res : res + '\n'
}

export async function writeSeed(obsConfigDir: string, o: SeedOptions): Promise<void> {
  for (const [rel, content] of Object.entries(seedFiles(o))) {
    const p = join(obsConfigDir, rel)
    await mkdir(dirname(p), { recursive: true })
    if (rel === 'global.ini') {
      let existing: string | null = null
      try {
        existing = await readFile(p, 'utf8')
      } catch {
        /* absent */
      }
      await writeFile(p, existing === null ? content : mergeGlobalIni(existing))
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
