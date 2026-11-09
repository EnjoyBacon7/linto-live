# LinTO Live v2 — appli native, sous-titres LinTO, fenêtre de sortie libre — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LinTO Live look and behave like a desktop app, render captions exactly like the LinTO page, and replace display selection with a freely placed OBS projector window.

**Architecture:** Same Electron + React app and main-process controllers as v1. The overlay page (OBS browser source) gets a pure line-layout module reproducing LinTO's 2-line scroller, fed raw `partial`/`final` text. `LiveController` drops all display logic and opens a windowed OBS program projector. The renderer is rebuilt as one native-style window (sidebar of sessions, toolbar, preview, inspector, status bar); main adds application menu, tray and notifications.

**Tech Stack:** Electron 45, electron-vite, React 19, TypeScript strict, Vitest + Testing Library, obs-websocket-js v5.

**Spec:** `docs/superpowers/specs/2026-11-09-linto-live-v2-ui-native-design.md` (builds on `docs/superpowers/specs/2026-11-06-linto-live-design.md`). Read both.

## Global Constraints

- UI copy is French. App name « LinTO Live ».
- Accent colour **`#11977c`** (vert LinTO) for primary action and selection; « EN DIRECT » uses the system red (`#ff3b30` light / `#ff453a` dark).
- System font (`-apple-system, BlinkMacSystemFont, system-ui, sans-serif`); follow system light/dark (`prefers-color-scheme`); no web UI kit (no Material/Bootstrap look).
- Captions: opaque black band, full width, bottom; exactly 2 lines; white **Arial 48 px**; line-height 1.2 × font (57.6 px); band height 2.4 × font (115.2 px); left/right inset **100 px** on the 1920×1080 canvas; no partial/final styling difference; band hidden until the first non-empty text after a reset, then stays until reset.
- LinTO Studio code is AGPL-3.0: **reimplement**, never copy its files.
- OBS remains the only thing producing the output image; no OBS window other than the projector may appear.
- Security posture from v1 unchanged (contextIsolation, sandbox, no nodeIntegration, overlay token check).
- Run Electron/Node commands with `env -u ELECTRON_RUN_AS_NODE` (the shell sets it).
- Commits: no `Co-Authored-By` / Claude attribution lines.
- All of `npm test` and `npm run typecheck` green at the end of every task.

## Review Focus

- An existing `settings.json` from v1 containing `output: {…}` must load without error and the key is ignored (Task 3).
- Session list unavailable (network error, 401, org with zero sessions) — sidebar shows an empty/error state, 401 sends the user to login, nothing crashes (Tasks 4, 6).
- A single word wider than a caption line (URL, long compound) — it gets a line of its own, no infinite loop, the band never grows past 2 lines (Task 1).
- OBS browser source reloaded mid-show (OBS restart or page refresh) — the page shows the current two lines again, not an empty band (Task 2).
- Closing the main window during a live show — the show continues, app reachable from the tray/Dock; ⌘Q still asks the v1 quit confirmation (Task 7).

---

### Task 1: Caption line-layout engine (LinTO-style 2-line scroller)

**Files:**
- Create: `src/main/overlay/page/layout.js` (plain ESM, browser + Node, no imports)
- Create: `src/main/overlay/page/layout.d.ts`
- Test: `tests/overlay/layout.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Layout { words: string[]; cuts: number[] } // cuts = word index where lines 2..n start, ascending
  export function layoutText(prev: Layout, text: string, fits: (line: string) => boolean): Layout
  export class SubtitleModel {
    constructor(fits: (line: string) => boolean)
    partial(text: string): void
    final(text: string): void
    reset(): void
    lines(): [string, string]   // [upper, lower]; '' when absent
    get visible(): boolean       // true once any non-empty text arrived since construction/reset
  }
  ```

Behaviour to implement (spec §« Sous-titres : le modèle à reproduire »):
- `layoutText`: split `text.trim()` on whitespace. `k` = first index where old and new word differ (or `min(len)` if one is a prefix of the other). The line containing `k` starts at `s` = greatest cut ≤ `k` (or 0). Keep every old cut ≤ `s`; from `s`, place words greedily: a word joins the current line if `fits(line + ' ' + word)`, otherwise it starts a new line (push its index to `cuts`). A word that does not fit on an empty line still occupies that line alone. Empty `text` returns `prev` unchanged.
- `SubtitleModel` keeps `current` and `previous` layouts. `partial(t)`: ignore if blank; `current = layoutText(current, t)`. `final(t)`: `current = layoutText(current, t)` (if non-blank), then `previous = current`, `current = empty`. `lines()`: if `current` has no cuts → `[lastLine(previous), text(current)]`; else `[secondToLastLine(current), lastLine(current)]`. `reset()` clears both and `visible`.

