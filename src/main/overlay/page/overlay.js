import { SubtitleModel } from './layout.js'

const key = new URLSearchParams(location.search).get('k') || ''
const band = document.getElementById('band')
const l1 = document.getElementById('l1')
const l2 = document.getElementById('l2')

const ctx = document.createElement('canvas').getContext('2d')
ctx.font = '48px Arial'
const model = new SubtitleModel((line) => ctx.measureText(line).width <= 1920 - 200)

function render() {
  const [a, b] = model.lines()
  l1.textContent = a
  l2.textContent = b
  band.hidden = !model.visible
}

function connect() {
  const ws = new WebSocket('ws://' + location.host + '/ws?k=' + encodeURIComponent(key))
  ws.onmessage = (e) => {
    try {
      const m = JSON.parse(e.data)
      if (m.type === 'reset') model.reset()
      else if (m.type === 'partial') model.partial(m.text)
      else if (m.type === 'final') model.final(m.text)
      else return
      render()
    } catch (_) { /* ignore malformed */ }
  }
  ws.onclose = () => { setTimeout(connect, 1000) }
}
connect()
