# Fenêtre « sous-titres seuls » — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** un bouton de la barre d'outils ouvre/ferme une fenêtre sans cadre, toujours au premier plan, qui ne montre que la bande de sous-titres.

**Architecture:** la fenêtre est une `BrowserWindow` Electron qui charge la page de sous-titres déjà servie par `OverlayServer` (même jeton, même WebSocket que la source navigateur d'OBS), avec `&mode=window`. Dans ce mode la page abandonne la toile 1920×1080 et se cale sur la fenêtre. Un petit module principal (`subtitlesWindow.ts`) gère bascule, bornes et état ; le renderer reçoit l'état par un nouvel événement IPC.

**Tech Stack:** Electron 45, TypeScript, React 19, page ESM sans dépendance, Vitest (+ Testing Library, jsdom).

**Spec:** `docs/superpowers/specs/2026-11-20-fenetre-sous-titres-design.md`

## Global Constraints

- Textes d'interface en français, accents et typographie du projet (« … », apostrophe ’ comme ailleurs dans l'UI).
- Libellés exacts du bouton : « Afficher la fenêtre de sous-titres » (fermée) / « Fermer la fenêtre de sous-titres » (ouverte), `aria-pressed` reflète l'état.
- Taille par défaut 960 × 120, centrée horizontalement en bas de la zone de travail de l'écran principal (marge basse 48 px) ; taille minimale 320 × 60.
- Police en mode fenêtre = hauteur de la fenêtre / 2,4 (2 lignes à 1,2 × la police) ; le réglage de police de l'appli est ignoré dans ce mode.
- Pas de QR code dans la fenêtre ; le watermark suit la session comme à l'antenne ; fond noir même sans sous-titre.
- La fenêtre : `frame: false`, toujours au premier plan, pas dans la barre des tâches, pas de preload, `sandbox: true`, `contextIsolation: true`, navigation verrouillée (`lockNavigation`).
- Commits en français, style conventionnel du dépôt, sans ligne co-auteur.

## Review Focus

1. **Redimensionnement en direct** : agrandir/rétrécir la fenêtre pendant une phrase doit recaler police et coupures sans perdre le texte affiché (`model.setFits` au `resize`).
2. **Écran débranché** : bornes mémorisées sur un écran disparu → la fenêtre revient sur un écran visible (test dans la tâche 2).
3. **Fermeture par la croix / Échap** : le bouton repasse à « Afficher… » (événement `subtitles-window` émis sur `closed`, test dans la tâche 2).
4. **Serveur pas prêt** : cliquer avant le démarrage du serveur de sous-titres donne un message d'erreur, pas un échec silencieux (test dans la tâche 2 et la tâche 3).
5. **Mode OBS inchangé** : sans `mode=window`, la page garde exactement la toile 1920×1080 et le réglage de police (test de non-régression dans la tâche 1).

---

### Task 1: mode « fenêtre » de la page de sous-titres

**Files:**
- Modify: `src/main/overlay/page/layout.js`, `src/main/overlay/page/layout.d.ts`
- Modify: `src/main/overlay/page/overlay.js`, `src/main/overlay/page/overlay.css`, `src/main/overlay/page/index.html`
- Test: `tests/overlay/layout.test.ts`

**Interfaces:**
- Produces: `windowMetrics(width: number, height: number): { fontSize: number; lineWidth: number }` exporté par `layout.js`. Page : `?k=<jeton>&mode=window` active le mode.

- [ ] **Step 1: tests qui échouent** dans `tests/overlay/layout.test.ts` :

```ts
describe('windowMetrics', () => {
  it('police = hauteur / 2,4, largeur utile = largeur − 2 × marge (0,5 × police)', () => {
    expect(windowMetrics(960, 120)).toEqual({ fontSize: 50, lineWidth: 910 })
  })
  it('suit le redimensionnement', () => {
    expect(windowMetrics(1200, 240)).toEqual({ fontSize: 100, lineWidth: 1100 })
  })
  it('ne descend jamais sous 1 px de largeur utile', () => {
    expect(windowMetrics(10, 240).lineWidth).toBe(1)
  })
})
```