- [ ] **Step 1: Write failing tests** in `tests/overlay/layout.test.ts` with `const fits = (l: string) => l.length <= 20`:
  - `layoutText(empty, 'un deux trois quatre cinq six', fits)` → `cuts` equal `[4]` (`'un deux trois quatre'` = 20 chars, `'cinq six'` next).
  - Stability: from that layout, `layoutText(prev, 'un deux trois quatre cinq sixième sept', fits)` keeps `cuts[0] === 4`.
  - Correction inside line 2 never moves cut 4; correction inside line 1 (`'un DEUX trois quatre cinq six'`) recomputes from 0.
  - Shrinking text (`'un deux'` after the 6-word layout) → `cuts` `[]`.
  - Long word: `layoutText(empty, 'a ' + 'x'.repeat(50) + ' b', fits)` → three lines `['a', 'xxxx…', 'b']`, terminates.
  - Blank text returns `prev` (same object or deep-equal).
  - `SubtitleModel`: before any text `visible === false` and `lines()` = `['','']`; `partial('bonjour')` → `['', 'bonjour']`, `visible === true`; `final('bonjour à tous')` then `partial('suite')` → `['bonjour à tous', 'suite']`; a partial spanning 3 lines shows lines 2 and 3; `reset()` → `['','']`, `visible === false`; `partial('   ')` changes nothing.
- [ ] **Step 2: Run** `npx vitest run tests/overlay/layout.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `layout.js` + `layout.d.ts` per the behaviour above.
- [ ] **Step 4: Run** `npx vitest run tests/overlay/layout.test.ts && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(overlay): moteur de mise en ligne des sous-titres façon LinTO"`

---

### Task 2: Overlay page rendering + raw caption protocol

**Files:**
- Modify: `src/main/overlay/page/index.html`, `overlay.css`, `overlay.js` (becomes `type="module"`, imports `./layout.js`)
- Modify: `src/main/overlay/server.ts` (serve `/layout.js` with `text/javascript`; new message type; replay)
- Modify: `src/main/live.ts` (feed raw events; reset on start/stop)
- Test: `tests/overlay/server.test.ts`, `tests/live.test.ts`

**Interfaces:**
- Consumes: `SubtitleModel` (Task 1).
- Produces (in `src/main/overlay/server.ts`):
  ```ts
  export type OverlayMessage = { type: 'reset' } | { type: 'partial' | 'final'; text: string }
  OverlayServer.push(msg: OverlayMessage): void
  ```
  Replay on new WebSocket client: `reset`, then the last `final` since the last reset (if any), then the last `partial` received after that final (if any). Bounded memory (two strings).
- `LiveController`: on caption `partial`/`final` events push `{type, text}` to the overlay (keep `CaptionBuffer` only to compute `LiveState.lastLine`); push `{type:'reset'}` at start of `doStart` (replacing the current `{lines:[],partial:false}` push) and in `doStop`.

