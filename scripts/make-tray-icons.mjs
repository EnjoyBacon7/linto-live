#!/usr/bin/env node
// Generates the menu-bar / tray icons in resources/tray (pure Node, no dependency):
//   trayTemplate.png (16 px), trayTemplate@2x.png (32 px)          — a screen with two caption lines
//   trayLiveTemplate.png, trayLiveTemplate@2x.png                   — the same with a filled dot (on air)
// Black + alpha only, so macOS treats them as template images (tinted for light/dark menu bars).
// Usage: node scripts/make-tray-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'tray')

// ---- Shapes, in a 16×16 design grid (signed distance: < 0 inside) ----
const roundRect = (x, y, x0, y0, x1, y1, r) => {
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const qx = Math.abs(x - cx) - ((x1 - x0) / 2 - r)
  const qy = Math.abs(y - cy) - ((y1 - y0) / 2 - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}
const circle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r

const DOT = { cx: 12.5, cy: 3.5, r: 3 }

/** Coverage (0..1) of the design point (x, y). */
function shape(x, y, live) {
  if (live) {
    if (circle(x, y, DOT.cx, DOT.cy, DOT.r) <= 0) return 1
    if (circle(x, y, DOT.cx, DOT.cy, DOT.r + 1.25) <= 0) return 0 // gap between the dot and the screen
  }
  const outer = roundRect(x, y, 1, 2.5, 15, 13.5, 2.25)
  const inner = roundRect(x, y, 2.5, 4, 13.5, 12, 1)
  if (outer <= 0 && inner > 0) return 1 // screen frame
  if (roundRect(x, y, 4, 7.25, 12, 8.75, 0.5) <= 0) return 1 // caption line 1
  if (roundRect(x, y, 4, 9.75, 9.5, 11.25, 0.5) <= 0) return 1 // caption line 2
  return 0
}

/** RGBA pixels, black with anti-aliased alpha (8×8 supersampling). */
function render(size, live) {
  const S = 8
  const scale = 16 / size
  const px = Buffer.alloc(size * size * 4)
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let hit = 0
      for (let sj = 0; sj < S; sj++) {
        for (let si = 0; si < S; si++) hit += shape((i + (si + 0.5) / S) * scale, (j + (sj + 0.5) / S) * scale, live)
      }
      px[(j * size + i) * 4 + 3] = Math.round((hit / (S * S)) * 255)
    }
  }
  return px
}

// ---- Minimal PNG encoder (8-bit RGBA, no interlace) ----
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

mkdirSync(OUT, { recursive: true })
for (const [name, live] of [['trayTemplate', false], ['trayLiveTemplate', true]]) {
  writeFileSync(join(OUT, `${name}.png`), png(16, render(16, live)))
  writeFileSync(join(OUT, `${name}@2x.png`), png(32, render(32, live)))
}
console.log(`Tray icons written to ${OUT}`)
