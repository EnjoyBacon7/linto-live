import { SubtitleModel, bandPlacement, windowMetrics } from './layout.js'
import { WatermarkCycle, parseWatermark } from './watermark.js'

const WIDTH = 1920 - 200 // canvas width minus the band's horizontal padding (overlay.css)
const TOKENS = {
  linto: { src: '/img/linto.svg', alt: 'LinTO' },
  linagora: { src: '/img/linagora.png', alt: 'Linagora' }
}

const params = new URLSearchParams(location.search)
const key = params.get('k') || ''
/** Subtitle window of the app (not the OBS source): the band fills the window, no QR code. */
const windowMode = params.get('mode') === 'window'
const band = document.getElementById('band')
const l1 = document.getElementById('l1')
const l2 = document.getElementById('l2')
const wm = document.getElementById('wm')
const qr = document.getElementById('qr')

const ctx = document.createElement('canvas').getContext('2d')
const fitsAt = (size, width = WIDTH) => {
  const font = size + 'px Arial, sans-serif' // same stack as #band in overlay.css
  return (line) => {
    ctx.font = font
    return ctx.measureText(line).width <= width
  }
}
let fontSize = 48
let bandVisible = true
/** Band position last applied (null before the first style message) and the empty band shown while it moves. */
let position = null
let peeking = false
let peekTimer = 0
const PEEK_MS = 2000
let wmContent = null
const model = new SubtitleModel(fitsAt(fontSize))
const cycle = new WatermarkCycle((v) => band.classList.toggle('has-wm', v))
const qrCycle = new WatermarkCycle((v) => qr.classList.toggle('is-shown', v))
let qrSvg = null
let qrHideTimer = 0

function render() {
  const [a, b] = model.lines()
  l1.textContent = a
  l2.textContent = b
  band.hidden = !bandVisible || !(model.visible || peeking)
}

function renderWatermark(content) {
  if (content === wmContent) return
  wmContent = content
  const nodes = parseWatermark(content, TOKENS).map((p) => {
    if (p.type === 'text') return document.createTextNode(p.value)
    const img = document.createElement('img')
    img.src = p.src
    img.alt = p.alt
    return img
  })
  wm.replaceChildren(...nodes)
}

function applyQr(q) {
  if (!q || typeof q.svg !== 'string' || q.svg === '') {
    qrCycle.update({ display: false })
    qr.classList.remove('is-shown')
    qrSvg = null
    // Fade out (300 ms), then hide and empty, unless a QR code came back meanwhile.
    clearTimeout(qrHideTimer)
    qrHideTimer = setTimeout(() => {
      if (qrSvg !== null) return
      qr.hidden = true
      qr.replaceChildren()
    }, 300)
    return
  }
  clearTimeout(qrHideTimer)
  if (q.svg !== qrSvg) {
    qrSvg = q.svg
    qr.innerHTML = q.svg
  }
  if (qr.hidden) {
    qr.hidden = false
    void qr.offsetWidth // reflow: the opacity transition also runs on the first show
  }
  qrCycle.update(q)
}

/**
 * Moves the band on the canvas. With no caption on screen the band is hidden: when the position changes
 * (not on the first message, which only restores it), the empty band shows for a moment so the move is seen.
 */
function applyPosition(value) {
  const { ratio, qrLow } = bandPlacement(value)
  band.style.setProperty('--pos', String(ratio))
  qr.classList.toggle('is-low', qrLow)
  if (position !== null && ratio !== position) {
    peeking = true
    clearTimeout(peekTimer)
    peekTimer = setTimeout(() => { peeking = false; render() }, PEEK_MS)
  }
  position = ratio
}

function applyStyle(m) {
  if (!windowMode && typeof m.fontSize === 'number' && m.fontSize > 0 && m.fontSize !== fontSize) {
    fontSize = m.fontSize
    band.style.setProperty('--fs', fontSize + 'px')
    model.setFits(fitsAt(fontSize))
  }
  bandVisible = m.visible !== false
  if (!windowMode) applyPosition(m.position)
  if (m.watermark) {
    renderWatermark(String(m.watermark.content ?? ''))
    cycle.update(m.watermark)
  }
  if (!windowMode) applyQr(m.qr)
}

/** Window mode: font and line width follow the window; the shown text is laid out again. */
function fitWindow() {
  const m = windowMetrics(window.innerWidth, window.innerHeight)
  fontSize = m.fontSize
  band.style.setProperty('--fs', fontSize + 'px')
  model.setFits(fitsAt(fontSize, m.lineWidth))
  render()
}

if (windowMode) {
  document.body.classList.add('window')
  const close = document.getElementById('close')
  close.hidden = false
  close.addEventListener('click', () => window.close())
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close() })
  window.addEventListener('resize', fitWindow)
  fitWindow()
}

function connect() {
  const ws = new WebSocket('ws://' + location.host + '/ws?k=' + encodeURIComponent(key))
  ws.onmessage = (e) => {
    try {
      const m = JSON.parse(e.data)
      if (m.type === 'reset') model.reset()
      else if (m.type === 'partial') model.partial(m.text)
      else if (m.type === 'final') model.final(m.text)
      else if (m.type === 'style') applyStyle(m)
      else return
      render()
    } catch (_) { /* ignore malformed */ }
  }
  ws.onclose = () => { setTimeout(connect, 1000) }
}
connect()
