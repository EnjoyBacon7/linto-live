# LinTO Live v0.4 — langues, QR code, source de secours, enregistrement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-language subtitles + session visibility at creation, a QR code in the video output, a primary/backup video source with black-screen fallback, and recording of the full output to disk.

**Architecture:** Everything stays in the existing layers: LinTO calls in `src/main/linto/`, OBS requests in `src/main/obs/controller.ts`, orchestration in `LiveController` (`src/main/live.ts`), overlay drawing in the OBS browser-source page (`src/main/overlay/page/`), UI in `src/renderer/main/`. New logic that can be pure (language routing, fallback decision) lives in its own small module with unit tests and is injected into `LiveController`.

**Tech Stack:** Electron 45, React 19, TypeScript, vitest (+ @testing-library/react), obs-websocket-js v5 (OBS 32.1), socket.io-client, new dependency `qrcode` (MIT).

**Spec:** `docs/superpowers/specs/2026-11-13-langues-qr-sources-enregistrement-design.md` — read it first; this plan argues from it.

## Global Constraints

- All UI copy in French; reuse `PopUp`, `Sheet`, `Button`, `TextField` and the Inspector's `Check` (export it from `Inspector.tsx` if another file needs it).
- LinTO Studio is AGPL: reimplement behaviour, never copy its files.
- OBS is driven only through obs-websocket v5; macOS arm64 + Linux x86_64 (deb, Flatpak, AppImage).
- Every main-process change is covered by vitest with the existing fakes (`fakeClient` in `tests/obs/controller.test.ts`, `fakeController`/deps in `tests/live.test.ts`, fetch fakes in `tests/linto/api.test.ts`).
- Fast checks before every commit: `npm run typecheck && npm test`.
- Commits: conventional, French or English like the history, **no co-author line**.
- Delivery order = task order; each part (1–4) is shippable alone.

## Review Focus

1. **Switching displayed language mid-show** must not leave the band mixing two languages: the band is reset and only events of the new language get through (Task 3 test `switching language resets the band`).
2. **ATEM black is limited-range (~16/255), not 0**: the black test must classify a uniform 16/255 frame as black and a dark-but-real scene (mean ≈ 0.12, max ≈ 0.6) as present (Task 9 tests).
3. **Fallback flicker**: alternating present/absent probes faster than 2 s never toggles the backup (Task 9 test `no toggle on alternating probes`).
4. **OBS restart during a recorded show** resumes recording in a new file, and the fallback monitor stops on drop and restarts on attach (Task 10 and Task 13 tests).
5. **Password visibility with an empty password** cannot be submitted (Task 4 test `password visibility needs a password`).

---

## Part 1 — Langues et visibilité

### Task 1: LinTO API — translations, visibility, password

**Files:**
- Modify: `src/shared/types.ts`, `src/main/linto/api.ts`, `src/main/linto/sessionResolver.ts`
- Test: `tests/linto/api.test.ts`, `tests/linto/sessionResolver.test.ts`

**Interfaces:**
- Produces (in `src/shared/types.ts`):
  - `export type SessionVisibility = 'private' | 'organization' | 'public'`
  - `Channel` gains `languages?: string[]` (spoken, e.g. `['fr-FR','en-US']`) and `translations?: string[]` (target codes; objects `{target}` normalised to `target`).
  - `Session` gains `visibility?: SessionVisibility`.
  - `TranscriberProfile` gains `translations?: string[]` = normalised `config.availableTranslations` (array as-is; object form → `discrete ∪ external[].languages`, deduplicated).
  - `export interface NewSessionOptions { translations: string[]; visibility: SessionVisibility | 'password'; password?: string }`
- Produces (api): `createSession(orgId: string, name: string, profileId: number, opts?: NewSessionOptions): Promise<Session>` — body as today plus `channels[0].translations = opts.translations`, `visibility = opts.visibility === 'password' ? 'public' : opts.visibility` (default `'organization'`), top-level `password = opts.visibility === 'password' ? opts.password : null`.
- Produces (resolver): `resolveSession(api, orgId, rawName, profileId, opts?: NewSessionOptions)` — `opts` forwarded to `createSession` only.

