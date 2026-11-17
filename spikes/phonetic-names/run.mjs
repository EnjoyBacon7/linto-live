// SPIKE: node spikes/phonetic-names/run.mjs                      -> runs the invented cases
//        node spikes/phonetic-names/run.mjs names.txt transcript  -> corrects a real transcript
//          (names.txt: one name per line; transcript: .txt, or the app's .json export)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCorrector, fold } from './matcher.mjs'
import { NAMES, CASES } from './cases.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const CACHE = join(here, '.cache', 'fr_50k.txt')
// 50k most frequent French words (OpenSubtitles, CC BY-SA 4.0), only used as "everyday words".
const WORDS_URL = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/fr/fr_50k.txt'

async function commonWords(limit = Number(process.env.COMMON ?? 50000)) {
  if (!existsSync(CACHE)) {
    const r = await fetch(WORDS_URL)
    if (!r.ok) throw new Error(`word list: HTTP ${r.status}`)
    mkdirSync(dirname(CACHE), { recursive: true })
    writeFileSync(CACHE, await r.text())
  }
  return new Set(readFileSync(CACHE, 'utf8').split('\n').slice(0, limit).map((l) => fold(l.split(' ')[0])).filter(Boolean))
}

const common = await commonWords()
const opts = { common, maxRatio: Number(process.env.RATIO ?? 0.25) }
const [namesFile, textFile] = process.argv.slice(2)

if (namesFile) {
  const names = readFileSync(namesFile, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
  const correct = createCorrector(names, opts)
  const raw = readFileSync(textFile, 'utf8')
  const lines = textFile.endsWith('.json') ? JSON.parse(raw).segments?.map((s) => s.text) ?? JSON.parse(raw).finals.map((s) => s.text) : raw.split('\n')
  for (const line of lines) {
    const r = correct(line)
    if (r.replacements.length) console.log(`- ${line}\n+ ${r.text}\n  ${r.replacements.map((x) => `${x.original} -> ${x.name} (d=${x.d})`).join(', ')}`)
  }
} else {
  const correct = createCorrector(NAMES, opts)
  let ok = 0
  const t0 = performance.now()
  for (const c of CASES) {
    const r = correct(c.text)
    const pass = r.text === c.want
    ok += pass
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${c.text}${pass ? '' : `\n      got:  ${r.text}\n      want: ${c.want}`}${r.replacements.length ? `\n      ${r.replacements.map((x) => `${x.original} -> ${x.name} (d=${x.d})`).join(', ')}` : ''}`)
  }
  const ms = (performance.now() - t0) / CASES.length
  console.log(`\n${ok}/${CASES.length} passed, ${ms.toFixed(2)} ms per segment (${NAMES.length} names)`)
}
