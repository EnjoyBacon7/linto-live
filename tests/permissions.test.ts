import { describe, expect, it, vi } from 'vitest'
import {
  asMediaAccess, deferObsBoot, isMediaPermission, permissionsStatus, privacySettingsUrl, requestMediaAccess, type MediaAccessApi
} from '../src/main/permissions'

function sys(status: Record<string, string>): MediaAccessApi & { askForMediaAccess: ReturnType<typeof vi.fn> } {
  return {
    getMediaAccessStatus: (k) => status[k] ?? 'unknown',
    askForMediaAccess: vi.fn(async (k: string) => { status[k] = 'granted'; return true })
  }
}

describe('permissionsStatus', () => {
  it('never needs the page outside macOS', () => {
    expect(permissionsStatus('linux', false, null)).toEqual({ needed: false, camera: 'granted', microphone: 'granted' })
    expect(permissionsStatus('linux', false, sys({ camera: 'denied', microphone: 'denied' })).needed).toBe(false)
  })
  it('macOS: needed until onboarded, unless everything is already granted', () => {
    expect(permissionsStatus('darwin', false, sys({ camera: 'not-determined', microphone: 'granted' })))
      .toEqual({ needed: true, camera: 'not-determined', microphone: 'granted' })
    expect(permissionsStatus('darwin', false, sys({ camera: 'denied', microphone: 'granted' })).needed).toBe(true)
    expect(permissionsStatus('darwin', true, sys({ camera: 'not-determined', microphone: 'denied' })).needed).toBe(false)
    expect(permissionsStatus('darwin', false, sys({ camera: 'granted', microphone: 'granted' })).needed).toBe(false)
  })
  it('maps unexpected statuses to unknown', () => {
    expect(asMediaAccess('weird')).toBe('unknown')
    expect(asMediaAccess('restricted')).toBe('restricted')
  })
})

describe('deferObsBoot', () => {
  it('waits for the page only when macOS never asked', () => {
    expect(deferObsBoot({ needed: true, camera: 'not-determined', microphone: 'granted' })).toBe(true)
    expect(deferObsBoot({ needed: true, camera: 'denied', microphone: 'denied' })).toBe(false)
    expect(deferObsBoot({ needed: false, camera: 'not-determined', microphone: 'not-determined' })).toBe(false)
  })
})

describe('requestMediaAccess', () => {
  it('asks when never asked, returns the new access', async () => {
    const s = sys({ camera: 'not-determined' })
    await expect(requestMediaAccess(s, 'camera')).resolves.toBe('granted')
    expect(s.askForMediaAccess).toHaveBeenCalledWith('camera')
  })
  it('does not ask again once answered', async () => {
    const s = sys({ microphone: 'denied' })
    await expect(requestMediaAccess(s, 'microphone')).resolves.toBe('denied')
    expect(s.askForMediaAccess).not.toHaveBeenCalled()
  })
})

describe('privacySettingsUrl', () => {
  it('only opens the fixed System Settings panes', () => {
    expect(privacySettingsUrl('camera')).toContain('Privacy_Camera')
    expect(privacySettingsUrl('microphone')).toContain('Privacy_Microphone')
    expect(privacySettingsUrl('notifications')).toContain('preference.notifications')
    expect(privacySettingsUrl('https://evil.example')).toBeNull()
    expect(privacySettingsUrl(undefined)).toBeNull()
  })
  it('isMediaPermission', () => {
    expect(isMediaPermission('camera')).toBe(true)
    expect(isMediaPermission('notifications')).toBe(false)
  })
})
