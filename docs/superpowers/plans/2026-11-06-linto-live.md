# LinTO Live Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single desktop app (macOS arm64 + Linux x86_64) that logs into LinTO Studio (incl. SSO), resolves-or-creates a session by name, and drives a hidden, bundled OBS to send the chosen audio input to LinTO and show the chosen video input with live LinTO captions full-screen on an HDMI display.

**Architecture:** Electron main process owns everything non-visual: LinTO REST + socket.io client, an OBS supervisor (seeds an isolated OBS config dir, spawns OBS hidden, drives it over obs-websocket v5), and a localhost overlay server whose page is loaded by an OBS Browser Source. OBS does all capture, compositing, audio streaming (to the session's SRT/RTMP endpoint) and HDMI output (fullscreen projector). The renderer is a 3-screen UI (Login → Setup → Live) talking to main over a typed IPC bridge.

**Tech Stack:** Node 22, TypeScript 5 (strict), Electron (latest stable), electron-vite, React 18 (renderer), Vitest, `obs-websocket-js` v5, `socket.io-client` v4, `ws`, electron-builder.

**Spec:** `docs/superpowers/specs/2026-11-06-linto-live-design.md` — read it; its "Faits établis" section is the source for every endpoint, setting key and flag used below.

## Global Constraints

- Platforms: macOS Apple Silicon and Linux x86_64. No Windows code paths.
- OBS 32.1.x bundled. The app never decodes, encodes or composites media itself; OBS does all of it.
- No OBS or browser window ever visible; on macOS an OBS Dock icon is tolerated (spec, user answer 4).
- Never read or write `~/Library/Application Support/obs-studio` or `~/.config/obs-studio`. OBS always runs with `CFFIXED_USER_HOME=<userData>/obs-home` (macOS) or `XDG_CONFIG_HOME=<userData>/obs-home/config` + `XDG_CACHE_HOME=<userData>/obs-home/cache` (Linux).
- OBS launch args, always: `--multi --minimize-to-tray --disable-updater --disable-missing-files-check --collection "LinTO Live" --profile "LinTO Live" --scene "LinTO Live" --websocket_port <port> --websocket_password <pw>`. Linux additionally sets `QT_QPA_PLATFORM=xcb`.
- obs-websocket password: random 32 bytes hex, new per launch, never persisted. Port: free port chosen at launch.
- LinTO default instance `https://studio.linto.ai`; all base URLs read from `<instance>/config.js` keys `VUE_APP_CONVO_API`, `VUE_APP_CONVO_AUTH`, `VUE_APP_SESSION_WS`, `VUE_APP_SESSION_WS_PATH`.
- All LinTO HTTP calls from the main process with `Authorization: Bearer <token>`. HTTP 401 ⇒ clear token, go to Login screen.
- Session reuse: exact name match among statuses `on_schedule | ready | active | paused` ⇒ reuse. Only `terminated` matches ⇒ refuse with message "La session « X » est terminée et ne peut pas être reprise. Choisis un autre nom." Never create a duplicate.
- New session payload: one channel, `visibility: "organization"`, `autoStart: true`, `autoEnd: false`, `diarization: false`, `keepAudio: true`, `compressAudio: true`, `translations: []`.
- "Arrêter" = stop OBS stream + switch HDMI output to a black scene (no websocket request closes a projector, see Task 12) — never calls LinTO `/stop`. "Terminer la session" = confirm dialog then `PUT …/sessions/:id/stop?force=true&waitFinal=true`. Closing the app = Arrêter.
- All persistent state lives under Electron `app.getPath('userData')` (dir name `LinTO Live`). Token encrypted with `safeStorage`.
- UI copy in French.
- macOS bundle: official OBS.app copied unmodified (not re-signed) into `Contents/Resources/obs/OBS.app`. Linux: OBS 32.1 built from source with browser source enabled, installed under `resources/obs/`, inside one AppImage.
- OBS is GPLv2: ship `resources/obs/COPYING` and a `resources/obs/SOURCE.md` pointing to the exact OBS tag/commit and build script.

## Review Focus

1. **OBS crashes or is killed mid-show** → supervisor restarts it, rebuilds scene/stream/projector from current live state within ~10 s, UI shows "OBS redémarré". (Task 3 test `restarts after unexpected exit`; Task 13 test `reapplies live state after obs restart`.)
2. **HDMI display unplugged/replugged or indices shuffled** → the saved output display is matched by geometry, not index; if absent, UI says "Écran de sortie introuvable" and offers the list. (Task 12 tests `matches by geometry when index changed`, `returns null when display gone`.)
3. **Token expires during a live show (SSO tokens may last 1 h)** → captions socket rejected / API 401 must not stop OBS output; UI shows a reconnect banner asking to log in again, and after login captions resume on the same session. (Task 9 test `emits authError on connect_error with auth message`; Task 13 test `keeps obs running on auth error`.)
4. **Reused session not owned by the user (no `streamEndpoints`)** → captions still displayed, audio streaming skipped, warning "Impossible d'envoyer l'audio : tu n'es pas propriétaire de cette session." (Task 8 test `reused session without endpoints yields canStream false`; Task 13 test `skips streaming when no endpoint`.)
5. **Session name with different case / surrounding spaces / prefix collisions** ("Conf" vs "Conférence") → name trimmed; exact, case-sensitive match after trim; prefix-only matches ignored. (Task 8 tests `ignores prefix matches`, `trims input`.)

---

## File Structure

```
package.json, tsconfig*.json, electron.vite.config.ts, vitest.config.ts, electron-builder.yml
src/shared/
  ipc.ts                 IPC channel names + request/response types (single source of truth)
  types.ts               domain types shared main/renderer
src/main/
  main.ts                app lifecycle, window, wiring
  preload.ts             contextBridge exposing typed `window.lintoLive`
  paths.ts               userData layout + OBS env per platform
  settings.ts            persisted settings JSON + encrypted token
  obs/seed.ts            pure: OBS config files to write for an isolated, dialog-free OBS
  obs/locate.ts          path to the OBS executable (dev vs packaged, per platform)
  obs/process.ts         ObsProcess: spawn/stop/restart supervisor
  obs/controller.ts      ObsController: obs-websocket v5 operations
  obs/streamTarget.ts    pure: LinTO streamEndpoints -> OBS stream service settings
  obs/monitors.ts        pure: match saved output display against GetMonitorList
  linto/instance.ts      fetch + parse config.js -> LintoUrls
  linto/api.ts           LintoApi REST client (injectable fetch)
  linto/auth.ts          local login + SSO BrowserWindow flow
  linto/sessionResolver.ts  pure-ish: reuse-or-create decision
  linto/captions.ts      CaptionBuffer (pure) + CaptionStream (socket.io)
  overlay/server.ts      localhost HTTP + WS server for the overlay page
  overlay/page/index.html, overlay.css, overlay.js   page loaded by OBS browser source
  live.ts                LiveController: orchestrates a live show
  uninstall.ts           list + remove every app artefact, trash the app
src/renderer/
  index.html, main.tsx, App.tsx
  screens/Login.tsx, Setup.tsx, Live.tsx
  components/VuMeter.tsx
tests/                   mirrors src/main (unit) ; tests/integration/ (real OBS, opt-in)
spikes/                  throwaway scripts from Task 0 (not shipped)
scripts/build-obs-linux.sh, scripts/fetch-obs-macos.sh
.github/workflows/linux.yml
```

Integration tests that need a real OBS run only with `LINTO_LIVE_IT=1` (`npm run test:it`); unit tests (`npm test`) never spawn OBS or hit the network.

---

### Task 0: Spikes (throwaway, gate the architecture)

**Files:** Create: `spikes/hidden-projector.mjs`, `spikes/stream-to-linto.mjs`, `spikes/RESULTS.md`

These need Camille: a second display plugged in, and LinTO credentials + a test session. Stop and report to her if either spike fails — the spec's plan B needs her approval.

- [ ] **Step 1: Hidden OBS + projector (macOS).** Script seeds a temp `CFFIXED_USER_HOME` with the files of Task 2 (inline them here), spawns `/Applications/OBS.app/Contents/MacOS/OBS` with the Global Constraints args, connects with `obs-websocket-js`, creates a color source in scene "LinTO Live", calls `GetMonitorList` then `OpenVideoMixProjector {videoMixType:"OBS_WEBSOCKET_VIDEO_MIX_TYPE_PROGRAM", monitorIndex:<second display>}`.
  Expected: color fills the 2nd display; no OBS main window, no dialog. Record whether a Dock icon appears. If the projector does not show, retry without `--minimize-to-tray` and with `user.ini [BasicWindow] SysTrayWhenStarted=true`; record which combination works.
- [ ] **Step 2: OBS → LinTO.** Script logs in (`POST /auth/login`), creates a session (Global Constraints payload), reads `channels[0].streamEndpoints`, configures OBS `SetStreamServiceSettings` per Task 5 mapping (SRT first, then RTMP), adds a `coreaudio_input_capture` source, `StartStream`, joins the socket.io room and prints `final` events while Camille speaks.
  Expected: session status goes `active`, `final` events print matching speech. Record which protocol worked and the latency.
- [ ] **Step 3: Write `spikes/RESULTS.md`** (working flags, Dock icon yes/no, working protocol). Later tasks use these results; if a result differs from this plan, update the affected task before executing it.
- [ ] **Step 4: Commit** `git commit -m "spike: hidden OBS projector and OBS→LinTO audio"`

---

### Task 1: Scaffold + paths

**Files:** Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `electron.vite.config.ts`, `vitest.config.ts`, `.gitignore`, `src/main/main.ts` (empty window), `src/main/preload.ts`, `src/renderer/{index.html,main.tsx,App.tsx}`, `src/main/paths.ts`, `src/shared/types.ts` · Test: `tests/paths.test.ts`

**Interfaces — Produces:**
```ts
export interface AppPaths { userData: string; obsHome: string; obsConfigDir: string; settingsFile: string }
export function appPaths(userData: string, platform: NodeJS.Platform): AppPaths
export function obsEnv(p: AppPaths, platform: NodeJS.Platform, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv
```
`obsConfigDir` is the directory that contains OBS's `global.ini` (i.e. `.../obs-studio`).

- [ ] **Step 1: Scaffold** with electron-vite (React + TS template), add vitest; scripts `dev`, `build`, `test`, `test:it`, `typecheck`. `npm run dev` opens an empty window titled "LinTO Live".
- [ ] **Step 2: Failing tests** `tests/paths.test.ts`:
  - darwin: `appPaths('/U/LinTO Live','darwin').obsConfigDir === '/U/LinTO Live/obs-home/Library/Application Support/obs-studio'`; `obsEnv(...).CFFIXED_USER_HOME === '/U/LinTO Live/obs-home'`.
  - linux: `obsConfigDir === '/U/LinTO Live/obs-home/config/obs-studio'`; env has `XDG_CONFIG_HOME='/U/LinTO Live/obs-home/config'`, `XDG_CACHE_HOME='/U/LinTO Live/obs-home/cache'`, `QT_QPA_PLATFORM='xcb'`.
  - `settingsFile === '/U/LinTO Live/settings.json'`; `obsEnv` keeps unrelated base vars.
- [ ] **Step 3: Run** `npm test -- paths` → FAIL. **Step 4: Implement.** **Step 5: Run** → PASS; `npm run typecheck` clean.
- [ ] **Step 6: Commit** `feat: scaffold electron app and isolated paths`

---

### Task 2: OBS config seed

**Files:** Create: `src/main/obs/seed.ts` · Test: `tests/obs/seed.test.ts`

**Interfaces — Produces:**
```ts
export interface SeedOptions { canvas: { width: 1920; height: 1080; fps: 30 } }
export function seedFiles(o: SeedOptions): Record<string /* path relative to obsConfigDir */, string>
export function writeSeed(obsConfigDir: string, o: SeedOptions): Promise<void> // writes files only if absent, except it ALWAYS rewrites global.ini [General] keys below and ALWAYS deletes .sentinel/run_*
```

- [ ] **Step 1: Failing tests:**
  - `global.ini` contains `FirstRun=true`, `LastVersion=536936448`, `InfoLastVersion=35188667056128`, `InfoIncrement=999`, `EnableAutoUpdates=false`, `MacOSPermissionsDialogLastShown=1`, `Pre31Migrated=true`, and no `[OBSWebSocket]` section.
  - `user.ini` contains `[General] FirstRun=true`, `ConfirmOnExit=false`; `[BasicWindow] SysTrayEnabled=true`, `SysTrayWhenStarted=true`, `SaveProjectors=false`.
  - `basic/profiles/LinTO Live/basic.ini` has `BaseCX=1920 BaseCY=1080 OutputCX=1920 OutputCY=1080 FPSCommon=30`, simple output mode, `VBitrate=800`, `ABitrate=128`.
  - `basic/scenes/LinTO Live.json` parses as JSON with `name:"LinTO Live"`, one scene "LinTO Live", no `DesktopAudioDevice*`/`AuxAudioDevice*` keys (so OBS adds no global audio sources).
  - `plugin_config/obs-websocket/config.json` = `{first_load:false, server_enabled:true, auth_required:true, alerts_enabled:false}` (port/password come from CLI flags).
  - `writeSeed` on a dir containing `.sentinel/run_123` removes it; second call does not overwrite a modified `basic.ini`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (adjust keys to `spikes/RESULTS.md`). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: seed isolated dialog-free OBS config`

---

### Task 3: OBS process supervisor

**Files:** Create: `src/main/obs/locate.ts`, `src/main/obs/process.ts` · Test: `tests/obs/process.test.ts`, `tests/integration/obs-process.it.test.ts`

**Interfaces:**
- Consumes: `AppPaths`, `obsEnv`, `writeSeed`.
- Produces:
```ts
export function obsExecutable(o: { packaged: boolean; resourcesPath: string; platform: NodeJS.Platform; env: NodeJS.ProcessEnv }): string
// dev darwin: env.LINTO_LIVE_OBS ?? '/Applications/OBS.app/Contents/MacOS/OBS'; packaged darwin: <resources>/obs/OBS.app/Contents/MacOS/OBS
// dev linux: env.LINTO_LIVE_OBS ?? 'obs'; packaged linux: <resources>/obs/bin/obs
export interface ObsConnection { port: number; password: string }
export class ObsProcess extends EventEmitter { // events: 'ready'(ObsConnection) 'exit'(code) 'restarting'(attempt)
  constructor(o: { exe: string; paths: AppPaths; platform: NodeJS.Platform; spawn?: typeof import('child_process').spawn; maxRestarts?: number /*5*/ })
  start(): Promise<ObsConnection>   // seeds, picks free port + random pw, spawns with Global Constraints args, resolves when websocket accepts a connection (poll ≤ 20 s)
  stop(): Promise<void>             // SIGTERM, wait ≤ 10 s, then SIGKILL; no restart
}
```
- [ ] **Step 1: Failing unit tests** with a fake `spawn`: args contain every Global Constraints flag with the generated port/password; env has `CFFIXED_USER_HOME` on darwin; `restarts after unexpected exit` (fake child exits code 1 → `restarting` emitted, spawn called again with a new password); stops restarting after `maxRestarts`; `stop()` sends SIGTERM and does not restart.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Integration test** (`LINTO_LIVE_IT=1`, darwin): `start()` on a temp userData resolves; real `~/Library/Application Support/obs-studio` mtime unchanged; `stop()` exits cleanly and leaves no `.sentinel/run_*`. Run `LINTO_LIVE_IT=1 npm run test:it -- obs-process` → PASS.
- [ ] **Step 6: Commit** `feat: supervise hidden bundled OBS`

---

### Task 4: OBS controller — scene, video, audio, overlay

**Files:** Create: `src/main/obs/controller.ts` · Test: `tests/obs/controller.test.ts` (fake `OBSWebSocket`), `tests/integration/obs-controller.it.test.ts`

**Interfaces:**
- Consumes: `ObsConnection`.
- Produces:
```ts
export interface DeviceItem { id: string; name: string }
export const SCENE = 'LinTO Live', SCENE_PAUSE = 'LinTO Pause', SRC_VIDEO = 'Salle', SRC_AUDIO = 'Micro', SRC_OVERLAY = 'Sous-titres'
export class ObsController {
  static connect(c: ObsConnection): Promise<ObsController>
  ensureScene(platform: NodeJS.Platform): Promise<void>      // idempotent: creates scene SCENE + 3 inputs if missing, order bottom→top: video, overlay ; audio input added to scene but has no video ; also creates empty scene SCENE_PAUSE (black)
  listVideoDevices(): Promise<DeviceItem[]>                  // GetInputPropertiesListPropertyItems on SRC_VIDEO, prop 'device' (darwin) / 'device_id' (linux)
  listAudioDevices(): Promise<DeviceItem[]>                  // on SRC_AUDIO, prop 'device_id'
  setVideoDevice(id: string): Promise<void>                  // + SetSceneItemTransform bounds 1920x1080 OBS_BOUNDS_SCALE_INNER
  setAudioDevice(id: string): Promise<void>
  setOverlayUrl(url: string): Promise<void>                  // browser_source {url, width:1920, height:1080, fps:30, fps_custom:true, reroute_audio:true, shutdown:false}, muted
  audioLevel$(cb: (db: number) => void): () => void          // InputVolumeMeters event for SRC_AUDIO
  screenshot(): Promise<string>                              // GetSourceScreenshot {sourceName:SCENE, imageFormat:'jpg', imageWidth:640, imageCompressionQuality:70} → data URL
  disconnect(): Promise<void>
}
```
Input kinds: darwin video `macos-avcapture`, linux `v4l2_input`; darwin audio `coreaudio_input_capture`, linux `pulse_input_capture`; overlay `browser_source`. Only SRC_AUDIO is assigned to audio track 1 (`SetInputAudioTracks`); SRC_VIDEO audio and overlay audio disabled/muted.

- [ ] **Step 1: Failing unit tests** on a fake client recording calls: `ensureScene` twice ⇒ inputs created once; darwin uses `macos-avcapture`, linux `v4l2_input`; `setOverlayUrl` sends the exact settings above and mutes; `listVideoDevices` maps `{itemName,itemValue}` → `{name,id}` and drops `itemEnabled:false`; only `Micro` on track 1.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** with `obs-websocket-js`. **Step 4: Run** → PASS.
- [ ] **Step 5: Integration test** against real OBS from Task 3: `ensureScene`; `listAudioDevices().length > 0`; `setOverlayUrl('about:blank')`; `screenshot()` starts with `data:image/jpeg`. Run → PASS.
- [ ] **Step 6: Commit** `feat: drive OBS scene, devices and overlay source`

---

### Task 5: Stream target mapping + streaming

**Files:** Create: `src/main/obs/streamTarget.ts`; Modify: `src/main/obs/controller.ts` · Test: `tests/obs/streamTarget.test.ts`, `tests/obs/controller.test.ts`

**Interfaces — Produces:**
```ts
export interface StreamEndpoints { srt?: string; rtmp?: string; ws?: string }
export interface ObsStreamService { streamServiceType: 'rtmp_custom'; streamServiceSettings: { server: string; key: string } }
export function toObsStreamService(e: StreamEndpoints, prefer: 'srt' | 'rtmp'): ObsStreamService | null
// ObsController additions:
startStream(s: ObsStreamService): Promise<void>  // SetStreamServiceSettings then StartStream; no-op if already active with same server
stopStream(): Promise<void>                       // StopStream if active
streamState$(cb: (s: 'starting'|'active'|'stopped'|'error') => void): () => void
```
`prefer` default comes from `spikes/RESULTS.md`.

- [ ] **Step 1: Failing tests:** srt `srt://h:9000?streamid=abc,0&mode=caller` → `{server:<same url>, key:''}`; rtmp `rtmp://h:1935/abc/0` → `{server:'rtmp://h:1935/abc', key:'0'}`; prefer srt but only rtmp present → rtmp mapping; only `ws` present → `null`; `startStream` twice with same server ⇒ one `StartStream`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: stream selected audio to LinTO channel endpoint`

---

### Task 6: LinTO instance + REST client

**Files:** Create: `src/main/linto/instance.ts`, `src/main/linto/api.ts`; Modify: `src/shared/types.ts` · Test: `tests/linto/instance.test.ts`, `tests/linto/api.test.ts`

**Interfaces — Produces:**
```ts
export interface LintoUrls { instance: string; api: string; auth: string; wsUrl: string; wsPath: string }
export function parseConfigJs(instance: string, js: string): LintoUrls
export function loadInstance(instance: string, fetchFn?: typeof fetch): Promise<LintoUrls>
// shared/types.ts
export type SessionStatus = 'on_schedule' | 'ready' | 'active' | 'paused' | 'terminated'
export interface Channel { id: number; name: string; streamEndpoints?: StreamEndpoints }
export interface Session { id: string; name: string; status: SessionStatus; channels: Channel[]; owner?: string }
export interface Organization { id: string; name: string }   // map from API `_id`
export interface TranscriberProfile { id: number; name: string; languages?: string[] }
export interface AuthMethod { path: string; from: string; name: string }
export class UnauthorizedError extends Error {}
export class LintoApi {
  constructor(urls: LintoUrls, token: () => string | null, fetchFn?: typeof fetch)
  authMethods(): Promise<AuthMethod[]>                                 // GET {auth}/list
  loginLocal(email: string, password: string): Promise<{ token: string; userId: string }>  // POST {auth}/login
  organizations(): Promise<Organization[]>                             // GET {api}/organizations
  transcriberProfiles(orgId: string): Promise<TranscriberProfile[]>
  searchSessions(orgId: string, namePrefix: string): Promise<Session[]> // searchName, statusList=on_schedule,ready,active,paused,terminated, limit=50
  createSession(orgId: string, name: string, profileId: number): Promise<Session>  // Global Constraints payload
  getSession(orgId: string, id: string): Promise<Session>
  terminateSession(orgId: string, id: string): Promise<void>           // PUT …/stop?force=true&waitFinal=true
}
```
- [ ] **Step 1: Failing tests:** `parseConfigJs` on a fixture copy of the live `config.js` (save it to `tests/fixtures/config.js`) → `api:'https://studio.linto.ai/cm-api/api'`, `auth:'https://studio.linto.ai/cm-api/auth'`, `wsUrl:'https://studio.linto.ai'`, `wsPath:'/cm-api/socket.io'`; every request carries `Authorization: Bearer t`; 401 ⇒ `UnauthorizedError`; `createSession` body deep-equals the Global Constraints payload with `channels[0].transcriberProfileId === profileId`; `searchSessions` URL has `searchName=` URL-encoded (test with `"Conf é&"`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (global `fetch`). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: LinTO Studio REST client`

---

### Task 7: Auth — local + SSO

**Files:** Create: `src/main/linto/auth.ts`, `src/main/settings.ts` · Test: `tests/linto/auth.test.ts`, `tests/settings.test.ts`

**Interfaces:**
- Consumes: `LintoApi`, `LintoUrls`, `AppPaths`.
- Produces:
```ts
export type RedirectResult = { kind: 'token'; token: string } | { kind: 'exchange' } | { kind: 'none' }
export function classifyRedirect(url: string, instance: string): RedirectResult
// `${instance}/login/oidc?token=X` → token X ; `${instance}/login/oidc` without token → exchange ; anything else → none
export function ssoLogin(urls: LintoUrls, method: AuthMethod, parent: BrowserWindow, opts?: { email?: string }): Promise<string /*token*/>
// modal BrowserWindow, partition 'persist:linto-sso', loads `${urls.auth}/${method.path}/login` (+ `?email=` for oidc/organization after POST {auth}/oidc/organization/resolve)
// on will-redirect/did-navigate: token → resolve ; exchange → net.fetch(`${urls.auth}/oidc/token`) within that session → auth_token ; window closed by user → reject 'cancelled'
export interface Settings { instance: string; orgId?: string; profileId?: number; videoDeviceId?: string; audioDeviceId?: string; output?: SavedDisplay; lastSessionName?: string }
export class SettingsStore {
  constructor(p: AppPaths, crypto: { encrypt(s: string): Buffer; decrypt(b: Buffer): string })
  get(): Settings; update(patch: Partial<Settings>): void
  getToken(): string | null; setToken(t: string | null): void   // stored base64 in settings.json under `tokenEnc`
}
```
Also add to `src/shared/types.ts` (used by Tasks 11–13): `export interface SavedDisplay { name: string; x: number; y: number; width: number; height: number }` and `export interface MonitorInfo extends SavedDisplay { index: number }`.

- [ ] **Step 1: Failing tests:** `classifyRedirect` for the 3 cases plus a look-alike host (`https://evil.test/login/oidc?token=x` → none); `SettingsStore` round-trips token via a fake crypto and never writes plaintext token to disk; missing file ⇒ defaults `{instance:'https://studio.linto.ai'}`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (`ssoLogin` has no unit test; covered by Step 5). **Step 4: Run** → PASS.
- [ ] **Step 5: Manual check with Camille:** `npm run dev`, login with Linagora SSO and with email/password; `GET /api/users/self` succeeds with the stored token after app restart.
- [ ] **Step 6: Commit** `feat: LinTO login with SSO and encrypted token`

---

### Task 8: Session resolver

**Files:** Create: `src/main/linto/sessionResolver.ts` · Test: `tests/linto/sessionResolver.test.ts`

**Interfaces — Produces:**
```ts
export type Resolution =
  | { kind: 'reused' | 'created'; session: Session; channel: Channel; canStream: boolean }
  | { kind: 'terminated'; name: string }
export function resolveSession(api: Pick<LintoApi,'searchSessions'|'createSession'|'getSession'>, orgId: string, rawName: string, profileId: number): Promise<Resolution>
```
Rules: name = `rawName.trim()`, empty ⇒ throw `Error('Nom de session vide')`. Exact match among non-terminated (if several, the most recently created) ⇒ `getSession` to get endpoints ⇒ reused. Else exact terminated match ⇒ terminated. Else create. `channel` = `channels[0]`. `canStream` = `toObsStreamService(channel.streamEndpoints ?? {}, 'srt') !== null`.

- [ ] **Step 1: Failing tests** (fake api): `reuses active exact match`; `ignores prefix matches` ("Conf" with existing "Conférence" ⇒ created); `trims input`; `terminated only ⇒ terminated, createSession not called`; `active + terminated same name ⇒ reused`; `reused session without endpoints yields canStream false`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: reuse-or-create LinTO session by name`

---

### Task 9: Captions — buffer + socket stream

**Files:** Create: `src/main/linto/captions.ts` · Test: `tests/linto/captions.test.ts`

**Interfaces — Produces:**
```ts
export interface CaptionEvent { segmentId: number; text: string; locutor?: string | null }
export interface CaptionView { lines: string[] /* ≤ 2, oldest first */; partial: boolean }
export class CaptionBuffer {
  constructor(maxCharsPerLine = 64, maxLines = 2)
  partial(e: CaptionEvent): CaptionView
  final(e: CaptionEvent): CaptionView
}
export class CaptionStream extends EventEmitter { // events: 'partial'(CaptionEvent) 'final'(CaptionEvent) 'status'('connecting'|'live'|'offline') 'authError'()
  constructor(urls: LintoUrls, token: () => string | null, ioFactory?: typeof import('socket.io-client').io)
  open(sessionId: string, channelId: number): void   // io(wsUrl,{path:wsPath, transports:['websocket'], auth:{token}}); on connect emit('join_room', `${sessionId}/${channelId}`); auto-reconnect re-joins
  close(): void                                      // leave_room + disconnect
}
```
Buffer algorithm: keep finalized text + current partial (same `segmentId` replaces the partial); word-wrap the concatenation at `maxCharsPerLine`; return the last `maxLines` lines. A final with a new `segmentId` closes any pending partial. Empty-text events are ignored.

- [ ] **Step 1: Failing tests:** partials with same id replace each other; final then new partial ⇒ final text kept before partial; long text wraps on word boundaries and only last 2 lines returned; `CaptionStream` with fake io emits `join_room` with `"s1/7"` on connect and again after a reconnect; `emits authError on connect_error with auth message` ("Authentication token is missing" or event `unauthorized`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: live caption stream and two-line buffer`

---

### Task 10: Overlay server + page

**Files:** Create: `src/main/overlay/server.ts`, `src/main/overlay/page/{index.html,overlay.css,overlay.js}` · Test: `tests/overlay/server.test.ts`

**Interfaces — Produces:**
```ts
export class OverlayServer {
  start(): Promise<{ url: string }>   // 127.0.0.1, random port; serves page at `/`, WS at `/ws`; url = `http://127.0.0.1:<port>/?k=<random token>`; WS rejects wrong k
  push(v: CaptionView): void           // broadcast JSON {lines, partial}; last view replayed to new clients
  stop(): Promise<void>
}
```
Page: 1920×1080 transparent body; caption box bottom-centered, 80 px from bottom, max width 1700 px, background `rgba(0,0,0,0.65)`, white text, 56 px, line-height 1.25, font-family system sans; partial line at 85 % opacity; box hidden when no lines; reconnects WS every 1 s. Page assets are copied to the build output (electron-vite `publicDir` or explicit copy) and resolved from `app.getAppPath()`.

- [ ] **Step 1: Failing tests:** `GET /` returns HTML containing `id="captions"`; WS with wrong `k` closed; client connecting after `push` receives last view; server binds only `127.0.0.1`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (`node:http` + `ws`). **Step 4: Run** → PASS.
- [ ] **Step 5: Visual check:** `npx tsx scripts/overlay-demo.ts` (create it: starts server, pushes a demo two-line view every 2 s) and open the URL in a browser; text readable, box at bottom. Delete nothing — keep the demo script.
- [ ] **Step 6: Commit** `feat: localhost caption overlay for OBS browser source`

---

### Task 11: IPC contract + preload

**Files:** Create: `src/shared/ipc.ts`; Modify: `src/main/preload.ts` · Test: `tests/ipc.test.ts`

**Interfaces — Produces** (`window.lintoLive` in renderer):
```ts
export interface LintoLiveApi {
  auth: { methods(): Promise<AuthMethod[]>; loginLocal(email: string, pw: string): Promise<void>; loginSso(path: string, email?: string): Promise<void>; logout(): Promise<void>; status(): Promise<{ loggedIn: boolean }> }
  setup: { load(): Promise<SetupData>; save(s: Partial<Settings>): Promise<void> }  // SetupData = { settings, organizations, profiles, videoDevices, audioDevices, displays: MonitorInfo[] }
  live: { start(sessionName: string): Promise<StartResult>; stop(): Promise<void>; terminate(): Promise<void>; changeDisplay(d: SavedDisplay): Promise<void> }
  // StartResult = { ok: true; reused: boolean; canStream: boolean } | { ok: false; message: string }
  app: { uninstall(): Promise<void> }
  on(evt: 'live-state', cb: (s: LiveState) => void): () => void
  on(evt: 'preview', cb: (dataUrl: string) => void): () => void
  on(evt: 'audio-level', cb: (db: number) => void): () => void
  on(evt: 'auth-required', cb: () => void): () => void
}
export interface LiveState { phase: 'idle'|'starting'|'live'|'stopping'|'error'; session?: { name: string; status: SessionStatus }; stream: 'off'|'starting'|'active'|'error'|'unavailable'; captions: 'connecting'|'live'|'offline'; obs: 'running'|'restarting'|'down'; output: 'shown'|'display-missing'|'off'; lastLine?: string; warning?: string }
export const IPC = { /* one string constant per method/event above, e.g. 'auth:methods' */ } as const
```
- [ ] **Step 1: Failing test:** every key of `IPC` is unique and every method in `LintoLiveApi` has an `IPC` entry (type-level test with `expectTypeOf` + runtime uniqueness).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** preload with `contextBridge.exposeInMainWorld('lintoLive', …)`, `contextIsolation: true`, `sandbox: true`. **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: typed IPC bridge`

---

### Task 12: Output display + projector

**Files:** Create: `src/main/obs/monitors.ts`; Modify: `src/main/obs/controller.ts` · Test: `tests/obs/monitors.test.ts`

**Interfaces — Produces:**
```ts
// MonitorInfo / SavedDisplay come from src/shared/types.ts (Task 7)
export function matchDisplay(saved: SavedDisplay, list: MonitorInfo[]): MonitorInfo | null
// 1) exact x,y,width,height ; 2) same name (strip trailing "(n)") and size ; else null
// ObsController additions:
monitors(): Promise<MonitorInfo[]>              // GetMonitorList
openProgramProjector(index: number): Promise<void>  // OpenVideoMixProjector PROGRAM
```
No websocket request closes a projector: "Arrêter" therefore stops the stream and switches the program to `SCENE_PAUSE` (Task 4); "Démarrer" switches back to `LinTO Live` and (re)opens the projector only if not already opened this OBS run. The controller tracks `projectorOpenOn: number | null`, reset on OBS restart. If the spike showed another behaviour, follow `spikes/RESULTS.md`.

- [ ] **Step 1: Failing tests:** `matches by geometry when index changed`; `matches by name and size when moved`; `returns null when display gone`; controller opens the projector once per OBS run for the same index, again after `resetProjectorState()`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: open OBS program projector on saved display`

---

### Task 13: LiveController orchestration

**Files:** Create: `src/main/live.ts`; Modify: `src/main/main.ts` (wire IPC) · Test: `tests/live.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
```ts
export class LiveController extends EventEmitter { // events: 'state'(LiveState) 'preview'(string) 'audio-level'(number) 'auth-required'()
  constructor(deps: { obs: ObsProcess; controllerFactory: (c: ObsConnection) => Promise<ObsController>; api: LintoApi; captions: CaptionStream; overlay: OverlayServer; settings: SettingsStore; platform: NodeJS.Platform })
  boot(): Promise<void>                        // start OBS + overlay, ensureScene, apply saved devices, setOverlayUrl
  start(sessionName: string): Promise<StartResult>
  stop(): Promise<void>
  terminate(): Promise<void>
  shutdown(): Promise<void>                    // stop() then obs.stop() + overlay.stop()
}
```
`start`: `resolveSession` → terminated ⇒ `{ok:false, message:<Global Constraints copy>}`; else captions.open; buffer → overlay.push; `canStream` ⇒ `startStream(toObsStreamService(...))` else state `stream:'unavailable'` + warning (Review Focus 4 copy); program to `LinTO Live`; projector on `matchDisplay(settings.output)` or `output:'display-missing'`; preview timer 200 ms (`screenshot()`), stopped when phase ≠ live. On `obs` `ready` after a restart: new controller, `ensureScene`, re-apply devices/overlay/stream/projector if phase was live. On captions `authError` or `UnauthorizedError`: emit `auth-required`, keep OBS output and stream untouched, `captions:'offline'`; after re-login the controller re-opens captions on the same session.

- [ ] **Step 1: Failing tests** (all deps faked): `start reused session streams and projects`; `terminated returns message and starts nothing`; `skips streaming when no endpoint`; `reapplies live state after obs restart`; `keeps obs running on auth error`; `stop does not call terminateSession`; `terminate calls terminateSession then stop`; `display missing sets output display-missing but still streams`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement + wire IPC handlers in `main.ts`**; `before-quit` ⇒ `shutdown()` (prevent default until done, 15 s cap). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: orchestrate live show`

---

### Task 14: Renderer UI

**Files:** Create: `src/renderer/screens/{Login,Setup,Live}.tsx`, `src/renderer/components/VuMeter.tsx`; Modify: `src/renderer/App.tsx` · Test: `tests/renderer/*.test.tsx` (Vitest + Testing Library, `window.lintoLive` mocked)

Screens (French copy):
- **Login**: instance field (prefilled, collapsible "Avancé"), email + mot de passe + "Se connecter", then one button per SSO method from `auth.methods()` ("Se connecter avec <name>"); `oidc/organization` asks for the email first. Errors shown inline.
- **Setup**: Organisation (select, hidden if only one), Profil de transcription, Entrée vidéo, Entrée audio + VuMeter, Écran de sortie (list from `displays`), Nom de la session (prefilled with `lastSessionName`), button "Démarrer". Every change → `setup.save`.
- **Live**: preview `<img>` (16:9), session name + "reprise"/"nouvelle" badge, status chips (OBS, Audio→LinTO, Sous-titres, Sortie HDMI), last caption line, warning banner, buttons "Arrêter", "Terminer la session" (confirm: "Terminer définitivement la session « X » ? Elle ne pourra plus être reprise."), "Changer d'écran". `auth-required` ⇒ banner "Session LinTO expirée — se reconnecter" opening Login as a modal without leaving Live.
- Menu/footer: "Désinstaller LinTO Live…" (Task 15).

- [ ] **Step 1: Failing tests:** Login renders one SSO button per method; Setup "Démarrer" disabled until session name non-empty and video+audio chosen; Live shows warning text from `LiveState.warning`; Terminer requires confirmation.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Manual end-to-end with Camille** (`npm run dev`, capture card + mic + HDMI): login SSO → session name → Démarrer → captions on HDMI over room video; Arrêter → HDMI black, session still `active`/`ready` in LinTO Studio; Démarrer again with same name → "reprise".
- [ ] **Step 6: Commit** `feat: login, setup and live screens`

---

### Task 15: Uninstall

**Files:** Create: `src/main/uninstall.ts` · Test: `tests/uninstall.test.ts`

**Interfaces — Produces:**
```ts
export function uninstallTargets(o: { platform: NodeJS.Platform; home: string; userData: string; appId: 'ai.linto.live'; appName: 'LinTO Live'; exePath: string; appImage?: string; personalObsInstalled: boolean }): { remove: string[]; trash: string | null }
export function runUninstall(t: ReturnType<typeof uninstallTargets>, fs: { rm(p: string): Promise<void>; trash(p: string): Promise<void> }): Promise<void>
```
darwin `remove`: userData, `~/Library/Caches/LinTO Live`, `~/Library/Caches/ai.linto.live`, `~/Library/Logs/LinTO Live`, `~/Library/Preferences/ai.linto.live.plist`, `~/Library/Saved Application State/ai.linto.live.savedState`, and `~/Library/Preferences/com.obsproject.obs-studio.plist` only if `!personalObsInstalled` (= `/Applications/OBS.app` absent). `trash`: the `.app` root derived from `exePath`.
linux `remove`: userData, `~/.cache/LinTO Live`, `~/.local/share/applications/*linto-live*.desktop` (resolved by caller), `trash`: `appImage` path.
Flow in main: confirm dialog ("Supprimer LinTO Live et toutes ses données ?") → `LiveController.shutdown()` → `runUninstall` → `app.exit(0)`.

- [ ] **Step 1: Failing tests:** darwin list exact; OBS plist included only when `personalObsInstalled:false`; nothing outside `home` is ever listed; linux `trash === appImage`; `.app` root from `/Applications/LinTO Live.app/Contents/MacOS/LinTO Live`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (`shell.trashItem` for trash, `fs.rm({recursive,force})`). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: in-app uninstall removing every artefact`

---

### Task 16: macOS packaging (embedded OBS)

**Files:** Create: `electron-builder.yml`, `scripts/fetch-obs-macos.sh`, `resources/obs/SOURCE.md`; Modify: `package.json`

- [ ] **Step 1:** `scripts/fetch-obs-macos.sh` downloads the official OBS 32.1.0 arm64 DMG from the GitHub release, verifies its SHA-256 (pin it in the script), copies `OBS.app` to `vendor/obs/macos/OBS.app` (gitignored), and copies OBS `COPYING` next to it.
- [ ] **Step 2:** electron-builder mac target `dmg` + `dir`, arm64, `appId: ai.linto.live`, `productName: LinTO Live`, `extraResources: vendor/obs/macos → obs`, `mac.identity: null` (unsigned, personal use), `extendInfo` with `NSCameraUsageDescription`/`NSMicrophoneUsageDescription` (French), `asarUnpack` overlay page.
- [ ] **Step 3: Verify:** `npm run dist:mac`; install the DMG; launch; while running, `ps` shows OBS from `LinTO Live.app/Contents/Resources/obs/OBS.app`; `~/Library/Application Support/obs-studio` mtime unchanged; full Task 14 manual flow passes from the packaged app; then in-app uninstall leaves none of the Task 15 darwin paths.
- [ ] **Step 4: Commit** `build: package macOS app with embedded OBS`

---

### Task 17: Linux packaging (OBS built in CI, single AppImage)

**Files:** Create: `scripts/build-obs-linux.sh`, `.github/workflows/linux.yml`; Modify: `electron-builder.yml`

- [ ] **Step 1:** `scripts/build-obs-linux.sh` (Ubuntu 24.04): clone obs-studio at tag `32.1.0` (record commit in `resources/obs/SOURCE.md`), fetch OBS's prebuilt CEF for that release, configure `-DENABLE_BROWSER=ON -DCEF_ROOT_DIR=… -DENABLE_WEBSOCKET=ON -DENABLE_AJA=OFF -DENABLE_NEW_MPEGTS_OUTPUT=ON -DCMAKE_INSTALL_PREFIX=/obs`, `DESTDIR=vendor/obs/linux cmake --install`, then bundle non-glibc shared libs (Qt6, FFmpeg, x264, libdatachannel…) into `vendor/obs/linux/obs/lib` with `linuxdeploy` (or `ldd` copy + RPATH `$ORIGIN/../lib`). Output `vendor/obs/linux/obs/bin/obs`.
- [ ] **Step 2:** electron-builder linux target `AppImage`, x64, `extraResources: vendor/obs/linux/obs → obs`.
- [ ] **Step 3:** GitHub Actions workflow on `ubuntu-24.04`: build OBS (cached by tag), `npm ci`, `npm test`, `npm run dist:linux`, upload AppImage artifact.
- [ ] **Step 4: Verify** on a clean Ubuntu 24.04 VM (X11 session): AppImage runs; `LINTO_LIVE_IT=1` integration tests pass with the bundled OBS (`LINTO_LIVE_OBS=<extracted>/resources/obs/bin/obs`); browser source renders the overlay (screenshot contains non-black pixels where captions are); `~/.config/obs-studio` not created; in-app uninstall removes the AppImage and all Task 15 linux paths.
- [ ] **Step 5: Commit** `build: Linux AppImage with self-built OBS`
