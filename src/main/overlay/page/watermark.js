// Watermark of the subtitle band, as on the LinTO subtitle page. Plain ESM, no dependencies:
// served as-is to the OBS browser source and imported by tests.

const TOKEN_RE = /\$(\w+)/g

/**
 * Splits the watermark text into text and logo parts: `$name` becomes the logo `tokens[name]`
 * (unknown names stay as text).
 */
export function parseWatermark(content, tokens) {
  const parts = []
  let last = 0
  TOKEN_RE.lastIndex = 0
  let m
  while ((m = TOKEN_RE.exec(content)) !== null) {
    if (m.index > last) parts.push({ type: 'text', value: content.slice(last, m.index) })
    const token = Object.prototype.hasOwnProperty.call(tokens, m[1]) ? tokens[m[1]] : undefined
    if (token) parts.push({ type: 'token', src: token.src, alt: token.alt })
    else parts.push({ type: 'text', value: m[0] })
    last = m.index + m[0].length
  }
  if (last < content.length) parts.push({ type: 'text', value: content.slice(last) })
  return parts
}

/**
 * Show/hide cycle: hidden for `frequency` s, then shown for `duration` s, and again; always shown
 * when pinned, never when `display` is off. Changing display/pinned/frequency/duration restarts it.
 * `onChange(visible)` is called on every change of visibility.
 */
export class WatermarkCycle {
  constructor(onChange, timers = { setTimeout, clearTimeout }) {
    this.onChange = onChange
    this.timers = timers
    this.timer = null
    this.visible = false
    this.cfg = null
  }

  /** Applies new settings; only a change of timing/visibility settings restarts the cycle. */
  update(w) {
    const prev = this.cfg
    this.cfg = { display: !!w.display, pinned: !!w.pinned, frequency: w.frequency, duration: w.duration }
    const same = prev && prev.display === this.cfg.display && prev.pinned === this.cfg.pinned &&
      prev.frequency === this.cfg.frequency && prev.duration === this.cfg.duration
    if (!same) this.restart()
  }

  restart() {
    this.clear()
    const c = this.cfg
    if (!c || !c.display) return this.set(false)
    if (c.pinned) return this.set(true)
    this.set(false)
    this.timer = this.timers.setTimeout(() => this.show(), c.frequency * 1000)
  }

  show() {
    this.timer = null
    this.set(true)
    this.timer = this.timers.setTimeout(() => this.hide(), this.cfg.duration * 1000)
  }

  hide() {
    this.timer = null
    this.set(false)
    this.timer = this.timers.setTimeout(() => this.show(), this.cfg.frequency * 1000)
  }

  clear() {
    if (this.timer !== null) this.timers.clearTimeout(this.timer)
    this.timer = null
  }

  set(v) {
    if (v === this.visible) return
    this.visible = v
    this.onChange(v)
  }
}
