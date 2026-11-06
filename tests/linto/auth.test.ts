import { describe, it, expect } from 'vitest'
import { classifyRedirect, loginWithPassword, InvalidCredentialsError } from '../../src/main/linto/auth'
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