Page: band `#band` (absolute, left 0, right 0, bottom 0, height 115.2px, background #000, hidden until `model.visible`), two line divs, Arial 48px white, line-height 57.6px, padding 0 100px, `white-space: nowrap; overflow: hidden`. `fits` measures with a canvas 2D context set to `48px Arial`: `ctx.measureText(line).width <= 1920 - 200`. Reconnect loop as v1.

- [ ] **Step 1: Write failing tests**: server — a client connecting after `push(reset)`, `push(final 'a b')`, `push(partial 'c')`, `push(partial 'c d')` receives exactly `[reset, final 'a b', partial 'c d']`; after another `push(reset)` a new client receives only `[reset]`; `GET /layout.js?k=<token>` returns 200 `text/javascript`. live — a caption `final` event results in `overlay.push({type:'final', text})`; `start` pushes `{type:'reset'}`; `stop` pushes `{type:'reset'}`; `lastLine` still updates.
- [ ] **Step 2: Run** `npx vitest run tests/overlay tests/live.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** server, page and `LiveController` changes.
- [ ] **Step 4: Run** `npm test && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(overlay): sous-titres au rendu LinTO (bandeau noir, 2 lignes, Arial)"`

---

### Task 3: Freely placed output window; remove display selection; always-on preview

**Files:**
- Modify: `src/main/obs/controller.ts` (remove `monitors`, `openProgramProjector(index)`; add `openOutputWindow`)
- Delete: `src/main/obs/monitors.ts`, `tests/obs/monitors.test.ts`
- Modify: `src/main/live.ts`, `src/main/appLifecycle.ts` (remove `watchDisplays`), `src/main/main.ts`, `src/main/setupData.ts`, `src/main/settings.ts`
- Modify: `src/shared/ipc.ts`, `src/shared/types.ts`
- Test: `tests/obs/controller.test.ts`, `tests/live.test.ts`, `tests/appLifecycle.test.ts`, `tests/settings.test.ts`, `tests/setupData.test.ts`, `tests/ipc.test.ts`

**Interfaces:**
- Produces:
  - `ObsController.openOutputWindow(): Promise<void>` → `OpenVideoMixProjector { videoMixType: 'OBS_WEBSOCKET_VIDEO_MIX_TYPE_PROGRAM' }` (no `monitorIndex`, no geometry).
  - `LiveController.showOutputWindow(): Promise<void>` (queued): if OBS attached, always opens a projector window (user asked for it; a duplicate is accepted) and sets `output: 'shown'`.
  - Show logic: `applyShow` opens the output window only if none was opened during the current OBS run (`outputOpened` flag reset in `attach`/`dropController`); Arrêter keeps it open (black via existing `showPause`).
  - `LiveState.output: 'shown' | 'off'`; new `LiveState.startedAt?: number` (ms epoch, set when a session becomes live in `doStart`, cleared on stop).
  - Preview (`GetSourceScreenshot`) runs whenever a controller is attached, not only while live.
  - `IPC.liveShowOutput = 'live:show-output'`, `LintoLiveApi.live.showOutputWindow(): Promise<void>`. Removed: `IPC.liveChangeDisplay`, `live.changeDisplay`, `LiveController.changeDisplay/displaysChanged`, `SetupData.displays/appDisplay`, `Settings.output`, `SavedDisplay`, `MonitorInfo`, `watchDisplays`, `matchDisplay`, R12 "restart OBS to move projector".
  - `SettingsStore` silently drops an unknown legacy `output` key when loading.
- Renderer still compiles: delete the display UI bits in `Setup.tsx`/`Live.tsx` minimally (they are replaced in Task 6), and add a « Afficher la fenêtre de sortie » button in `Live.tsx` calling `live.showOutputWindow()`.

- [ ] **Step 1: Write failing tests**: controller — `openOutputWindow` calls `OpenVideoMixProjector` with exactly `{ videoMixType: 'OBS_WEBSOCKET_VIDEO_MIX_TYPE_PROGRAM' }`. live — first `start` opens the window once; `stop` then `start` does not open a second one; `showOutputWindow()` opens another even if one is open; after an OBS restart (`attach` of a new connection) the next live show opens it again; `startedAt` set on live, absent after stop; preview emits `preview` while idle when attached. settings — loading a file containing `"output":{"name":"HDMI","x":0,"y":0,"width":1920,"height":1080}` succeeds and `get()` has no `output`. ipc — `live.showOutputWindow()` invokes `'live:show-output'`.
- [ ] **Step 2: Run** `npm test` — Expected: new tests FAIL.
- [ ] **Step 3: Implement** the removals and additions above (delete dead tests that only covered removed behaviour).
- [ ] **Step 4: Run** `npm test && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: fenêtre de sortie OBS libre, suppression du choix d'écran"`

---

### Task 4: Session list for the sidebar

**Files:**
- Modify: `src/main/linto/api.ts`, `src/shared/types.ts`, `src/shared/ipc.ts`, `src/main/main.ts`
- Test: `tests/linto/api.test.ts`, `tests/ipc.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/shared/types.ts
  export interface SessionSummary { id: string; name: string; status: Exclude<SessionStatus, 'terminated'>; canStream: boolean; updatedAt?: string }
  // src/main/linto/api.ts
  LintoApi.listSessions(orgId: string): Promise<Session[]>   // statusList 'on_schedule,ready,active,paused', same paging/limits as searchSessions, no searchName
  // IPC
  IPC.sessionsList = 'sessions:list'
  LintoLiveApi.sessions.list(): Promise<SessionSummary[]>
  ```
  `Session` gains `updatedAt?: string` (mapped from API `updatedAt`). Main handler: needs `settings.orgId` (returns `[]` if unset); maps with `canStream = toObsStreamService(s.channels[0]?.streamEndpoints ?? {}) !== null`; sorts `active` first, then by `updatedAt` desc; on `UnauthorizedError` calls `live.reportUnauthorized()` and rethrows (same as `setup:load`). Factor the shared paging loop out of `searchSessions` rather than duplicating it.

- [ ] **Step 1: Write failing tests**: `listSessions` requests `statusList=on_schedule%2Cready%2Cactive%2Cpaused` without `searchName`, pages like `searchSessions`, maps `updatedAt`; `searchSessions` tests still pass; ipc bridge `sessions.list()` invokes `'sessions:list'`. Extract the main handler body into an exported pure function `toSessionSummaries(sessions: Session[]): SessionSummary[]` (in `src/main/setupData.ts`) and test sorting (`active` first, then newest `updatedAt`) and `canStream` false when the channel has no endpoints.
- [ ] **Step 2: Run** `npx vitest run tests/linto/api.test.ts tests/ipc.test.ts tests/setupData.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: liste des sessions de l'organisation"`

---

### Task 5: Native window chrome and design system

**Files:**
- Modify: `src/main/main.ts` (`createWindow`), `src/main/settings.ts` (`windowBounds`), `src/main/appLifecycle.ts`, `src/main/preload.ts`, `src/shared/ipc.ts`
- Create: `src/renderer/theme.css` (replaces `styles.css`), `src/renderer/ui/` — `Button.tsx`, `PopUp.tsx`, `TextField.tsx`, `StatusDot.tsx`, `Banner.tsx`, `Sheet.tsx`, `icons.tsx` (inline SVG icons, SF Symbols-like strokes), `src/renderer/assets/linto.svg` (download from `https://studio.linto.ai/img/linto.svg`; if unavailable, a simple wordmark SVG)
- Test: `tests/appLifecycle.test.ts`, `tests/renderer/ui.test.tsx`, `tests/ipc.test.ts`

**Interfaces:**
- Produces:
  - `restoreBounds(saved: Bounds | undefined, displays: Bounds[], def: { width: number; height: number }): Bounds | { width: number; height: number }` in `appLifecycle.ts` — returns `saved` only if its rectangle intersects some display's work area by ≥ 100×100 px, else `def`. `Bounds = { x: number; y: number; width: number; height: number }`. `Settings.windowBounds?: Bounds`, saved on window `close` (debounced on `resize`/`move` is fine).
  - Window: default 1100×720, `minWidth: 860`, `minHeight: 560`. macOS: `titleBarStyle: 'hiddenInset'`, `trafficLightPosition: { x: 18, y: 18 }`, `vibrancy: 'sidebar'`, `visualEffectState: 'followWindow'`, `backgroundColor: '#00000000'`. Linux: normal frame, `backgroundColor` from `nativeTheme.shouldUseDarkColors` (`#1e1e1e` / `#ececec`).
  - `LintoLiveApi.platform: 'darwin' | 'linux' | string` (passed by preload from `process.platform`; `createLintoLiveApi(t, platform)`). Renderer sets `document.documentElement.dataset.platform`.
  - `theme.css` tokens (light and dark via `prefers-color-scheme`): `--accent: #11977c`, `--live: #ff3b30 / #ff453a`, `--ok`, `--warn`, `--bad`, `--text`, `--text-2`, `--text-3`, `--bg-window`, `--bg-content`, `--bg-sidebar` (transparent on `[data-platform=darwin]` so vibrancy shows), `--separator`, `--control-bg`, `--control-border`; base font 13px system font; `-webkit-user-select: none` on chrome, text selectable in inputs; `.drag` (`-webkit-app-region: drag`) / `.no-drag` helpers; focus ring in accent.
  - UI primitives (props):
    - `Button({ variant?: 'default' | 'primary' | 'destructive' | 'plain', size?: 'regular' | 'large', icon?: ReactNode, ...ButtonHTMLAttributes })`
    - `PopUp({ label: string, value: string, options: { value: string; label: string; disabled?: boolean }[], onChange(v: string): void, disabled?: boolean, placeholder?: string })` — native `<select>` styled as a macOS pop-up button, `aria-label = label`
    - `TextField({ label: string, ...InputHTMLAttributes })`
    - `StatusDot({ tone: 'live' | 'ok' | 'warn' | 'bad' | 'idle', pulse?: boolean })`
    - `Banner({ tone: 'warn' | 'bad', children, action?: ReactNode })` with `role="alert"`
    - `Sheet({ title: string, open: boolean, onClose(): void, children, footer: ReactNode })` — modal sheet dropping from the top of the content area, `role="dialog"`, `aria-modal`, Esc closes, focus trapped on first field
- [ ] **Step 1: Write failing tests**: `restoreBounds` (visible saved → saved; saved on a removed display → default; undefined → default); `ui.test.tsx`: `PopUp` calls `onChange` with the option value and exposes `aria-label`; `Sheet` closes on Escape and is absent when `open=false`; `Banner` has `role=alert`; ipc `platform` is passed through.
- [ ] **Step 2: Run** `npx vitest run tests/appLifecycle.test.ts tests/renderer/ui.test.tsx tests/ipc.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** chrome, bounds persistence, tokens and primitives (screens keep working on the new stylesheet; their full redesign is Task 6).
- [ ] **Step 4: Run** `npm test && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(ui): fenêtre native et système de design"`

---

### Task 6: Main window and login redesign

**Files:**
- Create: `src/renderer/screens/MainWindow.tsx`, `src/renderer/main/Sidebar.tsx`, `Toolbar.tsx`, `Stage.tsx`, `Inspector.tsx`, `StatusBar.tsx`, `NewSessionSheet.tsx`, `ConfirmSheet.tsx`, `useLive.ts` (state/elapsed hooks)
- Modify: `src/renderer/App.tsx`, `src/renderer/screens/Login.tsx` (layout only; logic unchanged)
- Delete: `src/renderer/screens/Setup.tsx`, `src/renderer/screens/Live.tsx` (and their now-obsolete tests in `tests/renderer/screens.test.tsx`, `fixes.test.tsx`, `finalFixes.test.tsx` — port every still-relevant behaviour test to the new components: busy guards, Escape on confirm, auth-required banner while live, logged-out redirect, single organization persisted, error display)
- Modify: `tests/renderer/helpers.ts` (add `sessions.list`, `live.showOutputWindow`, `platform`; drop displays)
- Test: `tests/renderer/mainWindow.test.tsx`, `tests/renderer/login.test.tsx`

**Interfaces:**
- Consumes: Task 3 (`showOutputWindow`, `startedAt`, `output`), Task 4 (`sessions.list`, `SessionSummary`), Task 5 primitives/tokens.
- Layout (spec §« L'appli : structure de la fenêtre »), grid `sidebar 220px | content`:
  - **Sidebar** (`drag` region top 52px for traffic lights on macOS): section « Sessions »; rows = `SessionSummary` with `StatusDot` (`active`→live, `ready`→ok, `paused`→warn, `on_schedule`→idle) and a status label on hover/`title`; `canStream:false` rows dimmed with `title` « LinTO Live ne peut pas envoyer le son à cette session (droits insuffisants ou pas d'entrée audio) » and not startable; « Nouvelle session… » row; empty state « Aucune session en cours » ; error state with « Réessayer ». Footer: instance host + menu button (organisation switch when >1 → `setup.save({orgId})` then reload lists; « Se déconnecter »). List refreshes on mount, after start/stop/terminate, and every 30 s.
  - **Toolbar** (`drag`, buttons `no-drag`): selected session name + caption « nouvelle » / « réutilisée » (after start) ; when idle: primary « Démarrer » (disabled without session, camera, micro, or with `canStream:false`); when live: red pill `StatusDot live pulse` « EN DIRECT mm:ss » (from `startedAt`, `h:mm:ss` past an hour), button « Arrêter », icon button « Afficher la fenêtre de sortie » (`live.showOutputWindow()`), and « Terminer… » (destructive, opens `ConfirmSheet`).
  - **Stage**: preview image (`on('preview')`), 16:9, letterboxed; placeholder « Choisis une caméra » when none; caption « Sortie OBS — ce qui s'affiche dans la fenêtre de sortie ». Banners (warning, auth-required with « Se reconnecter » opening Login in a `Sheet`) above it.
  - **Inspector** (right, 240px): `PopUp` Caméra, `PopUp` Micro + `VuMeter` restyled as segmented meter, Profil de transcription — read-only text for an existing session (« Défini par la session »), editable only in `NewSessionSheet`. Changing camera/micro while live is allowed (`setup.save` already applies to OBS).
  - **StatusBar**: « LinTO reçoit le son » (`stream`), « Sous-titres » (`captions`), « OBS » (`obs`), each `StatusDot` + short French state, then `lastLine` truncated.
  - **NewSessionSheet**: `TextField` « Nom » + `PopUp` « Profil de transcription » (and organisation if >1). Submit: if a listed session has exactly that name → select it; else select a pending new session `{ name, profileId }` (not created). « Démarrer » on a pending session first `setup.save({ profileId })`, then `live.start(name)`.
  - **Switch while live**: clicking another startable session opens `ConfirmSheet` « Basculer le direct sur « X » ? » → `live.start(X)`; selection follows only on success.
  - **ConfirmSheet** for terminate: « Terminer définitivement la session « X » ? Elle ne pourra plus être reprise. » buttons « Annuler » (default, Esc) / « Terminer » (destructive) → `live.terminate()`.
  - **Login**: full window, centered column max 360px: LinTO logo, « Connexion à LinTO », instance shown as small editable text (« studio.linto.ai — Modifier »), email/password `TextField`s, primary « Se connecter », separator « ou », one `Button` per SSO method « Continuer avec {name} ». Same logic and validations as v1.
  - Uninstall moves out of the UI into the app menu (Task 7); keep `app.uninstall` in the API.
- [ ] **Step 1: Write failing tests** (`mainWindow.test.tsx`, `login.test.tsx`) covering every bullet above with mocked `window.lintoLive` (helpers): sidebar rows and states (incl. dimmed `canStream:false` with Démarrer disabled, empty, error+retry); start existing; new pending session start order (`setup.save({profileId})` before `live.start`); typing an existing name selects it; live toolbar shows `EN DIRECT 00:05` given `startedAt = now-5s` (fake timers); Arrêter/Terminer/confirm/Escape; switch confirm; show-output button; auth-required banner while live vs redirect to login when idle; ported v1 behaviour tests.
- [ ] **Step 2: Run** `npx vitest run tests/renderer` — Expected: FAIL.
- [ ] **Step 3: Implement** components and wire `App.tsx` (`loading | login | main`).
- [ ] **Step 4: Run** `npm test && npm run typecheck && env -u ELECTRON_RUN_AS_NODE npm run build` — Expected: PASS / build OK.
- [ ] **Step 5: Commit** `git commit -m "feat(ui): fenêtre principale native (sessions, aperçu, réglages) et nouvel écran de connexion"`

---

### Task 7: Application menu, tray, notifications, close-to-tray

**Files:**
- Create: `src/main/nativeShell.ts`, `resources/tray/` (`trayTemplate.png`, `trayTemplate@2x.png`, `trayLiveTemplate.png`, `trayLiveTemplate@2x.png` — 16/32 px monochrome; live variant with a filled dot; generate with a small script committed under `scripts/`)
- Modify: `src/main/main.ts`, `src/main/appLifecycle.ts`, `src/shared/ipc.ts`, `src/renderer/App.tsx`/`MainWindow.tsx`, `electron-builder.yml` (ship `resources/tray`)
- Test: `tests/nativeShell.test.ts`, `tests/appLifecycle.test.ts`, `tests/renderer/mainWindow.test.tsx`

**Interfaces:**
- Produces (`src/main/nativeShell.ts`, pure, Electron-free):
  ```ts
  export type AppCommand = 'new-session' | 'start' | 'stop' | 'terminate' | 'show-output' | 'show-window' | 'logout' | 'uninstall' | 'quit'
  export interface ShellState { platform: string; loggedIn: boolean; phase: LiveState['phase']; sessionName?: string; canStart: boolean }
  export function appMenuTemplate(s: ShellState, run: (c: AppCommand) => void): MenuItemConstructorOptions[]
  export function trayMenuTemplate(s: ShellState, run: (c: AppCommand) => void): MenuItemConstructorOptions[]
  export function notificationFor(prev: LiveState, next: LiveState): { title: string; body: string } | null
  ```
  - App menu: macOS app menu (« À propos de LinTO Live », « Désinstaller LinTO Live… », Masquer, Quitter ⌘Q) ; « Session » : Nouvelle session… ⌘N, Démarrer ⌘↩ (`CmdOrCtrl+Return`, enabled `canStart && phase==='idle'`), Arrêter ⌘. (`CmdOrCtrl+.`, enabled when live), Terminer la session… (enabled when live) ; « Fenêtre » : Afficher la fenêtre de sortie ⌘1 (enabled when live), Afficher LinTO Live ⌘0, standard minimize/zoom ; « Compte » : Se déconnecter (enabled when logged in). Linux: same groups, « Désinstaller » and « Quitter » under a « Fichier » menu.
  - Tray: icon template (live variant when `phase==='live'`), tooltip « LinTO Live — en direct : X » / « LinTO Live » ; menu: disabled status line, Démarrer/Arrêter, Afficher la fenêtre de sortie, Afficher LinTO Live, separator, Quitter. Linux: create only if `Tray` construction succeeds.
  - `notificationFor`: `stream` `active`→`error` « Le son n'arrive plus à LinTO » ; `captions` `live`→`offline` « Sous-titres interrompus » ; `obs` `running`→`restarting` « OBS redémarre » ; otherwise null. Also notify on the `auth-required` event (« Connexion LinTO expirée »). Shown via `new Notification(...)` only when the main window is not focused.
  - Commands: main handles `stop`, `show-output`, `show-window`, `uninstall` (extract the existing uninstall handler body into a function), `quit`; `new-session`, `start`, `terminate`, `logout` are forwarded to the renderer as `IPC.evtCommand = 'evt:command'` (`on('command', cb: (c: AppCommand) => void)`), handled by `MainWindow`/`App` exactly like the matching buttons. Renderer reports `{ loggedIn, sessionName, canStart }` via `IPC.shellState = 'shell:state'` (`app.reportShellState(s)`) so menus enable correctly; main rebuilds menu and tray on every change of that and of `LiveState.phase`.
  - Close behaviour (`QuitGuard.onWindowClose`): while `phase` is `live`/`starting` the close is prevented and the window **hidden** (show continues); otherwise v1 behaviour. Quitting (⌘Q, tray, menu) keeps the v1 confirmation while live. macOS `activate` (Dock click) shows the window.
- [ ] **Step 1: Write failing tests**: menu enablement per state (idle without session: Démarrer disabled; live: Arrêter/Terminer/Afficher la fenêtre enabled, Démarrer disabled); accelerators exactly `CmdOrCtrl+N`, `CmdOrCtrl+Return`, `CmdOrCtrl+.`, `CmdOrCtrl+1`, `CmdOrCtrl+0`; clicking an item calls `run` with its command; tray template variants; each `notificationFor` transition and a no-op transition; quit guard hides instead of closing while live; renderer handles `command:'start'` like the Démarrer button and `command:'new-session'` opens the sheet.
- [ ] **Step 2: Run** `npx vitest run tests/nativeShell.test.ts tests/appLifecycle.test.ts tests/renderer` — Expected: FAIL.
- [ ] **Step 3: Implement** and wire in `main.ts`.
- [ ] **Step 4: Run** `npm test && npm run typecheck && env -u ELECTRON_RUN_AS_NODE npm run build` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: menus, icône de barre des menus, notifications, fermeture sans couper le direct"`

---

### Final verification (controller, not a subagent task)

- Run the real app (`env -u ELECTRON_RUN_AS_NODE npm run dev`), log in with the test token path or credentials, capture each screen (login, main idle, main live) in light and dark (`screencapture -l <windowid>`), and show them to Camille.
- Overlay: run a live show with `say`-generated audio routed to the selected input (or `spikes/stream-to-linto.mjs` with `SPIKE_AUDIO_FILE`) and capture the OBS output window; compare with the LinTO public session page.
- Projector: opens on Démarrer, stays in place across Arrêter/Démarrer, ⌘1 reopens; check OBS's right-click menu on the projector for a « Plein écran » entry on OBS 32.1 macOS and record the result in `docs/linux-build.md`'s checklist for Linux.
- `npm run dist:mac` builds; packaging tests pass.
