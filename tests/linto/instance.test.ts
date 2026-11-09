import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseConfigJs, loadInstance } from '../../src/main/linto/instance'

const js = readFileSync(join(__dirname, '../fixtures/config.js'), 'utf8')

describe('parseConfigJs', () => {
  it('parses the live config.js', () => {
    expect(parseConfigJs('https://studio.linto.ai', js)).toEqual({
      instance: 'https://studio.linto.ai',
      api: 'https://studio.linto.ai/cm-api/api',
      auth: 'https://studio.linto.ai/cm-api/auth',
      wsUrl: 'https://studio.linto.ai',
      wsPath: '/cm-api/socket.io'
    })
  })
  it('resolves relative values against the instance', () => {
    const r = parseConfigJs('https://x.org', `window.VUE_APP_CONFIG = {"VUE_APP_CONVO_API":"/api","VUE_APP_CONVO_AUTH":"/auth","VUE_APP_SESSION_WS":"/","VUE_APP_SESSION_WS_PATH":"/s/io",}`)
    expect(r.api).toBe('https://x.org/api')
    expect(r.auth).toBe('https://x.org/auth')
    expect(r.wsUrl).toBe('https://x.org/')
    expect(r.wsPath).toBe('/s/io')
  })
  it('throws when a key is missing', () => {
    expect(() => parseConfigJs('https://x.org', 'window.VUE_APP_CONFIG = {}')).toThrow(/VUE_APP_CONVO_API/)
  })
})

describe('loadInstance', () => {
  it('strips trailing slash and fetches /config.js', async () => {
    let url = ''
    const f = (async (u: string) => { url = u; return new Response(js) }) as unknown as typeof fetch
    const r = await loadInstance('https://studio.linto.ai/', f)
    expect(url).toBe('https://studio.linto.ai/config.js')
    expect(r.urls.instance).toBe('https://studio.linto.ai')
  })
  it('throws on non-2xx', async () => {
    const f = (async () => new Response('no', { status: 404 })) as unknown as typeof fetch
    await expect(loadInstance('https://x.org', f)).rejects.toThrow(/404/)
  })
})
