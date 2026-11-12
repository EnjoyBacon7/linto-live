import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fetchWithTimeout, LINTO_TIMEOUT_MS, MSG_LINTO_TIMEOUT } from '../../src/main/linto/timeout'
import { LintoApi } from '../../src/main/linto/api'
import { loadInstance } from '../../src/main/linto/instance'
import type { LintoUrls } from '../../src/main/linto/instance'

let srv: Server | null = null
afterEach(() => {
  srv?.closeAllConnections()
  srv?.close()
  srv = null
})

/** A LinTO that accepts the connection and never answers. */
async function silentServer(): Promise<string> {
  srv = createServer(() => {})
  await new Promise<void>((r) => srv!.listen(0, '127.0.0.1', () => r()))
  return `http://127.0.0.1:${(srv.address() as AddressInfo).port}`
}

describe('LinTO request timeout (#6)', () => {
  it('stays well below undici\'s 300 s default', () => {
    expect(LINTO_TIMEOUT_MS).toBeLessThanOrEqual(30_000)
  })

  it('a silent server fails with a readable message instead of hanging', async () => {
    const base = await silentServer()
    const t0 = Date.now()
    await expect(fetchWithTimeout(fetch, `${base}/x`, {}, (r) => r.text(), 300)).rejects.toThrow(MSG_LINTO_TIMEOUT)
    expect(Date.now() - t0).toBeLessThan(2_000)
  })

  it('LintoApi and loadInstance send every request with a timeout signal', async () => {
    const signals: (AbortSignal | null | undefined)[] = []
    const f = (async (_url: string, init: RequestInit = {}) => {
      signals.push(init.signal)
      return new Response('[]', { status: 200 })
    }) as unknown as typeof fetch
    const urls: LintoUrls = { instance: 'https://s', api: 'https://s/api', auth: 'https://s/auth', wsUrl: 'https://s', wsPath: '/io' }
    await new LintoApi(urls, () => 't', f).organizations()
    await loadInstance('https://s', f).catch(() => {}) // '[]' is not a config.js: only the signal matters here
    expect(signals).toHaveLength(2)
    signals.forEach((s) => expect(s).toBeInstanceOf(AbortSignal))
  })

  it('HTTP errors are unchanged', async () => {
    const f = (async () => new Response('', { status: 503 })) as unknown as typeof fetch
    await expect(loadInstance('https://s', f)).rejects.toThrow('config.js: HTTP 503')
  })
})
