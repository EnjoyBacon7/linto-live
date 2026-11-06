(function () {
  var box = document.getElementById('captions')
  var key = new URLSearchParams(location.search).get('k') || ''

  function render(view) {
    var lines = (view && view.lines) || []
    box.textContent = ''
    if (!lines.length) { box.hidden = true; return }
    lines.forEach(function (text, i) {
      var div = document.createElement('div')
      div.className = 'line' + (view.partial && i === lines.length - 1 ? ' partial' : '')
      div.textContent = text
      box.appendChild(div)
    })
    box.hidden = false
  }

  function connect() {
    var ws = new WebSocket('ws://' + location.host + '/ws?k=' + encodeURIComponent(key))
    ws.onmessage = function (e) {
      try { render(JSON.parse(e.data)) } catch (_) { /* ignore malformed */ }
    }
    ws.onclose = function () { setTimeout(connect, 1000) }
  }
  connect()
})()