- [ ] **Step 1: Write failing tests** in `tests/linto/api.test.ts`:
  - `transcriberProfiles normalises availableTranslations` — profile with `config.availableTranslations: { discrete: ['en'], external: [{ languages: ['de','en'] }] }` → `translations` equals `['en','de']`; array form `['es']` → `['es']`; absent → `translations` undefined.
  - `createSession sends translations, visibility and password` — with `{ translations: ['en','de'], visibility: 'password', password: 'x' }` the POST body has `channels[0].translations` `['en','de']`, `visibility` `'public'`, `password` `'x'`; with no opts: `translations` `[]`, `visibility` `'organization'`, `password` `null`.
  - `toSession reads visibility, channel languages and translations` — `getSession` response with `visibility: 'public'`, channel `languages: ['fr-FR']`, `translations: [{ target: 'en' }, 'de']` → `visibility 'public'`, `languages ['fr-FR']`, `translations ['en','de']`.
  - In `sessionResolver.test.ts`: `resolveSession forwards create options` — the fake `createSession` receives the opts as 4th argument.
- [ ] **Step 2: Run** `npx vitest run tests/linto` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the types and the three API changes (`toChannel`, `toSession`, `transcriberProfiles`, `createSession`) and the resolver pass-through.
- [ ] **Step 4: Run** `npx vitest run tests/linto && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(linto): traductions, visibilité et mot de passe à la création de session`

### Task 2: Captions — `translation` events and language routing

**Files:**
- Create: `src/shared/subtitleLanguage.ts`
- Modify: `src/main/linto/captions.ts`
- Test: `tests/linto/captions.test.ts`, create `tests/subtitleLanguage.test.ts`

**Interfaces:**
- Produces (captions.ts): `export interface TranslationEvent { segmentId: number; text: string; sourceLang?: string | null; targetLang: string; final: boolean; astart?: string | null; start?: number | null; end?: number | null; locutor?: string | null }`; `CaptionStream` emits `'translation'` with it (socket event `translation`, same room). `LiveCaptions.on` in `live.ts` accepts `'translation'`.
- Produces (subtitleLanguage.ts):
  - `export const ORIGINAL = 'original'`, `export const CROSS = 'crossSubtitles'`
  - `export interface SubtitleLanguageOption { value: string; label: string }`
  - `subtitleLanguageOptions(channel: Pick<Channel,'languages'|'translations'>, locale = 'fr'): SubtitleLanguageOption[]` — `[{original,'Langue originale'}, ({crossSubtitles,'Sous-titres croisés'} if qualified), ...translations sorted by label]`, label via `Intl.DisplayNames([locale], { type: 'language' })` with the code as fallback, first letter upper-cased.
  - `isQualifiedForCrossSubtitles(languages: string[] | undefined, translations: string[] | undefined): boolean` — exactly 2 spoken languages and a translation whose base code (`split('-')[0]`) matches each.
  - `export type Routed = { kind: 'partial' | 'final'; text: string } | null`
  - `routeOriginal(choice: string, final: boolean, text: string): Routed` — passes only when `choice === ORIGINAL`.
  - `routeTranslation(choice: string, channelLanguages: string[] | undefined, e: TranslationEvent): Routed` — `choice === e.targetLang` passes; `choice === CROSS` passes when `base(e.targetLang) !== base(e.sourceLang)` and `base(e.targetLang)` is a base of a channel language; otherwise null. `kind` from `e.final`.

- [ ] **Step 1: Write failing tests** in `tests/subtitleLanguage.test.ts`:
  - options for `{ languages: ['fr-FR','en-US'], translations: ['en','fr','de'] }` → values `['original','crossSubtitles', …]` with the three translations sorted by French label (`Allemand`, `Anglais`, `Français`).
  - no cross option for `{ languages: ['fr-FR'], translations: ['en'] }`.
  - `routeOriginal('original', true, 'a')` → `{kind:'final',text:'a'}`; `routeOriginal('en', …)` → null.
  - `routeTranslation('en', …, {targetLang:'en', final:false, text:'b'})` → `{kind:'partial',text:'b'}`; `'de'` choice → null.
  - cross: source `fr-FR` target `en` → passes; source `en-US` target `en` → null; source `en-US` target `fr` → passes; target `de` (not a channel language) → null.
  - In `tests/linto/captions.test.ts`: `forwards translation events` — fake socket emits `translation` with a payload; stream emits `'translation'` with the same object.
- [ ] **Step 2: Run** `npx vitest run tests/subtitleLanguage.test.ts tests/linto/captions.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the module and the `socket.on('translation', …)` line.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(captions): événements de traduction et choix de la langue affichée`

### Task 3: LiveController — displayed language, start with create options

**Files:**
- Modify: `src/shared/types.ts` (Settings, SessionSummary), `src/shared/ipc.ts`, `src/main/live.ts`, `src/main/main.ts`, `src/main/preload.ts` (if it lists methods), `src/main/setupData.ts` (only if SessionSummary is built there; otherwise where `sessionsList` builds summaries in `main.ts`)
- Test: `tests/live.test.ts`, `tests/ipc.test.ts`

