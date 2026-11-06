import { posix } from 'node:path'

export function obsExecutable(o: {
  packaged: boolean
  resourcesPath: string
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
}): string {
  if (o.platform === 'darwin') {
    return o.packaged
      ? posix.join(o.resourcesPath, 'obs', 'OBS.app', 'Contents', 'MacOS', 'OBS')
      : (o.env.LINTO_LIVE_OBS ?? '/Applications/OBS.app/Contents/MacOS/OBS')
  }
  return o.packaged ? posix.join(o.resourcesPath, 'obs', 'bin', 'obs') : (o.env.LINTO_LIVE_OBS ?? 'obs')
}
