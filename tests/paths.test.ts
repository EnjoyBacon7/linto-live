import { describe, it, expect } from 'vitest'
import { appPaths, obsEnv } from '../src/main/paths'

const U = '/U/LinTO Live'

describe('appPaths', () => {
  it('darwin: obs config under Library/Application Support', () => {
    const p = appPaths(U, 'darwin')
    expect(p.obsHome).toBe('/U/LinTO Live/obs-home')
    expect(p.obsConfigDir).toBe('/U/LinTO Live/obs-home/Library/Application Support/obs-studio')
  })
  it('linux: obs config under config/obs-studio', () => {
    expect(appPaths(U, 'linux').obsConfigDir).toBe('/U/LinTO Live/obs-home/config/obs-studio')
  })
  it('settingsFile and userData', () => {
    const p = appPaths(U, 'linux')
    expect(p.settingsFile).toBe('/U/LinTO Live/settings.json')
    expect(p.userData).toBe(U)
  })
})

describe('obsEnv', () => {
  it('darwin sets CFFIXED_USER_HOME', () => {
    const env = obsEnv(appPaths(U, 'darwin'), 'darwin', {})
    expect(env.CFFIXED_USER_HOME).toBe('/U/LinTO Live/obs-home')
  })
  it('linux sets XDG dirs and xcb', () => {
    const env = obsEnv(appPaths(U, 'linux'), 'linux', {})
    expect(env.XDG_CONFIG_HOME).toBe('/U/LinTO Live/obs-home/config')
    expect(env.XDG_CACHE_HOME).toBe('/U/LinTO Live/obs-home/cache')
    expect(env.QT_QPA_PLATFORM).toBe('xcb')
  })
  it('keeps unrelated base vars and does not mutate base', () => {
    const base = { FOO: 'bar' }
    const env = obsEnv(appPaths(U, 'linux'), 'linux', base)
    expect(env.FOO).toBe('bar')
    expect(base).toEqual({ FOO: 'bar' })
  })
  it('linux inside an AppImage: drops AppRun lib dir from LD_LIBRARY_PATH, keeps the rest', () => {
    const base = { APPDIR: '/tmp/.mount_LinTO', LD_LIBRARY_PATH: '/tmp/.mount_LinTO/usr/lib:/opt/x/lib' }
    const env = obsEnv(appPaths(U, 'linux'), 'linux', base)
    expect(env.LD_LIBRARY_PATH).toBe('/opt/x/lib')
    expect(base.LD_LIBRARY_PATH).toBe('/tmp/.mount_LinTO/usr/lib:/opt/x/lib')
  })
  it('linux inside an AppImage: removes LD_LIBRARY_PATH when only AppRun entries remain', () => {
    const env = obsEnv(appPaths(U, 'linux'), 'linux', {
      APPDIR: '/tmp/.mount_LinTO',
      LD_LIBRARY_PATH: '/tmp/.mount_LinTO/usr/lib'
    })
    expect('LD_LIBRARY_PATH' in env).toBe(false)
  })
  it('linux outside an AppImage: LD_LIBRARY_PATH untouched', () => {
    const env = obsEnv(appPaths(U, 'linux'), 'linux', { LD_LIBRARY_PATH: '/a:/b' })
    expect(env.LD_LIBRARY_PATH).toBe('/a:/b')
  })
})