**Interfaces:**
- Consumes: Task 1 types, Task 2 `routeOriginal`, `routeTranslation`, `subtitleLanguageOptions`, `ORIGINAL`.
- Produces:
  - `Settings.subtitleLanguages?: Record<string, string>` (session id → choice; absent = `ORIGINAL`).
  - `SessionSummary` gains `visibility?: SessionVisibility` and `languages: SubtitleLanguageOption[]` (from `channels[0]`, via `subtitleLanguageOptions`).
  - `LiveController.start(sessionName: string, create?: NewSessionOptions): Promise<StartResult>` → `resolveSession(..., s.profileId, create)`.
  - `LiveController.setSubtitleLanguage(sessionId: string, choice: string): Promise<void>` — saves in `subtitleLanguages`; if that session is on air: `overlay.push({type:'reset'})` and the new choice applies to the next events.
  - IPC: `live.start(sessionName: string, create?: NewSessionOptions)`, `live.setSubtitleLanguage(sessionId: string, choice: string): Promise<void>`. Validate `create` in `main.ts` (`translations` string array, `visibility` one of the four, `password` string when `'password'`), reject otherwise.
  - Captions wiring: `partial`/`final` → overlay only if `routeOriginal(choice, …)` passes; **transcript always gets originals** (unchanged). `translation` → overlay only if `routeTranslation(choice, current.channel.languages, e)` passes.

- [ ] **Step 1: Write failing tests** in `tests/live.test.ts`:
  - `translation choice sends only that language to the overlay` — settings `subtitleLanguages: { [id]: 'en' }`; captions emit `final` (fr) and `translation` (target `en`, final) → overlay got only the `en` text; transcript still has the fr final.
  - `switching language resets the band` — on air with `original`; `setSubtitleLanguage(id,'en')` → overlay receives `{type:'reset'}`, then a `final` original is not pushed, a `translation` en is.
  - `start passes create options to createSession` — fake api `createSession` receives `{ translations:['en'], visibility:'public' }`.
  - In `tests/ipc.test.ts` (follow its existing pattern): `live.start` with an invalid `create` (`visibility: 'x'`) is rejected.
