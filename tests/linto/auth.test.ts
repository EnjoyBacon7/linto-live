import { describe, it, expect, vi } from 'vitest'
import {
  applyRemember, canRememberLogin, classifyRedirect, createRedirectHandler, loginWithPassword, mainWindowTitle,
  ssoWindowTitle, InvalidCredentialsError
} from '../../src/main/linto/auth'
import { UnauthorizedError } from '../../src/shared/types'
import type { LintoApi } from '../../src/main/linto/api'

const I = 'https://studio.linto.ai'
describe('classifyRedirect', () => {
  it('token', () => expect(classifyRedirect(`${I}/login/oidc?token=abc`, I)).toEqual({ kind: 'token', token: 'abc' }))
  it('exchange', () => expect(classifyRedirect(`${I}/login/oidc`, I)).toEqual({ kind: 'exchange' }))
  it('other', () => expect(classifyRedirect(`${I}/login`, I)).toEqual({ kind: 'none' }))
  it('look-alike host', () => {
    expect(classifyRedirect('https://evil.test/login/oidc?token=x', I)).toEqual({ kind: 'none' })
    expect(classifyRedirect('https://studio.linto.ai.evil.test/login/oidc', I)).toEqual({ kind: 'none' })
  })
  it('garbage', () => expect(classifyRedirect('not a url', I)).toEqual({ kind: 'none' }))
})

describe('loginWithPassword', () => {
  it('maps 401 to InvalidCredentialsError', async () => {
    const api = { loginLocal: async () => { throw new UnauthorizedError() } } as unknown as LintoApi
    const e = await loginWithPassword(api, 'a', 'b').catch((x) => x)
    expect(e).toBeInstanceOf(InvalidCredentialsError)
    expect(e.message).toBe('Email ou mot de passe incorrect.')
  })
  it('returns token', async () => {
    const api = { loginLocal: async () => ({ token: 't', userId: 'u' }) } as unknown as LintoApi
    expect(await loginWithPassword(api, 'a', 'b')).toBe('t')
  })
})

describe('createRedirectHandler', () => {
  it('exchanges once, only after navigation', () => {
    const h = createRedirectHandler(I)
    const u = `${I}/login/oidc`
    expect(h('will-redirect', u).action).toBe('ignore')
    expect(h('will-navigate', u).action).toBe('ignore')
    expect(h('did-navigate', u).action).toBe('exchange')
    expect(h('did-navigate', u).action).toBe('ignore')
    expect(h('did-redirect-navigation', u).action).toBe('ignore')
  })
  it('token on earliest event', () => {
    expect(createRedirectHandler(I)('will-redirect', `${I}/login/oidc?token=t`)).toEqual({ action: 'resolve-token', token: 't' })
  })
  it('ignores other urls', () => {
    expect(createRedirectHandler(I)('did-navigate', 'https://evil.test/login/oidc').action).toBe('ignore')
  })
})

describe('saved login (« Se souvenir de moi »)', () => {
  it('only offered when the OS keychain really protects it', () => {
    expect(canRememberLogin('darwin', true)).toBe(true)
    expect(canRememberLogin('darwin', false)).toBe(false)
    expect(canRememberLogin('linux', true, 'gnome_libsecret')).toBe(true)
    expect(canRememberLogin('linux', true, 'kwallet6')).toBe(true)
    expect(canRememberLogin('linux', true, 'basic_text')).toBe(false)
    expect(canRememberLogin('linux', true, 'unknown')).toBe(false)
    expect(canRememberLogin('linux', false, 'gnome_libsecret')).toBe(false)
  })
  it('after a successful login: save when ticked, forget when unticked, untouched otherwise', () => {
    const store = { setSavedLogin: vi.fn() }
    applyRemember(store, true, 'a@b.c', 'pw', true)
    expect(store.setSavedLogin).toHaveBeenLastCalledWith({ email: 'a@b.c', password: 'pw' })
    applyRemember(store, true, 'a@b.c', 'pw', false)
    expect(store.setSavedLogin).toHaveBeenLastCalledWith(null)
    applyRemember(store, true, 'a@b.c', 'pw', undefined)
    expect(store.setSavedLogin).toHaveBeenCalledTimes(2)
    applyRemember(store, false, 'a@b.c', 'pw', true) // no keychain: never stored
    expect(store.setSavedLogin).toHaveBeenLastCalledWith(null)
  })
})

describe('window titles password managers match on', () => {
  it('login screen names the instance host', () => {
    expect(mainWindowTitle(false, 'https://studio.linto.ai')).toBe('Connexion à LinTO — studio.linto.ai')
    expect(mainWindowTitle(false, 'http://localhost:8080/')).toBe('Connexion à LinTO — localhost:8080')
    expect(mainWindowTitle(true, 'https://studio.linto.ai')).toBe('LinTO Live')
  })
  it('SSO window: page title plus the host of the page being shown', () => {
    expect(ssoWindowTitle('Sign in - Google Accounts', 'https://accounts.google.com/v3/signin?x=1')).toBe('Sign in - Google Accounts — accounts.google.com')
    expect(ssoWindowTitle('', 'https://idp.example.org/login')).toBe('idp.example.org')
    expect(ssoWindowTitle('Connexion', 'about:blank')).toBe('Connexion')
  })
})