- [ ] **Step 2:** `npx vitest run tests/overlay/layout.test.ts` → FAIL (`windowMetrics` non exporté).
- [ ] **Step 3: implémenter** `windowMetrics` dans `layout.js` (marge horizontale = 0,5 × police de chaque côté, `lineWidth = max(1, width − fontSize)`), déclarer dans `layout.d.ts`.
- [ ] **Step 4: brancher le mode dans la page.**
  - `overlay.js` : `const windowMode = params.get('mode') === 'window'`. En mode fenêtre : `document.body.classList.add('window')` ; `fitsAt` mesure contre `lineWidth` de `windowMetrics(innerWidth, innerHeight)` au lieu de `WIDTH` ; `--fs` posé depuis `fontSize` de `windowMetrics` ; sur `resize`, recalcul + `model.setFits(...)` + `render()` ; `applyStyle` ignore `fontSize` et n'appelle pas `applyQr` ; Échap et la croix appellent `window.close()`.
  - `index.html` : `<button id="close" aria-label="Fermer" hidden>×</button>` (visible seulement en mode fenêtre).
  - `overlay.css`, règles sous `body.window` uniquement : `html, body` en `100vw × 100vh` sur fond `#000` ; `-webkit-app-region: drag` et `user-select: none` sur `body` ; `#band` en `height: 100vh`, `padding: 0 calc(0.5 * var(--fs))` ; `#close` en `-webkit-app-region: no-drag`, coin haut droit, opacité 0 → 1 au survol de `body`.
  - Hors mode fenêtre, rien ne change (constante `WIDTH`, réglage de police, QR).
- [ ] **Step 5:** `npx vitest run tests/overlay` → PASS (y compris les tests existants, non-régression du mode OBS).
- [ ] **Step 6: commit** `feat(overlay): mode fenêtre de la page de sous-titres, calé sur la taille de la fenêtre`

### Task 2: la fenêtre côté principal + IPC

**Files:**
- Create: `src/main/subtitlesWindow.ts`
- Modify: `src/main/live.ts` (getter), `src/shared/types.ts` (`subtitlesWindowBounds?: Bounds` dans `Settings`), `src/shared/ipc.ts`, `src/main/main.ts`
- Test: `tests/subtitlesWindow.test.ts`, `tests/ipc.test.ts`, `tests/live.test.ts`

**Interfaces:**
- Consumes: `restoreBounds` (`src/main/appLifecycle.ts`), `lockNavigation` (`src/main/security.ts`), page `&mode=window` (tâche 1).
- Produces :
  - `Live.overlayPageUrl(): string | null` — l'URL renvoyée par `overlay.start()`, `null` avant.
  - `SUBTITLES_WINDOW_SIZE = { width: 960, height: 120, minWidth: 320, minHeight: 60 } as const`
  - `subtitlesWindowUrl(overlayUrl: string): string` — ajoute `mode=window` aux paramètres (garde `k`).
  - `subtitlesWindowBounds(saved: Bounds | undefined, displays: Bounds[], primary: Bounds): Bounds` — `restoreBounds` ; sans position, centrée en bas de `primary` (marge 48 px).
  - `interface SubtitlesWindowHost { open(url: string, bounds: Bounds): { close(): void; onClosed(cb: () => void): void; bounds(): Bounds } }`
  - `class SubtitlesWindow { constructor(o: { host: SubtitlesWindowHost; url(): string | null; bounds(): Bounds; saveBounds(b: Bounds): void; onChange(open: boolean): void }); toggle(): boolean; isOpen(): boolean; close(): void }` — `toggle` lève `Error('Les sous-titres ne sont pas encore prêts.')` quand `url()` est `null`.
  - IPC : `IPC.subtitlesToggle = 'subtitles:toggle'`, `IPC.subtitlesIsOpen = 'subtitles:is-open'`, `IPC.evtSubtitlesWindow = 'evt:subtitles-window'` ; événement `'subtitles-window'` (`cb: (open: boolean) => void`) ; API `subtitles: { toggle(): Promise<boolean>; isOpen(): Promise<boolean> }`.