- [ ] **Step 2: Run** `npx vitest run tests/live.test.ts tests/ipc.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** as in Interfaces. Current choice: `this.d.settings.get().subtitleLanguages?.[this.current.session.id] ?? ORIGINAL`.
- [ ] **Step 4: Run** `npm run typecheck && npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(live): langue des sous-titres incrustés par session`

### Task 4: UI — Nouvelle session (traductions, visibilité) and « Langue affichée »

**Files:**
- Modify: `src/renderer/main/NewSessionSheet.tsx`, `src/renderer/screens/MainWindow.tsx`, `src/renderer/main/Inspector.tsx`, `src/renderer/main/mainWindow.css`
- Test: `tests/renderer/mainWindow.test.tsx` (and `tests/renderer/helpers.ts` fakes)

**Interfaces:**
- Consumes: `TranscriberProfile.translations`, `NewSessionOptions`, `SessionSummary.languages/visibility`, IPC from Task 3.
- Produces:
  - `NewSessionSheetProps.onSubmit(name: string, profileId: number | undefined, opts: NewSessionOptions): void`.
  - `Selection.pending` becomes `{ profileId?: number; create: NewSessionOptions }`; `startSession` calls `live.start(target.name, target.pending?.create)`.
  - `InspectorProps` gains `languages?: SubtitleLanguageOption[]`, `language?: string`, `onLanguageChange?(v: string): void`.
- Sheet contents (French copy fixed by the spec):
  - « Traductions » : one `Check` per `profile.translations` (label from `subtitleLanguageOptions`’ labelling, i.e. export a `languageLabel(code, locale='fr')` helper from `subtitleLanguage.ts`), none ticked by default, section hidden when the profile has none; reset when the profile changes.
  - « Visibilité » `PopUp`: `organization` « Organisation » (default), `public` « Public », `password` « Protégée par mot de passe », `private` « Privée ». With `password`, a `TextField` « Mot de passe » (type password); OK disabled while it is blank.
- Inspector, Sous-titres group, first control: `PopUp` « Langue affichée » with `languages`; disabled when there is no existing session selected (pending session: show « Originale » disabled + note « Réglable une fois la session créée sur LinTO (au démarrage). » — same as the watermark).

- [ ] **Step 1: Write failing tests** in `tests/renderer/mainWindow.test.tsx`:
  - `new session sends translations and visibility on Démarrer` — profile with `translations: ['en','de']`; tick Anglais, choose Public, OK, Démarrer → fake `live.start` called with `(name, { translations: ['en'], visibility: 'public' })`.
  - `password visibility needs a password` — choose « Protégée par mot de passe »: OK disabled; type `x`: enabled; start → `{ visibility: 'password', password: 'x', translations: [] }`.
  - `Langue affichée lists the session languages and saves the choice` — summary with `languages` [original, en]; pick Anglais → fake `live.setSubtitleLanguage(id, 'en')`.
- [ ] **Step 2: Run** `npx vitest run tests/renderer` — Expected: FAIL.
- [ ] **Step 3: Implement.** The selected choice shown = `settings.subtitleLanguages?.[summary.id] ?? 'original'`; update local settings optimistically like `saveSettings`.
- [ ] **Step 4: Run** `npm run typecheck && npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): traductions et visibilité à la création, langue affichée`

---

## Part 2 — QR code

### Task 5: Overlay page draws a QR code on its own cycle

**Files:**
- Modify: `package.json` (dependency `qrcode`, devDependency `@types/qrcode`), `src/main/overlay/server.ts`, `src/main/overlay/page/index.html`, `src/main/overlay/page/overlay.js`, `src/main/overlay/page/overlay.css`
- Test: create `tests/overlay/server.test.ts` (or extend an existing overlay test if one covers the server)

**Interfaces:**
- Produces: `OverlayStyle.qr: { svg: string; display: boolean; pinned: boolean; frequency: number; duration: number } | null`.
- Page: `<div id="qr" hidden>` top-right, **240 px** square SVG on white with a 16 px white margin, 40 px from the top and right edges, fade 300 ms (`opacity` transition); a second `WatermarkCycle` instance drives `qr.classList.toggle('is-shown', v)`; shown independently of `bandVisible`. Set `innerHTML` only when `svg` changed. `qr: null` hides it and clears the cycle (`cycle.update({display:false})`).

- [ ] **Step 1: Write failing test** `overlay server replays the last style with qr to new clients` — start server, `push({type:'style', visible:true, fontSize:48, watermark:…, qr:{svg:'<svg/>',display:true,pinned:true,frequency:60,duration:15}})`, connect a `ws` client with the token → first message parsed has `qr.svg === '<svg/>'`.
- [ ] **Step 2: Run** `npx vitest run tests/overlay` — Expected: FAIL (type / missing field).
- [ ] **Step 3: Implement** the type, page markup, CSS and `applyStyle` handling. `npm install qrcode @types/qrcode`.
- [ ] **Step 4: Check visually**: `npx tsx scripts/overlay-demo.ts` (extend it to push a `qr` with `QRCode.toString('https://example.org', { type: 'svg', margin: 0 })`) and open the printed URL — QR appears top-right, never over the band.
- [ ] **Step 5: Run** `npm run typecheck && npm test` — PASS. **Commit** `feat(overlay): QR code dans la sortie`

### Task 6: QR settings, public link, Inspector

**Files:**
- Create: `src/shared/publicLink.ts`, `src/renderer/main/QrSheet.tsx`
- Modify: `src/shared/types.ts`, `src/main/live.ts`, `src/renderer/main/Inspector.tsx`, `src/renderer/screens/MainWindow.tsx`
- Test: `tests/live.test.ts`, create `tests/publicLink.test.ts`, `tests/renderer/mainWindow.test.tsx`

**Interfaces:**
- Produces:
  - `Settings.qr?: { display: boolean; pinned: boolean; frequency: number; duration: number }`; `export const DEFAULT_QR = { display: false, pinned: false, frequency: 60, duration: 15 }`.
  - `publicLink(instance: string, orgId: string, sessionId: string): string` → `${instance}/interface/${orgId}/sessions/${sessionId}` (instance without trailing slash).
  - `LiveDeps.qrSvg: (url: string) => Promise<string>` (main.ts: `QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })`). `pushStyle` becomes async-safe: computes the SVG once per on-air session (cache by URL) and sends `qr: null` off air or when `!qr.display`.
  - `saveSettings` re-pushes style when `patch.qr` is set.
  - Inspector, Sous-titres group, after the watermark subgroup: `Check` « Afficher le QR code », `Check` « Épingler le QR code » (disabled unless the first is ticked), `Button` « Paramètres du QR code… » → `QrSheet` (frequency + duration fields, same validation as `WatermarkSheet`, title « Paramètres du QR code »). Shown even when the subtitle band is hidden (place it outside the `shown &&` block).
  - Note when `qr.display` and the selected summary’s `visibility` is not `'public'`: « Le public devra se connecter à LinTO pour ouvrir ce lien : rendre la session publique dans LinTO Studio. »

- [ ] **Step 1: Write failing tests:**
  - `publicLink` → `publicLink('https://studio.linto.ai','o1','s1') === 'https://studio.linto.ai/interface/o1/sessions/s1'`.
  - live: `qr is sent on air only when displayed` — settings `qr: {display:true,pinned:false,frequency:60,duration:15}`; before start the last style has `qr: null`; after start `qr.svg` is the fake’s output for the session’s link and `frequency 60`; after stop `qr: null`.
  - renderer: `QR note when the session is not public` — summary `visibility: 'organization'`, tick « Afficher le QR code » → note text visible; with `'public'` → absent.
- [ ] **Step 2: Run** `npx vitest run tests/publicLink.test.ts tests/live.test.ts tests/renderer` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run typecheck && npm test` — PASS.
- [ ] **Step 5: Commit** `feat: réglages du QR code et lien public de la session`

