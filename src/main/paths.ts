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
  return {
    ...base,
    XDG_CONFIG_HOME: posix.join(p.obsHome, 'config'),
    XDG_CACHE_HOME: posix.join(p.obsHome, 'cache'),
    QT_QPA_PLATFORM: 'xcb'
  }
}
