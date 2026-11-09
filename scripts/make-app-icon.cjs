// Renders build/icon.svg to build/icon.png (1024 px, transparent) with Electron; electron-builder derives .icns / Linux icons from it.
// Usage: env -u ELECTRON_RUN_AS_NODE npx electron scripts/make-app-icon.cjs build/icon.svg build/icon.png
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const svg = fs.readFileSync(require("path").resolve(process.argv[2]), 'utf8')
  const w = new BrowserWindow({ show: false, width: 1024, height: 1024, transparent: true, frame: false, webPreferences: { offscreen: true } })
  w.webContents.setZoomFactor(1)
  await w.loadURL('data:text/html,' + encodeURIComponent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`))
  await new Promise(r => setTimeout(r, 500))
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
  fs.writeFileSync(require("path").resolve(process.argv[3]), img.resize({ width: 1024, height: 1024 }).toPNG())
  app.quit()
})
