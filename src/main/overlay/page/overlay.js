import { SubtitleModel } from './layout.js'
import { WatermarkCycle, parseWatermark } from './watermark.js'

const WIDTH = 1920 - 200 // canvas width minus the band's horizontal padding (overlay.css)
const TOKENS = {
  linto: { src: '/img/linto.svg', alt: 'LinTO' },
  linagora: { src: '/img/linagora.png', alt: 'Linagora' }
}

const key = new URLSearchParams(location.search).get('k') || ''
const band = document.getElementById('band')
const l1 = document.getElementById('l1')
const l2 = document.getElementById('l2')
const wm = document.getElementById('wm')
const qr = document.getElementById('qr')

const ctx = document.createElement('canvas').getContext('2d')
const fitsAt = (size) => {
  const font = size + 'px Arial, sans-serif' // same stack as #band in overlay.css
  return (line) => {
    ctx.font = font
    return ctx.measureText(line).width <= WIDTH
  }
}
let fontSize = 48
let bandVisible = true
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
  band.hidden = !bandVisible || !model.visible
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

function applyStyle(m) {
  if (typeof m.fontSize === 'number' && m.fontSize > 0 && m.fontSize !== fontSize) {
    fontSize = m.fontSize
    band.style.setProperty('--fs', fontSize + 'px')
    model.setFits(fitsAt(fontSize))
  }
  bandVisible = m.visible !== false
  if (m.watermark) {
    renderWatermark(String(m.watermark.content ?? ''))
    cycle.update(m.watermark)
  }
  applyQr(m.qr)
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
