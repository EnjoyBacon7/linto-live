import { resolve } from 'node:path'
import { cpSync } from 'node:fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Copies the overlay page (static files served by OverlayServer) to out/main/overlay-page
const copyOverlayPage = {
  name: 'copy-overlay-page',
  closeBundle(): void {
    cpSync(resolve('src/main/overlay/page'), resolve('out/main/overlay-page'), { recursive: true })
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyOverlayPage],
    build: { rollupOptions: { input: { main: resolve('src/main/main.ts') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { preload: resolve('src/main/preload.ts') } } }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html') } } }
  }
})