---

## Part 3 — Source principale et source de secours

### Task 7: Settings model for two sources

**Files:**
- Modify: `src/shared/types.ts`, `src/main/settings.ts`
- Test: `tests/settings.test.ts`

**Interfaces:**
- Produces:
  - `export type VideoSource = { kind: 'none' } | { kind: 'device'; id: string } | { kind: 'image' | 'video'; path: string }`
  - `Settings.primarySource?: VideoSource`, `Settings.backupSource?: VideoSource`, `Settings.blackIsAbsent?: boolean` (absent = true). `videoDeviceId` is removed from `Settings`.
  - Migration in `SettingsStore.load`: stored `videoDeviceId` non-empty and no `primarySource` → `primarySource = {kind:'device', id}`; `videoDeviceId` deleted (empty string → `{kind:'none'}`).

- [ ] **Step 1: Failing test** `migrates videoDeviceId to primarySource` (file with `videoDeviceId: 'cam1'` → `get().primarySource` `{kind:'device',id:'cam1'}`, no `videoDeviceId`).
- [ ] **Step 2: Run** `npx vitest run tests/settings.test.ts` — FAIL.
- [ ] **Step 3: Implement**; fix every `videoDeviceId` use the typechecker reports (live.ts, Inspector, tests) by mapping to `primarySource` — behaviour unchanged for now (Task 10 adds the backup).
- [ ] **Step 4: Run** `npm run typecheck && npm test` — PASS.
- [ ] **Step 5: Commit** `refactor(settings): source vidéo principale (migration de videoDeviceId)`

### Task 8: ObsController — two source slots, backup visibility, probe

**Files:**
- Modify: `src/main/obs/controller.ts`
- Test: `tests/obs/controller.test.ts` (extend `fakeClient` for `RemoveInput`, `SetSceneItemEnabled`, `SetSceneItemIndex`, `GetInputSettings`)

**Interfaces:**
- Produces:
  - `export const SRC_BACKUP = 'Secours'`, `export const SRC_DEVICES = 'Détection caméras'` (device-kind input created in `SCENE_PAUSE` with `sceneItemEnabled: false`, used only by `listVideoDevices`).
  - `setSource(slot: 'primary' | 'backup', src: VideoSource): Promise<void>` — input name `SRC_VIDEO` (primary) / `SRC_BACKUP`. Input kind: device → `videoKind(platform)` with `{[videoProp]: id}`; image → `image_source` `{file: path}`; video → `ffmpeg_source` `{local_file: path, is_local_file: true, looping: true, restart_on_activate: false}`; none → device kind with empty device. If the existing input’s kind differs (`GetInputSettings` → `inputKind`), `RemoveInput` then `CreateInput` in `SCENE`. Then mute + no audio tracks (as `ensureScene` does, `ignoreNoAudio`), scale transform 1920×1080 (`setVideoDevice`’s transform), and z-order: primary index 0, backup index 1, overlay top (`SetSceneItemIndex`). Backup is created with `sceneItemEnabled: false`. Cache scene item ids per input; `resetProjectorState` clears them.
  - `setBackupVisible(on: boolean): Promise<void>` — `SetSceneItemEnabled` on `SRC_BACKUP` in `SCENE`.
  - `probePrimary(): Promise<string>` — `GetSourceScreenshot { sourceName: SRC_VIDEO, imageFormat: 'png', imageWidth: 32 }` → `imageData`.
  - `listVideoDevices()` now reads from `SRC_DEVICES`. `setVideoDevice` is removed (replaced by `setSource('primary', …)`); update `LiveObsController` pick list in `live.ts`.

