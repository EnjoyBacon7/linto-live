import type { Watermark, WatermarkConfig } from '../../shared/types'
import { STUDIO_WATERMARK_DEFAULTS } from './instance'

/** Key of the watermark settings in a LinTO session's `meta` (shared with LinTO Studio's web app). */
export const WATERMARK_META_KEY = '@watermark'

const MAX_CONTENT = 500
const MAX_SECONDS = 24 * 3600

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const seconds = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_SECONDS ? v : undefined

/** The session's watermark as LinTO Studio reads it: missing fields fall back to the instance defaults, off and unpinned. */
export function resolveWatermark(meta: unknown, cfg: WatermarkConfig = STUDIO_WATERMARK_DEFAULTS): Watermark {
  const w = isObject(meta) && isObject(meta[WATERMARK_META_KEY]) ? meta[WATERMARK_META_KEY] : {}
  return {
    display: w.display === true,
    pinned: w.pinned === true,
    content: typeof w.content === 'string' ? w.content : cfg.content,
    frequency: seconds(w.frequency) ?? cfg.frequency,
    duration: seconds(w.duration) ?? cfg.duration
  }
}

/** Validates a watermark coming from the renderer; throws a user-facing message. */
export function checkWatermark(raw: unknown): Watermark {
  if (!isObject(raw)) throw new Error('Réglages du filigrane invalides.')
  const { display, pinned, content } = raw
  if (typeof display !== 'boolean' || typeof pinned !== 'boolean' || typeof content !== 'string') {
    throw new Error('Réglages du filigrane invalides.')
  }
  if (content.length > MAX_CONTENT) throw new Error(`Texte du filigrane trop long (${MAX_CONTENT} caractères au plus).`)
  const frequency = seconds(raw.frequency)
  const duration = seconds(raw.duration)
  if (frequency === undefined || duration === undefined) {
    throw new Error('La fréquence et la durée du filigrane doivent être des nombres de secondes positifs.')
  }
  return { display, pinned, content, frequency, duration }
}

export function sameWatermark(a: Watermark, b: Watermark): boolean {
  return a.display === b.display && a.pinned === b.pinned && a.content === b.content &&
    a.frequency === b.frequency && a.duration === b.duration
}
