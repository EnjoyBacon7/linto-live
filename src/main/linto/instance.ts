import type { WatermarkConfig } from '../../shared/types'
import { fetchWithTimeout } from './timeout'

export interface LintoUrls { instance: string; api: string; auth: string; wsUrl: string; wsPath: string }

function findKey(js: string, key: string): string | undefined {
  const m = new RegExp(`["']?${key}["']?\\s*:\\s*(["'])((?:\\\\.|(?!\\1).)*)\\1`).exec(js)
  return m?.[2]
}

function readKey(js: string, key: string): string {
  const v = findKey(js, key)
  if (v === undefined) throw new Error(`config.js: clé ${key} introuvable`)
  return v
}

/** LinTO Studio's own defaults (studio-frontend const/defaultEnv.js), used for keys the instance leaves out. */
export const STUDIO_WATERMARK_DEFAULTS: WatermarkConfig = {
  enabled: false,
  content: 'Transcription by LinTO.ai $linto Open Source AI by $linagora',
  frequency: 600,
  duration: 10
}

function positive(v: string | undefined, fallback: number): number {
  const n = Number(v)
  return v !== undefined && Number.isFinite(n) && n > 0 ? n : fallback
}

/** The VUE_APP_*WATERMARK* keys of config.js (whether the web app offers the watermark, and its defaults). */
export function parseWatermarkConfig(js: string): WatermarkConfig {
  const d = STUDIO_WATERMARK_DEFAULTS
  const enabled = findKey(js, 'VUE_APP_ENABLE_WATERMARK')
  const content = findKey(js, 'VUE_APP_WATERMARK_CONTENT')
  return {
    enabled: enabled === undefined ? d.enabled : enabled === 'true',
    content: content ?? d.content,
    frequency: positive(findKey(js, 'VUE_APP_WATERMARK_FREQUENCY'), d.frequency),
    duration: positive(findKey(js, 'VUE_APP_WATERMARK_DURATION'), d.duration)
  }
}

function resolve(instance: string, v: string): string {
  return /^https?:\/\//i.test(v) ? v : instance + (v.startsWith('/') ? v : '/' + v)
}

export function parseConfigJs(instance: string, js: string): LintoUrls {
  const inst = instance.replace(/\/+$/, '')
  return {
    instance: inst,
    api: resolve(inst, readKey(js, 'VUE_APP_CONVO_API')),
    auth: resolve(inst, readKey(js, 'VUE_APP_CONVO_AUTH')),
    wsUrl: resolve(inst, readKey(js, 'VUE_APP_SESSION_WS')),
    wsPath: readKey(js, 'VUE_APP_SESSION_WS_PATH')
  }
}

export async function loadInstance(
  instance: string, fetchFn: typeof fetch = fetch
): Promise<{ urls: LintoUrls; watermark: WatermarkConfig }> {
  const inst = instance.replace(/\/+$/, '')
  const js = await fetchWithTimeout(fetchFn, `${inst}/config.js`, {}, async (res) => {
    if (!res.ok) throw new Error(`config.js: HTTP ${res.status}`)
    return res.text()
  })
  return { urls: parseConfigJs(inst, js), watermark: parseWatermarkConfig(js) }
}
