import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * macOS only. The official OBS.app cannot run from inside another .app bundle: its CEF (browser
 * source) aborts in cef_initialize because Chromium takes the first "*.app" path component as the
 * main bundle. So the packaged app runs a copy of its embedded OBS.app placed under userData
 * (APFS clone: instant, no extra disk; byte-identical, Wizards of OBS signature intact).
 * The copy is refreshed whenever the embedded OBS's code signature seal changes (OBS update).
 * Returns the copy's executable path.
 */
export function ensureObsRuntime(o: { bundledApp: string; runtimeDir: string }): string {
  const seal = (app: string): Buffer | null => {
    const f = join(app, 'Contents', '_CodeSignature', 'CodeResources')
    return existsSync(f) ? readFileSync(f) : null
  }
  const target = join(o.runtimeDir, 'OBS.app')
  const exe = join(target, 'Contents', 'MacOS', 'OBS')
  const want = seal(o.bundledApp)
  if (!want) throw new Error(`Embedded OBS.app missing or unsigned: ${o.bundledApp}`)
  const have = seal(target)
  if (have && have.equals(want) && existsSync(exe)) return exe

  mkdirSync(o.runtimeDir, { recursive: true })
  const tmp = join(o.runtimeDir, `OBS.app.tmp-${process.pid}`)
  rmSync(tmp, { recursive: true, force: true })
  try {
    // -c: clonefile(2) (APFS). -R copies symlinks as symlinks. Fall back to a plain copy elsewhere.
    execFileSync('cp', ['-c', '-R', o.bundledApp, tmp], { stdio: 'ignore' })
  } catch {
    rmSync(tmp, { recursive: true, force: true })
    execFileSync('cp', ['-R', o.bundledApp, tmp], { stdio: 'ignore' })
  }
  rmSync(target, { recursive: true, force: true })
  renameSync(tmp, target)
  return exe
}