- [ ] **Step 1: Failing tests:**
  - `setSource image replaces a device input` — after `ensureScene`, `setSource('primary',{kind:'image',path:'/a.png'})` → calls include `RemoveInput {inputName:'Salle'}` then `CreateInput {inputKind:'image_source', inputSettings:{file:'/a.png'}}`.
  - `setSource keeps the input when the kind is the same` — device → device: only `SetInputSettings`.
  - `backup is created hidden and above the primary` — `setSource('backup',{kind:'video',path:'/b.mp4'})` → `CreateInput` with `sceneItemEnabled:false`, `ffmpeg_source`, `looping:true`; a `SetSceneItemIndex` for `Secours` with a higher index than `Salle`’s, overlay highest.
  - `setBackupVisible(true)` → `SetSceneItemEnabled {sceneName:'LinTO Live', sceneItemEnabled:true}` on the backup’s id.
  - `probePrimary` → `GetSourceScreenshot` with `sourceName:'Salle'`, `imageFormat:'png'`, `imageWidth:32`.
- [ ] **Step 2: Run** `npx vitest run tests/obs/controller.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run typecheck && npm test` — PASS. If OBS is available locally, also `npm run test:it` (extend `tests/integration/obs-controller.it.test.ts` with an image-source round trip).
- [ ] **Step 5: Commit** `feat(obs): sources principale et de secours`

### Task 9: FallbackMonitor (pure decision logic)

**Files:**
- Create: `src/main/obs/fallback.ts`
- Test: create `tests/obs/fallback.test.ts`

**Interfaces:**
- Produces:
  - `export interface Luma { mean: number; max: number }` (0..1, Rec.601 luma over all pixels).
  - `export function isBlack(l: Luma): boolean` — `l.mean < 0.1 && l.max < 0.2` (limited-range black ≈ 0.063 passes; tune only with a real ATEM capture and update the tests).
  - `export class FallbackMonitor` — `constructor(o: { probe(): Promise<string>; decode(dataUrl: string): Luma | null; setBackup(on: boolean): Promise<void>; blackIsAbsent: () => boolean; primaryIsFile: () => boolean; onChange?(onBackup: boolean): void; intervalMs?: number /*500*/; switchMs?: number /*2000*/; timers?: { setInterval; clearInterval } ; now?: () => number })`; `start(): void`; `stop(): void` (stops timer, does **not** touch visibility); `readonly onBackup: boolean`.
  - Absent = probe throws, `decode` returns null, or (`blackIsAbsent()` and `isBlack`). A file primary (`primaryIsFile()`) is absent only on probe/decode failure. Switch to backup after `switchMs` of continuous absence; back after `switchMs` of continuous presence. One probe in flight at a time (skip a tick while busy). `start()` begins with `onBackup = false` and calls `setBackup(false)` once.

- [ ] **Step 1: Failing tests** (fake timers / injected `now`):
  - `isBlack({mean:16/255,max:16/255})` true; `isBlack({mean:0.12,max:0.6})` false.
  - `switches to backup after 2 s of black` — probes black every 500 ms: no `setBackup(true)` at 1.5 s, called once by 2.0 s; `onChange(true)`.
  - `returns to primary after 2 s of picture`.
  - `no toggle on alternating probes` — black/picture alternating every 500 ms for 10 s → `setBackup(true)` never called.
  - `black is ignored when blackIsAbsent is false` — black frames for 5 s → stays on primary; probe rejections for 2 s → switches.
  - `file primary is never black-absent`.
- [ ] **Step 2: Run** `npx vitest run tests/obs/fallback.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(obs): bascule automatique sur la source de secours`

### Task 10: Wire sources and fallback into LiveController + main

**Files:**
- Modify: `src/main/live.ts`, `src/main/main.ts`, `src/shared/ipc.ts`, `src/shared/types.ts`
- Test: `tests/live.test.ts`, `tests/ipc.test.ts`

**Interfaces:**
- Consumes: Task 8 controller methods, Task 9 `FallbackMonitor`, `Luma`.
- Produces:
  - `LiveDeps.decodeLuma: (dataUrl: string) => Luma | null` — in `main.ts` via `nativeImage.createFromDataURL(dataUrl).toBitmap()` (BGRA) computing mean/max of `0.299R+0.587G+0.114B`/255; empty image → null.
  - `LiveState.videoOnAir?: 'primary' | 'backup'` (absent when no backup is configured).
  - `attach`: `setSource('primary', s.primarySource ?? {kind:'none'})`, `setSource('backup', s.backupSource ?? {kind:'none'})`, then start a `FallbackMonitor` when `backupSource` is not `none`; `dropController` stops it. `saveSettings` re-applies a changed source and starts/stops the monitor; `blackIsAbsent` is read live from settings.
  - IPC `setup.pickMedia(kind: 'image' | 'video'): Promise<string | null>` — `dialog.showOpenDialog` with filters images `png jpg jpeg gif bmp webp`, videos `mp4 mov mkv webm m4v`.
  - Flatpak: add `--filesystem=home` to `finishArgs` in `electron-builder.yml` (media files + recording folder).

