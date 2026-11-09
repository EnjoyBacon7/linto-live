import type { BrowserWindow } from 'electron'
import { UnauthorizedError, type AuthMethod } from '../../shared/types'
import type { LintoApi } from './api'
import type { LintoUrls } from './instance'
import { denyAllPermissions } from '../security'

export type RedirectResult = { kind: 'token'; token: string } | { kind: 'exchange' } | { kind: 'none' }

export function classifyRedirect(url: string, instance: string): RedirectResult {
  let u: URL, base: URL
  try {
    u = new URL(url)
    base = new URL(instance)
  } catch {
    return { kind: 'none' }
  }
  if (u.origin !== base.origin || u.pathname.replace(/\/+$/, '') !== '/login/oidc') return { kind: 'none' }
  const token = u.searchParams.get('token')
  return token ? { kind: 'token', token } : { kind: 'exchange' }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super('Email ou mot de passe incorrect.')
    this.name = 'InvalidCredentialsError'
  }
}

export async function loginWithPassword(api: LintoApi, email: string, password: string): Promise<string> {
  try {
    return (await api.loginLocal(email, password)).token
  } catch (e) {
    if (e instanceof UnauthorizedError) throw new InvalidCredentialsError()
    throw e
  }
}

export type NavEvent = 'will-redirect' | 'will-navigate' | 'did-navigate' | 'did-redirect-navigation'
export type RedirectAction = 'resolve-token' | 'exchange' | 'ignore'

// Decides what to do per navigation event. Token is taken on the earliest event;
// the cookie exchange runs at most once and only after navigation committed
// (so the redirect response's Set-Cookie has been processed).
export function createRedirectHandler(instance: string): (event: NavEvent, url: string) => { action: RedirectAction; token?: string } {
  let exchanged = false
  return (event, url) => {
    const r = classifyRedirect(url, instance)
    if (r.kind === 'token') return { action: 'resolve-token', token: r.token }
    if (r.kind === 'exchange' && !exchanged && (event === 'did-navigate' || event === 'did-redirect-navigation')) {
      exchanged = true
      return { action: 'exchange' }
    }
    return { action: 'ignore' }
  }
}

const PARTITION = 'persist:linto-sso'

export async function ssoLogin(
  urls: LintoUrls,
  method: AuthMethod,
  parent: BrowserWindow,
  opts: { email?: string } = {}
): Promise<string> {
  const { BrowserWindow: BW, session } = await import('electron')
  const ses = session.fromPartition(PARTITION)
  denyAllPermissions(ses)

  let loginUrl = `${urls.auth}/${method.path}/login`
  if (method.path === 'oidc/organization') {
    const email = opts.email?.trim()
    if (!email) throw new Error("Email requis pour le SSO d'organisation.")
    const r = await ses.fetch(`${urls.auth}/oidc/organization/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    })
    if (r.status === 404) throw new Error('Aucune organisation SSO pour cet email.')
    if (!r.ok) throw new Error(`SSO: HTTP ${r.status}`)
    loginUrl += `?email=${encodeURIComponent(email)}`
  }

  return new Promise<string>((resolve, reject) => {
    const win = new BW({
      parent, modal: true, width: 520, height: 700, show: true, autoHideMenuBar: true,
      webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true }
    })
    let done = false
    const finish = (err: Error | null, token?: string) => {
      if (done) return
      done = true
      if (!win.isDestroyed()) win.destroy()
      if (err) reject(err)
      else resolve(token as string)
    }
    const exchange = async () => {
      try {
        const r = await ses.fetch(`${urls.auth}/oidc/token`, { credentials: 'include' })
        if (!r.ok) throw new Error(`SSO: échange du jeton refusé (HTTP ${r.status})`)
        const body = (await r.json()) as { auth_token?: string }
        if (!body.auth_token) throw new Error('SSO: jeton absent de la réponse')
        finish(null, body.auth_token)
      } catch (e) {
        finish(e instanceof Error ? e : new Error(String(e)))
      }
    }
    const handle = createRedirectHandler(urls.instance)
    const check = (ev: NavEvent, event: { preventDefault(): void } | null, url: string) => {
      if (done) return
      const r = handle(ev, url)
      if (r.action === 'resolve-token') {
        event?.preventDefault()
        finish(null, r.token)
      } else if (r.action === 'exchange') {
        void exchange()
      }
    }
    const wc = win.webContents
    wc.on('will-redirect', (e, url) => check('will-redirect', e, url))
    wc.on('will-navigate', (e, url) => check('will-navigate', e, url))
    wc.on('did-navigate', (_e, url) => check('did-navigate', null, url))
    wc.on('did-redirect-navigation', (_e, url) => check('did-redirect-navigation', null, url))
    win.on('closed', () => finish(new Error('cancelled')))
    win.loadURL(loginUrl).catch((e) => {
      if (!done && !/ERR_ABORTED/.test(String(e))) finish(e instanceof Error ? e : new Error(String(e)))
    })
  })
}
