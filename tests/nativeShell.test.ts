import { describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import {
  AUTH_NOTIFICATION, appMenuTemplate, notificationFor, stableStream, trayIconName, trayMenuTemplate, trayTooltip,
  type AppCommand, type ShellState
} from '../src/main/nativeShell'
import type { LiveState } from '../src/shared/ipc'

const IDLE: LiveState = { phase: 'idle', stream: 'off', captions: 'offline', obs: 'running', output: 'off' }
const LIVE: LiveState = {
  phase: 'live', session: { name: 'Conférence', status: 'active' }, stream: 'active', captions: 'live', obs: 'running', output: 'shown'
}

const shell = (over: Partial<ShellState> = {}): ShellState => ({ platform: 'darwin', loggedIn: true, phase: 'idle', canStart: false, ...over })

/** Every item of a template, submenus flattened. */
function flat(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? flat(i.submenu) : [])])
}
const item = (items: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions => {
  const found = flat(items).find((i) => i.label === label)
  if (!found) throw new Error(`no item ${label} in ${flat(items).map((i) => i.label).join(', ')}`)
  return found
}
const click = (i: MenuItemConstructorOptions): void => {
  ;(i.click as unknown as () => void)()
}
const menu = (items: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions[] => {
  const m = items.find((i) => i.label === label)
  if (!m || !Array.isArray(m.submenu)) throw new Error(`no menu ${label}`)
  return m.submenu
}
const labels = (items: MenuItemConstructorOptions[]): (string | undefined)[] => items.map((i) => i.label)

describe('appMenuTemplate', () => {
  it('macOS: app menu, Édition, Session, Fenêtre, Compte', () => {
    const t = appMenuTemplate(shell(), vi.fn())
    expect(labels(t)).toEqual(['LinTO Live', 'Édition', 'Session', 'Fenêtre', 'Compte', 'Aide'])
    expect(labels(menu(t, 'Aide'))).toEqual(['À propos de LinTO Live'])
    const appMenu = menu(t, 'LinTO Live')
    expect(appMenu.find((i) => i.label === 'À propos de LinTO Live')?.role).toBe('about')
    expect(item(t, 'Désinstaller LinTO Live…')).toBeTruthy()
    expect(appMenu.find((i) => i.role === 'hide')).toBeTruthy()
    expect(item(t, 'Quitter LinTO Live').accelerator).toBe('CmdOrCtrl+Q')
  })

  it('Linux: same groups, Désinstaller and Quitter under Fichier', () => {
    const t = appMenuTemplate(shell({ platform: 'linux' }), vi.fn())
    expect(labels(t)).toEqual(['Fichier', 'Édition', 'Session', 'Fenêtre', 'Compte', 'Aide'])
    expect(labels(menu(t, 'Fichier')).filter(Boolean)).toEqual(['Désinstaller LinTO Live…', 'Quitter'])
    expect(item(t, 'Quitter').accelerator).toBe('CmdOrCtrl+Q')
    expect(flat(t).some((i) => i.role === 'hide')).toBe(false)
  })

  it('accelerators are exactly the agreed ones', () => {
    const t = appMenuTemplate(shell(), vi.fn())
    expect(item(t, 'Nouvelle session…').accelerator).toBe('CmdOrCtrl+N')
    expect(item(t, 'Démarrer').accelerator).toBe('CmdOrCtrl+Return')
    expect(item(t, 'Arrêter').accelerator).toBe('CmdOrCtrl+.')
    expect(item(t, 'Afficher la fenêtre de sortie').accelerator).toBe('CmdOrCtrl+1')
    expect(item(t, 'Afficher LinTO Live').accelerator).toBe('CmdOrCtrl+0')
    expect(item(t, 'Terminer la session…').accelerator).toBeUndefined()
  })

  it('idle without a session: Démarrer disabled, live-only items disabled', () => {
    const t = appMenuTemplate(shell({ canStart: false }), vi.fn())
    expect(item(t, 'Démarrer').enabled).toBe(false)
    expect(item(t, 'Arrêter').enabled).toBe(false)
    expect(item(t, 'Terminer la session…').enabled).toBe(false)
    expect(item(t, 'Afficher la fenêtre de sortie').enabled).toBe(false)
    expect(item(t, 'Nouvelle session…').enabled).toBe(true)
    expect(item(t, 'Se déconnecter').enabled).toBe(true)
  })

  it('idle (or after a failed start) with a startable session: Démarrer enabled', () => {
    expect(item(appMenuTemplate(shell({ canStart: true }), vi.fn()), 'Démarrer').enabled).toBe(true)
    expect(item(appMenuTemplate(shell({ canStart: true, phase: 'error' }), vi.fn()), 'Démarrer').enabled).toBe(true)
    expect(item(appMenuTemplate(shell({ canStart: true, phase: 'starting' }), vi.fn()), 'Démarrer').enabled).toBe(false)
  })

  it('live: Arrêter, Terminer and Afficher la fenêtre de sortie enabled, Démarrer disabled', () => {
    const t = appMenuTemplate(shell({ phase: 'live', canStart: true, sessionName: 'Conférence' }), vi.fn())
    expect(item(t, 'Démarrer').enabled).toBe(false)
    expect(item(t, 'Arrêter').enabled).toBe(true)
    expect(item(t, 'Terminer la session…').enabled).toBe(true)
    expect(item(t, 'Afficher la fenêtre de sortie').enabled).toBe(true)
    expect(item(t, 'Se déconnecter').enabled).toBe(false) // the show on air keeps its account
  })

  it('logged out: session items and Se déconnecter disabled', () => {
    const t = appMenuTemplate(shell({ loggedIn: false }), vi.fn())
    expect(item(t, 'Nouvelle session…').enabled).toBe(false)
    expect(item(t, 'Se déconnecter').enabled).toBe(false)
    expect(item(t, 'Afficher LinTO Live').enabled).not.toBe(false)
  })

  it('clicking an item runs its command', () => {
    const run = vi.fn<(c: AppCommand) => void>()
    const t = appMenuTemplate(shell({ phase: 'live', canStart: true }), run)
    const expected: [string, AppCommand][] = [
      ['Nouvelle session…', 'new-session'], ['Démarrer', 'start'], ['Arrêter', 'stop'],
      ['Terminer la session…', 'terminate'], ['Afficher la fenêtre de sortie', 'show-output'],
      ['Afficher LinTO Live', 'show-window'], ['Se déconnecter', 'logout'],
      ['Désinstaller LinTO Live…', 'uninstall'], ['Quitter LinTO Live', 'quit']
    ]
    for (const [label, cmd] of expected) {
      run.mockClear()
      click(item(t, label))
      expect(run).toHaveBeenCalledWith(cmd)
    }
  })

  it('Fenêtre has the standard minimize (and zoom on macOS)', () => {
    const mac = menu(appMenuTemplate(shell(), vi.fn()), 'Fenêtre').map((i) => i.role)
    expect(mac).toEqual(expect.arrayContaining(['minimize', 'zoom']))
    const linux = menu(appMenuTemplate(shell({ platform: 'linux' }), vi.fn()), 'Fenêtre').map((i) => i.role)
    expect(linux).toContain('minimize')
    expect(linux).not.toContain('zoom')
  })
})

describe('tray', () => {
  it('icon: live variant only while live', () => {
    expect(trayIconName('live')).toBe('trayLiveTemplate')
    for (const p of ['idle', 'starting', 'stopping', 'error'] as const) expect(trayIconName(p)).toBe('trayTemplate')
  })

  it('tooltip names the session on air', () => {
    expect(trayTooltip(shell({ phase: 'live', sessionName: 'Conférence' }))).toBe('LinTO Live — en direct : Conférence')
    expect(trayTooltip(shell({ sessionName: 'Conférence' }))).toBe('LinTO Live')
  })

  it('idle: disabled status line, Démarrer, output, window, separator, Quitter', () => {
    const run = vi.fn()
    const t = trayMenuTemplate(shell({ canStart: true, sessionName: 'Conférence' }), run)
    expect(t[0]).toMatchObject({ label: 'Prêt — Conférence', enabled: false })
    expect(labels(t)).toEqual(['Prêt — Conférence', undefined, 'Démarrer', 'Afficher la fenêtre de sortie', 'Afficher LinTO Live', undefined, 'Quitter LinTO Live'])
    expect(t[1]!.type).toBe('separator')
    expect(t[5]!.type).toBe('separator')
    expect(item(t, 'Démarrer').enabled).toBe(true)
    expect(item(t, 'Afficher la fenêtre de sortie').enabled).toBe(false)
    click(item(t, 'Démarrer'))
    click(item(t, 'Afficher LinTO Live'))
    click(item(t, 'Quitter LinTO Live'))
    expect(run.mock.calls).toEqual([['start'], ['show-window'], ['quit']])
  })

  it('live: status line, Arrêter instead of Démarrer, output enabled', () => {
    const run = vi.fn()
    const t = trayMenuTemplate(shell({ phase: 'live', sessionName: 'Conférence' }), run)
    expect(t[0]).toMatchObject({ label: 'En direct — Conférence', enabled: false })
    expect(flat(t).some((i) => i.label === 'Démarrer')).toBe(false)
    click(item(t, 'Arrêter'))
    click(item(t, 'Afficher la fenêtre de sortie'))
    expect(run.mock.calls).toEqual([['stop'], ['show-output']])
  })

  it('status line for the other phases', () => {
    expect(trayMenuTemplate(shell({ loggedIn: false }), vi.fn())[0]!.label).toBe('Non connecté')
    expect(trayMenuTemplate(shell(), vi.fn())[0]!.label).toBe('Prêt')
    expect(trayMenuTemplate(shell({ phase: 'starting' }), vi.fn())[0]!.label).toBe('Démarrage…')
    expect(trayMenuTemplate(shell({ phase: 'stopping' }), vi.fn())[0]!.label).toBe('Arrêt…')
    expect(trayMenuTemplate(shell({ phase: 'error' }), vi.fn())[0]!.label).toBe('Erreur')
  })

  it('Linux: Quitter', () => {
    expect(labels(trayMenuTemplate(shell({ platform: 'linux' }), vi.fn())).at(-1)).toBe('Quitter')
  })
})

describe('notificationFor', () => {
  it('stream active → error', () => {
    expect(notificationFor(LIVE, { ...LIVE, stream: 'error' })?.title).toBe("Le son n'arrive plus à LinTO")
  })
  it('captions live → offline', () => {
    expect(notificationFor(LIVE, { ...LIVE, captions: 'offline' })?.title).toBe('Sous-titres interrompus')
  })
  it('obs running → restarting', () => {
    expect(notificationFor(LIVE, { ...LIVE, obs: 'restarting' })?.title).toBe('OBS redémarre')
    expect(notificationFor(IDLE, { ...IDLE, obs: 'restarting' })?.title).toBe('OBS redémarre')
  })
  it('every notification has a body', () => {
    for (const next of [{ ...LIVE, stream: 'error' as const }, { ...LIVE, captions: 'offline' as const }, { ...LIVE, obs: 'restarting' as const }]) {
      expect(notificationFor(LIVE, next)?.body).toBeTruthy()
    }
    expect(AUTH_NOTIFICATION).toEqual({ title: 'Connexion LinTO expirée', body: expect.any(String) })
  })
  it('no-op and other transitions: null', () => {
    expect(notificationFor(LIVE, LIVE)).toBeNull()
    expect(notificationFor(LIVE, { ...LIVE, startedAt: 1 })).toBeNull()
    // A first start that never reached 'active' is not « the sound stopped ».
    expect(notificationFor({ ...LIVE, stream: 'starting' }, { ...LIVE, stream: 'error' }, 'off')).toBeNull()
    expect(notificationFor({ ...LIVE, captions: 'connecting' }, { ...LIVE, captions: 'offline' })).toBeNull()
    expect(notificationFor({ ...LIVE, obs: 'down' }, { ...LIVE, obs: 'restarting' })).toBeNull()
    expect(notificationFor({ ...LIVE, stream: 'error' }, { ...LIVE, stream: 'error' })).toBeNull()
  })
  it('stream active → starting (OBS reconnecting) → error notifies', () => {
    const reconnecting = { ...LIVE, stream: 'starting' as const }
    expect(notificationFor(LIVE, reconnecting, 'active')).toBeNull()
    expect(notificationFor(reconnecting, { ...LIVE, stream: 'error' }, 'active')?.title).toBe("Le son n'arrive plus à LinTO")
  })
  it('error → starting → error retry loops notify only once (until the stream is active again)', () => {
    const seq: LiveState['stream'][] = ['active', 'starting', 'error', 'starting', 'error', 'starting', 'error', 'starting', 'active', 'starting', 'error']
    let prev: LiveState = { ...LIVE, stream: seq[0]! }
    let last = prev.stream
    const titles: (string | undefined)[] = []
    for (const st of seq.slice(1)) {
      const next = { ...LIVE, stream: st }
      titles.push(notificationFor(prev, next, last)?.title)
      last = stableStream(last, next)
      prev = next
    }
    expect(titles.filter(Boolean)).toEqual(["Le son n'arrive plus à LinTO", "Le son n'arrive plus à LinTO"])
    expect(titles[1]).toBe("Le son n'arrive plus à LinTO")
    expect(titles[9]).toBe("Le son n'arrive plus à LinTO")
  })
  it('stableStream ignores the transient starting state', () => {
    expect(stableStream('active', { ...LIVE, stream: 'starting' })).toBe('active')
    expect(stableStream('active', { ...LIVE, stream: 'error' })).toBe('error')
    expect(stableStream('error', { ...LIVE, stream: 'active' })).toBe('active')
  })
  it('the show dying (live or starting → error) notifies with the warning', () => {
    const n = notificationFor(LIVE, { ...LIVE, phase: 'error', obs: 'down', warning: "OBS s'est arrêté et n'a pas pu redémarrer." })
    expect(n).toEqual({ title: "Le direct s'est arrêté", body: "OBS s'est arrêté et n'a pas pu redémarrer." })
    const generic = notificationFor({ ...LIVE, phase: 'starting' }, { ...LIVE, phase: 'error' })
    expect(generic?.title).toBe("Le direct s'est arrêté")
    expect(generic?.body).toBeTruthy()
    // the show ended by main because the session was terminated elsewhere (stopping → error)
    const ended = notificationFor({ ...LIVE, phase: 'stopping' }, { ...IDLE, phase: 'error', warning: 'terminée' })
    expect(ended).toEqual({ title: "Le direct s'est arrêté", body: 'terminée' })
    expect(notificationFor(IDLE, { ...IDLE, phase: 'error', warning: 'x' })).toBeNull()
    expect(notificationFor({ ...IDLE, phase: 'error' }, { ...IDLE, phase: 'error', warning: 'y' })).toBeNull()
  })
  it('a normal Arrêter (stream and captions go off together, phase idle) does not notify', () => {
    expect(notificationFor(LIVE, { ...IDLE, phase: 'idle', stream: 'off', captions: 'offline' })).toBeNull()
    expect(notificationFor(LIVE, { ...LIVE, phase: 'stopping', captions: 'offline' })).toBeNull()
  })
})