- [ ] **Step 1: Failing tests** in `tests/live.test.ts` (extend `fakeController` with `setSource`, `setBackupVisible`, `probePrimary`; inject `decodeLuma`):
  - `applies both sources on attach` — settings with primary device + backup image → `setSource` called for both.
  - `monitor shows the backup when the primary goes black` — fake timers; `decodeLuma` returns black → after 2 s `setBackupVisible(true)` and state `videoOnAir 'backup'`.
  - `monitor stops on OBS restart and resumes on attach` — emit `restarting` then `ready`: no probes in between, probes again after.
  - `no monitor without backup` — `probePrimary` never called.
- [ ] **Step 2: Run** `npx vitest run tests/live.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run typecheck && npm test` — PASS.
- [ ] **Step 5: Commit** `feat(live): source de secours pilotée par l'état de la source principale`

### Task 11: UI — groupe « Vidéo »

**Files:**
- Modify: `src/renderer/main/Inspector.tsx`, `src/renderer/screens/MainWindow.tsx`, `src/renderer/main/mainWindow.css`
- Test: `tests/renderer/mainWindow.test.tsx`

**Interfaces:**
- Consumes: `VideoSource`, `setup.pickMedia`, `LiveState.videoOnAir`.
- Produces: group header « Vidéo » (CameraIcon) replacing « Caméra »:
  - `PopUp` « Source principale » and « Source de secours », options: `none` « Aucune », each device, then « Image… », « Vidéo… ». Picking Image/Vidéo calls `pickMedia`; cancelled → value unchanged; chosen → saved, and the menu shows an extra option with the file’s base name as the current value.
  - `Check` « Écran noir = source absente » (default ticked), disabled when backup is `none`.
  - Status line under it when `videoOnAir` is set: « À l’antenne : principale » / « À l’antenne : secours ».
  - Option values encoding (renderer only): `none`, `device:<id>`, `file:<path>`, `pick:image`, `pick:video`.

- [ ] **Step 1: Failing tests:** `choosing Image… stores an image source` (fake `pickMedia` → `/x/logo.png`; settings saved with `backupSource {kind:'image',path:'/x/logo.png'}`; menu shows `logo.png`); `cancelled picker keeps the previous source`; `on-air status shows secours` (state `videoOnAir:'backup'`).
- [ ] **Step 2: Run** `npx vitest run tests/renderer` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run typecheck && npm test` — PASS.
- [ ] **Step 5: Commit** `feat(ui): sources vidéo principale et de secours`

---

## Part 4 — Enregistrement

### Task 12: ObsController — recording

**Files:**
- Modify: `src/main/obs/controller.ts`, `src/main/obs/seed.ts`
- Test: `tests/obs/controller.test.ts`, `tests/obs/seed.test.ts`

**Interfaces:**
- Produces:
  - Seed `basic.ini` `[SimpleOutput]` gains `RecFormat2=mkv`, `RecQuality=Stream` (same encoder as the stream).
  - `startRecord(dir: string, baseName: string): Promise<void>` — `SetRecordDirectory {recordDirectory: dir}`, `SetProfileParameter {parameterCategory:'Output', parameterName:'FilenameFormatting', parameterValue: baseName + ' %CCYY-%MM-%DD %hh-%mm-%ss'}`, `StartRecord`.
  - `stopRecord(): Promise<string | null>` — `StopRecord` → `outputPath`; `OUTPUT_NOT_RUNNING` → null.
  - `recordState$(cb: (s: { active: boolean; path?: string }) => void): () => void` — from `RecordStateChanged` (`outputActive`, `outputPath`).
  - `export function recordBaseName(sessionName: string): string` — replaces `/ \ : * ? " < > |` and control chars with `-`, trims, max 100 chars, `'LinTO Live'` if empty.

