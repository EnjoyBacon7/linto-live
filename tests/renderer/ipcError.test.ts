import { describe, expect, it } from 'vitest'
import { ipcErrorMessage } from '../../src/renderer/ipcError'

describe('ipcErrorMessage', () => {
  it('strips the Electron invoke prefix', () => {
    const e = new Error("Error invoking remote method 'auth:login-local': Error: Email ou mot de passe incorrect.")
    expect(ipcErrorMessage(e)).toBe('Email ou mot de passe incorrect.')
  })
  it('keeps plain messages and handles non-errors', () => {
    expect(ipcErrorMessage(new Error('boom'))).toBe('boom')
    expect(ipcErrorMessage('x')).toBe('x')
    expect(ipcErrorMessage(undefined)).toBe('Erreur inconnue.')
  })
})