- [ ] **Step 1: tests qui échouent** dans `tests/subtitlesWindow.test.ts` (hôte factice qui enregistre `open`/`close` et permet de déclencher `closed`) :
  - `subtitlesWindowUrl('http://127.0.0.1:5000/?k=abc')` → `'http://127.0.0.1:5000/?k=abc&mode=window'`.
  - `subtitlesWindowBounds(undefined, [d], d)` avec `d = { x: 0, y: 25, width: 1920, height: 1055 }` → `{ x: 480, y: 912, width: 960, height: 120 }`.
  - bornes mémorisées visibles → renvoyées telles quelles ; bornes sur un écran absent (`x: 5000`) → la valeur par défaut ci-dessus.
  - `toggle()` ouvre (renvoie `true`, `onChange(true)`), un second `toggle()` ferme (`false`, `saveBounds` appelé avec les bornes de la fenêtre, `onChange(false)`).
  - fermeture par la fenêtre elle-même (`closed` déclenché par l'hôte) → `isOpen()` faux, `saveBounds` puis `onChange(false)`.
  - `url()` renvoie `null` → `toggle()` lève « Les sous-titres ne sont pas encore prêts. » et n'ouvre rien.
  - `tests/ipc.test.ts` : ajouter les trois clés à la liste attendue, et `api.subtitles.toggle()` / `isOpen()` invoquent leurs canaux.
  - `tests/live.test.ts` : `overlayPageUrl()` vaut `null` avant le démarrage, puis l'URL du faux `overlay.start()`.
- [ ] **Step 2:** `npx vitest run tests/subtitlesWindow.test.ts tests/ipc.test.ts tests/live.test.ts` → FAIL.
- [ ] **Step 3: implémenter** `subtitlesWindow.ts`, le getter de `Live`, les canaux, l'événement, l'API dans `ipc.ts` et le pont (preload passe par `createLintoLiveApi`, rien d'autre à toucher).
- [ ] **Step 4: brancher dans `main.ts`.** Hôte réel : `new BrowserWindow({ ...bounds, minWidth, minHeight, frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: true, fullscreenable: false, backgroundColor: '#000000', title: 'LinTO Live — sous-titres', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })`, puis `setAlwaysOnTop(true, 'floating')` et, sur macOS, `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` ; `lockNavigation(w.webContents, url)` ; `loadURL(url)`. `bounds()` lit `settings.get().subtitlesWindowBounds` via `subtitlesWindowBounds(…, screen.getAllDisplays().map(d => d.workArea), screen.getPrimaryDisplay().workArea)` ; `saveBounds` écrit `subtitlesWindowBounds` ; `onChange` → `send(IPC.evtSubtitlesWindow, open)`. Handlers `ipcMain.handle(IPC.subtitlesToggle, …)` et `IPC.subtitlesIsOpen`. Fermer la fenêtre de sous-titres à l'arrêt de l'appli (là où `win` est détruite / dans la séquence de sortie).
- [ ] **Step 5:** `npx vitest run && npm run typecheck` → PASS.
- [ ] **Step 6: commit** `feat: fenêtre de sous-titres sans cadre, toujours au premier plan, bornes mémorisées`

### Task 3: bouton dans la barre d'outils + documentation

**Files:**
- Modify: `src/renderer/main/Toolbar.tsx`, `src/renderer/screens/MainWindow.tsx`, `tests/renderer/helpers.ts`
- Modify: `README.md` (section Linux/Wayland), `CHANGELOG.md` (entrée « Non publié »)
- Test: `tests/renderer/mainWindow.test.tsx`

**Interfaces:**
- Consumes: `window.lintoLive.subtitles.toggle/isOpen`, événement `'subtitles-window'` (tâche 2), `CaptionsIcon` (`src/renderer/ui/icons.tsx`).
- Produces: `ToolbarProps` gagne `subtitlesOpen: boolean` et `onToggleSubtitles(): void`.

- [ ] **Step 1: tests qui échouent** dans `tests/renderer/mainWindow.test.tsx` (ajouter `subtitles: { toggle, isOpen }` au faux API de `helpers.ts`, `isOpen` résolu à `false`) :
  - le bouton « Afficher la fenêtre de sous-titres » est présent hors antenne **et** à l'antenne, juste après « Afficher la fenêtre de sortie » dans l'ordre du DOM, `aria-pressed="false"`.
  - un clic appelle `subtitles.toggle` une fois.
  - l'événement `'subtitles-window'` à `true` → le bouton s'appelle « Fermer la fenêtre de sous-titres », `aria-pressed="true"` ; à `false` → retour à « Afficher… ».
  - `toggle` rejeté avec « Les sous-titres ne sont pas encore prêts. » → ce message s'affiche comme les autres erreurs (`setError(ipcErrorMessage(e))`).
- [ ] **Step 2:** `npx vitest run tests/renderer/mainWindow.test.tsx` → FAIL.
- [ ] **Step 3: implémenter.** `Toolbar.tsx` : un `subtitlesButton` (`size="large"`, `className="btn-icon"`, `icon={<CaptionsIcon />}`, `aria-pressed`, `aria-label`/`title` selon l'état) rendu juste après `{outputButton}` dans les deux branches. `MainWindow.tsx` : état `subtitlesOpen` initialisé par `subtitles.isOpen()` et mis à jour par `on('subtitles-window', …)` (désabonnement au démontage), `onToggleSubtitles` → `subtitles.toggle().catch((e) => setError(ipcErrorMessage(e)))`.
- [ ] **Step 4: docs.** README : une ligne sur la fenêtre de sous-titres et, dans la partie Wayland, « sous GNOME/Wayland, le premier plan ne peut pas être imposé par l'appli : clic droit sur la fenêtre → Toujours au premier plan ». CHANGELOG : entrée sous « Non publié ».
- [ ] **Step 5:** `npx vitest run && npm run typecheck` → PASS.
- [ ] **Step 6: commit** `feat(ui): bouton « fenêtre de sous-titres » à côté de la fenêtre de sortie`
