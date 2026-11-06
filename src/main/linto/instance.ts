export interface LintoUrls { instance: string; api: string; auth: string; wsUrl: string; wsPath: string }

function readKey(js: string, key: string): string {
  const m = new RegExp(`["']?${key}["']?\\s*:\\s*(["'])((?:\\\\.|(?!\\1).)*)\\1`).exec(js)
  if (!m) throw new Error(`config.js: clé ${key} introuvable`)
  return m[2]
}

function resolve(instance: string, v: string): string {
  return /^https?:\/\//i.test(v) ? v : instance + (v.startsWith('/') ? v : '/' + v)
}

export function parseConfigJs(instance: string, js: string): LintoUrls {
  const inst = instance.replace(/\/+$/, '')
  return {
    instance: inst,
    api: resolve(inst, readKey(js, 'VUE_APP_CONVO_API')),
    auth: resolve(inst, readKey(js, 'VUE_APP_CONVO_AUTH')),
    wsUrl: resolve(inst, readKey(js, 'VUE_APP_SESSION_WS')),
    wsPath: readKey(js, 'VUE_APP_SESSION_WS_PATH')
  }
}

export async function loadInstance(instance: string, fetchFn: typeof fetch = fetch): Promise<LintoUrls> {
  const inst = instance.replace(/\/+$/, '')
  const res = await fetchFn(`${inst}/config.js`)
  if (!res.ok) throw new Error(`config.js: HTTP ${res.status}`)
  return parseConfigJs(inst, await res.text())
}
