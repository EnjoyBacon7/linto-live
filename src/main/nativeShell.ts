import type { MenuItemConstructorOptions } from 'electron'
import type { AppCommand, LiveState } from '../shared/ipc'

/**
 * Electron-free description of the native shell (app menu, tray menu, notifications): main.ts turns
 * these templates into Menu/Tray objects and rebuilds them whenever ShellState changes.
 */

export type { AppCommand }

export interface ShellState {
  platform: string
  loggedIn: boolean
  phase: LiveState['phase']
  /** Session on air, else the one selected in the window. */
  sessionName?: string
  /** Reported by the renderer: Démarrer is possible (session, camera, micro chosen, nothing in progress). */
  canStart: boolean
}

type Item = MenuItemConstructorOptions
type Run = (c: AppCommand) => void

const APP_NAME = 'LinTO Live'
const sep: Item = { type: 'separator' }

const isLive = (s: ShellState): boolean => s.phase === 'live'
/** 'error' = the last start failed: retrying is allowed (same rule as the Démarrer button). */
const canStart = (s: ShellState): boolean => s.canStart && (s.phase === 'idle' || s.phase === 'error')
const quitLabel = (s: ShellState): string => (s.platform === 'darwin' ? `Quitter ${APP_NAME}` : 'Quitter')

const cmd = (label: string, c: AppCommand, run: Run, extra: Partial<Item> = {}): Item => ({ label, click: () => run(c), ...extra })

export function appMenuTemplate(s: ShellState, run: Run): Item[] {
  const mac = s.platform === 'darwin'
  const live = isLive(s)
  const uninstall = cmd(`Désinstaller ${APP_NAME}…`, 'uninstall', run)
  const quit = cmd(quitLabel(s), 'quit', run, { accelerator: 'CmdOrCtrl+Q' })

  const appMenu: Item = {
    label: APP_NAME,
    submenu: [
      { label: `À propos de ${APP_NAME}`, role: 'about' },
      sep,
      uninstall,
      sep,
      { label: `Masquer ${APP_NAME}`, role: 'hide' },
      { label: 'Masquer les autres', role: 'hideOthers' },
      { label: 'Tout afficher', role: 'unhide' },
      sep,
      quit
    ]
  }
  const fileMenu: Item = { label: 'Fichier', submenu: [uninstall, sep, quit] }
  // Without an Edit menu, Cmd+C/V/X/A do not work in text fields on macOS.
  const editMenu: Item = {
    label: 'Édition',
    submenu: [
      { label: 'Annuler', role: 'undo' },
      { label: 'Rétablir', role: 'redo' },
      sep,
      { label: 'Couper', role: 'cut' },
      { label: 'Copier', role: 'copy' },
      { label: 'Coller', role: 'paste' },
      { label: 'Tout sélectionner', role: 'selectAll' }
    ]
  }
  const sessionMenu: Item = {
    label: 'Session',
    submenu: [
      cmd('Nouvelle session…', 'new-session', run, { accelerator: 'CmdOrCtrl+N', enabled: s.loggedIn }),
      sep,
      cmd('Démarrer', 'start', run, { accelerator: 'CmdOrCtrl+Return', enabled: s.loggedIn && canStart(s) }),
      cmd('Arrêter', 'stop', run, { accelerator: 'CmdOrCtrl+.', enabled: live }),
      sep,
      cmd('Terminer la session…', 'terminate', run, { enabled: live })
    ]
  }
  const windowMenu: Item = {
    label: 'Fenêtre',
    submenu: [
      cmd('Afficher la fenêtre de sortie', 'show-output', run, { accelerator: 'CmdOrCtrl+1', enabled: live }),
      cmd(`Afficher ${APP_NAME}`, 'show-window', run, { accelerator: 'CmdOrCtrl+0' }),
      sep,
      { label: 'Réduire', role: 'minimize' },
      ...(mac ? [{ label: 'Réduire/agrandir', role: 'zoom' } as Item] : []),
      { label: 'Fermer la fenêtre', role: 'close' }
    ]
  }
  const accountMenu: Item = {
    label: 'Compte',
    // The show on air keeps its account: log out once it is stopped.
    submenu: [cmd('Se déconnecter', 'logout', run, { enabled: s.loggedIn && !live })]
  }
  const helpMenu: Item = { label: 'Aide', submenu: [{ label: `À propos de ${APP_NAME}`, role: 'about' }] }

  return mac
    ? [appMenu, editMenu, sessionMenu, windowMenu, accountMenu]
    : [fileMenu, editMenu, sessionMenu, windowMenu, accountMenu, helpMenu]
}

/** First (disabled) line of the tray menu: what the app is doing, and on which session. */
function statusLine(s: ShellState): string {
  if (!s.loggedIn && s.phase === 'idle') return 'Non connecté'
  const name = s.sessionName ? ` — ${s.sessionName}` : ''
  switch (s.phase) {
    case 'live': return `En direct${name}`
    case 'starting': return 'Démarrage…'
    case 'stopping': return 'Arrêt…'
    case 'error': return 'Erreur'
    default: return `Prêt${name}`
  }
}

export function trayMenuTemplate(s: ShellState, run: Run): Item[] {
  const live = isLive(s)
  return [
    { label: statusLine(s), enabled: false },
    sep,
    live
      ? cmd('Arrêter', 'stop', run)
      : cmd('Démarrer', 'start', run, { enabled: s.loggedIn && canStart(s) }),
    cmd('Afficher la fenêtre de sortie', 'show-output', run, { enabled: live }),
    cmd(`Afficher ${APP_NAME}`, 'show-window', run),
    sep,
    cmd(quitLabel(s), 'quit', run)
  ]
}

/** File name (without extension) under resources/tray; "Template" lets macOS tint it for the menu bar. */
export function trayIconName(phase: LiveState['phase']): 'trayTemplate' | 'trayLiveTemplate' {
  return phase === 'live' ? 'trayLiveTemplate' : 'trayTemplate'
}

export function trayTooltip(s: ShellState): string {
  return isLive(s) && s.sessionName ? `${APP_NAME} — en direct : ${s.sessionName}` : APP_NAME
}

export interface NotificationText {
  title: string
  body: string
}

export const AUTH_NOTIFICATION: NotificationText = {
  title: 'Connexion LinTO expirée',
  body: 'Reconnecte-toi à LinTO dans LinTO Live.'
}

/**
 * System notification for a LiveState change, or null. Only real failures during the show notify:
 * a normal Arrêter (phase leaves 'live' first) never does.
 */
export function notificationFor(prev: LiveState, next: LiveState): NotificationText | null {
  if (next.phase === 'live' && prev.stream === 'active' && next.stream === 'error') {
    return { title: "Le son n'arrive plus à LinTO", body: 'Les sous-titres ne suivent plus. Ouvre LinTO Live pour voir l’état du direct.' }
  }
  if (next.phase === 'live' && prev.captions === 'live' && next.captions === 'offline') {
    return { title: 'Sous-titres interrompus', body: 'Les sous-titres ne s’affichent plus sur la sortie.' }
  }
  if (prev.obs === 'running' && next.obs === 'restarting') {
    return { title: 'OBS redémarre', body: 'La sortie vidéo revient dans quelques secondes.' }
  }
  return null
}
