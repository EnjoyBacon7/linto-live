import { resolve } from 'node:path'
import { OverlayServer } from '../src/main/overlay/server'

async function main(): Promise<void> {
  const srv = new OverlayServer({ pageDir: resolve(__dirname, '../src/main/overlay/page') })
  const { url } = await srv.start()
  console.log(`Overlay: ${url}`)
  let n = 0
  setInterval(() => {
    n++
    srv.push({ lines: ['Bonjour à tous, ceci est une démonstration', `des sous-titres LinTO Live (${n})`], partial: n % 2 === 0 })
  }, 2000)
}
main()
