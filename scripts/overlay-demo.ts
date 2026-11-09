import { resolve } from 'node:path'
import { OverlayServer, type OverlayMessage } from '../src/main/overlay/server'

/**
 * Feeds the caption overlay page with the same messages LinTO Live sends ({type:'partial'|'final', text}),
 * in a loop: growing partials, words corrected by later partials, a partial long enough to fill the
 * lines (layout + scrolling), finals, then a reset (box hidden) before starting over.
 * Run: npx tsx scripts/overlay-demo.ts, then open the printed URL in a browser (or use it as the URL
 * of a browser source, 1920×1080).
 */
const LONG =
  "LinTO Live affiche les sous-titres en direct sur deux lignes au bas de l'image, et quand la phrase " +
  "devient trop longue pour tenir sur une seule ligne elle continue sur la suivante sans que les mots déjà " +
  'placés ne bougent'

const SCRIPT: OverlayMessage[] = [
  { type: 'partial', text: 'Bonjour' },
  { type: 'partial', text: 'Bonjour à' },
  { type: 'partial', text: 'Bonjour à tous' },
  { type: 'partial', text: 'Bonjour à tous et bien' },
  { type: 'partial', text: 'Bonjour à tous et bienvenue' },
  { type: 'final', text: 'Bonjour à tous et bienvenue.' },
  // word corrections: a later partial rewrites words of the previous one
  { type: 'partial', text: 'Ceci est une démo' },
  { type: 'partial', text: 'Ceci est une démonstration des sous' },
  { type: 'partial', text: 'Ceci est une démonstration des sous titres' },
  { type: 'partial', text: 'Ceci est une démonstration des sous-titres de lin to' },
  { type: 'partial', text: 'Ceci est une démonstration des sous-titres de LinTO Live' },
  { type: 'final', text: 'Ceci est une démonstration des sous-titres de LinTO Live.' },
  // a partial that grows until it fills the lines, then its final
  ...LONG.split(' ').map((_, i, words): OverlayMessage => ({ type: 'partial', text: words.slice(0, i + 1).join(' ') })),
  { type: 'final', text: `${LONG}.` },
  { type: 'final', text: 'Merci de votre attention.' },
  { type: 'reset' }
]

async function main(): Promise<void> {
  const srv = new OverlayServer({ pageDir: resolve(__dirname, '../src/main/overlay/page') })
  const { url } = await srv.start()
  console.log(`Overlay: ${url}`)
  let i = 0
  const step = (): void => {
    const msg = SCRIPT[i % SCRIPT.length]!
    i++
    srv.push(msg)
    console.log(msg.type === 'reset' ? 'reset' : `${msg.type}: ${msg.text}`)
    // linger on finals and after the reset so they can be read
    setTimeout(step, msg.type === 'partial' ? 300 : 2000)
  }
  step()
}
void main()
