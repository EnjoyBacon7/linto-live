import { posix } from 'node:path'

export interface AppPaths {
  userData: string
  obsHome: string
  obsConfigDir: string
  settingsFile: string
}

export function appPaths(userData: string, platform: NodeJS.Platform): AppPaths {
  const obsHome = posix.join(userData, 'obs-home')
  const obsConfigDir =
    platform === 'darwin'
      ? posix.join(obsHome, 'Library', 'Application Support', 'obs-studio')
      : posix.join(obsHome, 'config', 'obs-studio')
  return { userData, obsHome, obsConfigDir, settingsFile: posix.join(userData, 'settings.json') }
}

export function obsEnv(
  p: AppPaths,
  platform: NodeJS.Platform,
  base: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  if (platform === 'darwin') return { ...base, CFFIXED_USER_HOME: p.obsHome }
  const env: NodeJS.ProcessEnv = {
    ...base,
    XDG_CONFIG_HOME: posix.join(p.obsHome, 'config'),
    XDG_CACHE_HOME: posix.join(p.obsHome, 'cache'),
    QT_QPA_PLATFORM: 'xcb'
  }
  // The AppImage's AppRun prepends $APPDIR/usr/lib to LD_LIBRARY_PATH for Electron; the bundled
  // OBS carries its own libraries (resources/obs/lib) and must not pick up Electron's.
  const appDir = base.APPDIR
  if (appDir && env.LD_LIBRARY_PATH !== undefined) {
    const kept = env.LD_LIBRARY_PATH.split(':').filter(
      (d) => d !== '' && d !== appDir && !d.startsWith(appDir.endsWith('/') ? appDir : `${appDir}/`)
    )
    if (kept.length > 0) env.LD_LIBRARY_PATH = kept.join(':')
    else delete env.LD_LIBRARY_PATH
  }
  return env
}