- [ ] **Step 1: Failing tests:** `startRecord sets directory, filename and starts` (calls in that order with exact params); `stopRecord returns the path` / `null when not running`; `recordBaseName('A/B: C?')` → `'A-B- C-'`; seed test: `basic.ini` contains `RecFormat2=mkv`.
- [ ] **Step 2: Run** `npx vitest run tests/obs` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(obs): enregistrement MKV de la sortie`

### Task 13: LiveController — record with the show

**Files:**
- Modify: `src/main/live.ts`, `src/shared/types.ts`, `src/shared/ipc.ts`, `src/main/main.ts`, `src/main/nativeShell.ts`
- Test: `tests/live.test.ts`, `tests/nativeShell.test.ts`

**Interfaces:**
- Consumes: Task 12.
- Produces:
  - `Settings.recordEnabled?: boolean` (default false), `Settings.recordDir?: string` (default `join(app.getPath('videos'), 'LinTO Live')`, created with `mkdir -p` before recording; `LiveDeps.defaultRecordDir: string`).
  - `LiveState.recording: 'off' | 'on' | 'error'`.
  - Behaviour: `doStart` reads `recordEnabled` **at Démarrer** into a private `recordIntent` (stays fixed for the show); if set, `startRecord(dir, recordBaseName(session.name))` after `applyShow`. Switching session while live: `stopRecord` then start a new one. `doStop`/terminate: `stopRecord`, `recordIntent=false`. `attach` while live with `recordIntent`: start a new recording (new timestamp ⇒ new file). Failures → `recording:'error'` + warning `MSG_RECORD_FAILED = "Enregistrement impossible : "` + message; the show continues.
  - Event `'recording-saved'(path: string)` on a stopped record with a path; `main.ts` shows a `Notification` « Enregistrement sauvegardé » with body = file name; click → `shell.showItemInFolder(path)` (put the text in `nativeShell.ts` as `recordingSavedNotification(path): NotificationText`).
  - IPC `setup.pickFolder(): Promise<string | null>` (`showOpenDialog` with `openDirectory`, `createDirectory`).

- [ ] **Step 1: Failing tests:**
  - `records when enabled at Démarrer` — `recordEnabled:true` → `startRecord(dir,'Conf')`, state `recording:'on'`; Arrêter → `stopRecord`, `recording:'off'`, `'recording-saved'` emitted with the fake path.
  - `ticking during a show changes nothing until the next Démarrer` — start with false, `saveSettings({recordEnabled:true})` → no `startRecord`.
  - `OBS restart resumes recording` — live + recording; `restarting` + `ready` → `startRecord` called a second time.
  - `session switch closes and reopens the file` — start A, start B → `stopRecord` then `startRecord(…, 'B')`.
  - `record failure is a warning, the show goes on` — `startRecord` rejects → `recording:'error'`, warning starts with `MSG_RECORD_FAILED`, phase `'live'`.
  - nativeShell: `recordingSavedNotification('/v/Conf 2026.mkv')` → title « Enregistrement sauvegardé », body « Conf 2026.mkv ».
- [ ] **Step 2: Run** `npx vitest run tests/live.test.ts tests/nativeShell.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run typecheck && npm test` — PASS.
- [ ] **Step 5: Commit** `feat(live): enregistrement du direct sur le disque`

### Task 14: UI — groupe « Enregistrement » et pastille REC

**Files:**
- Modify: `src/renderer/main/Inspector.tsx`, `src/renderer/main/Toolbar.tsx`, `src/renderer/screens/MainWindow.tsx`, `src/renderer/main/mainWindow.css`, `src/renderer/ui/icons.tsx` (record icon), `README.md` (short « Enregistrement » and « Source de secours » paragraphs), `CHANGELOG.md`
- Test: `tests/renderer/mainWindow.test.tsx`

**Interfaces:**
- Consumes: `Settings.recordEnabled/recordDir`, `setup.pickFolder`, `LiveState.recording`.
- Produces: Inspector group « Enregistrement »: `Check` « Enregistrer le direct », path shown (`inspector-value`, middle-ellipsis via CSS), `Button` « Choisir… ». Toolbar: red pill « REC » when `recording === 'on'`.

- [ ] **Step 1: Failing tests:** `choosing a folder saves recordDir`; `REC pill shows while recording` (state `recording:'on'` → text `REC` visible; `'off'` → absent).
- [ ] **Step 2: Run** `npx vitest run tests/renderer` — FAIL.
- [ ] **Step 3: Implement**; add the README/CHANGELOG entries (CHANGELOG under a new « Non publié » section listing the four features).
- [ ] **Step 4: Run** `npm run typecheck && npm test` — PASS.
- [ ] **Step 5: Manual check** with `npm run dev` on macOS: ATEM (or any camera) as primary, an image as backup; cover/unplug the camera → backup within ~2 s, back within ~2 s; QR pinned visible top-right; record a 30 s show → MKV in the folder plays with subtitles and sound. Report what was and wasn’t checked.
- [ ] **Step 6: Commit** `feat(ui): enregistrement et pastille REC`
