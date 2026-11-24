# Suivre une session — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A session live on another device can be followed: captions on the output window and subtitle window, no audio sent.

**Architecture:** The renderer decides « Suivre » from the session list (status `active`, not sent from here) and passes `follow` to `live.start`. Main runs the usual `doStart` with no stream service and a new `stream: 'following'` state, no warning. The menu/tray read a `follow` flag from the shell report.

**Tech Stack:** Electron, TypeScript, React, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-24-suivre-session-design.md`

## Global Constraints

- UI copy in French: button « Suivre » / « Connexion… », toolbar caption « suivie — audio envoyé par un autre appareil ».
- Following never calls `startStream` and never shows `MSG_NO_STREAM` / `MSG_RTMP_ONLY`.
- No microphone is required to follow.

## Review Focus

- This machine just stopped sending: the list still says `active` for a few seconds → the button must stay « Démarrer » for that session (Task 2 test).
- Switching on air between a followed session and a sendable one: the stream starts/stops accordingly (Task 1 test).
- Arrêter while following: no `stopStream` call needed, ends idle with no warning (Task 1 test).
- A follower's state must not raise the « Le son n'arrive plus à LinTO » notification (covered: `notificationFor` only fires from `active`).
- A pending new session is never followed (`follow` only with an existing summary).

---

### Task 1: Follow mode in main

**Files:**
- Modify: `src/shared/ipc.ts` (`LiveState.stream` adds `'following'`; `live.start(sessionName, create?, follow?: boolean)`; `liveStart` preload passes it)
- Modify: `src/main/main.ts` (`IPC.liveStart` handler: `follow === true` only, ignored with `create`)
- Modify: `src/main/live.ts` (`start(name, create?, follow = false)` → `doStart(..., follow)`)
- Test: `tests/live.test.ts`

**Interfaces:**
- Produces: `LiveController.start(sessionName: string, create?: NewSessionOptions, follow?: boolean): Promise<StartResult>`; `LiveState['stream']` includes `'following'`.

- [ ] **Step 1: Failing tests** in `tests/live.test.ts`:
  - `follow: a session I could stream to goes live without streaming, captions open, no warning` — `start('Conf', undefined, true)` → `log` has no `startStream`, state `{ phase: 'live', stream: 'following', warning: undefined }`, `captions.open` called.
  - `follow then switching to a session started normally streams again` — follow `A`, then `start('B')` → `startStream` called, `stream: 'starting'`.
  - `Arrêter while following ends idle without stopping a stream` — no `stopStream` in log, `phase: 'idle'`.
- [ ] **Step 2:** `npx vitest run tests/live.test.ts` → the three FAIL.
- [ ] **Step 3:** In `doStart`, `service: res.canStream && !follow ? service : null`; state `stream: follow ? 'following' : cur.service ? 'starting' : 'unavailable'`, `warning` undefined when following. Wire the IPC arg and type.
- [ ] **Step 4:** `npx vitest run tests/live.test.ts tests/ipc.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(live): suivre une session envoyée par un autre appareil`.

### Task 2: « Suivre » in the main window

**Files:**
- Modify: `src/renderer/screens/MainWindow.tsx`, `src/renderer/main/Toolbar.tsx`
- Test: `tests/renderer/mainWindow.test.tsx`

**Interfaces:**
- Consumes: `live.start(name, undefined, true)`, `stream: 'following'`.
- Produces: `ToolbarProps.follow?: boolean`; `ShellReport.follow?: boolean` sent by `reportShellState`.

- [ ] **Step 1: Failing tests** (`describe('Suivre')`):
  - `a session active on LinTO shows Suivre and follows it` — list with `status: 'active'`, click « Suivre » → `live.start` called with `('Conf', undefined, true)`.
  - `Suivre needs no microphone` — no `audioDeviceId` → Suivre enabled.
  - `the session this machine just sent stays Démarrer while LinTO still says active` — go live on `Conf`, Arrêter, list still `active` → button « Démarrer ».
  - `following shows the caption « suivie — audio envoyé par un autre appareil »` — state `stream: 'following'`.
- [ ] **Step 2:** `npx vitest run tests/renderer/mainWindow.test.tsx` → FAIL.
- [ ] **Step 3:** `MainWindow`: `sentHere` (name of the last session live here with stream not `'following'`), cleared when the list shows it not `active`. `follow = !onAir && summary?.status === 'active' && summary.name !== sentHere`. The mic hint is skipped when `follow`. `startSession` passes `follow`. Caption: `state.stream === 'following'` → the follow copy. Toolbar: label `follow ? (busy === 'start' ? 'Connexion…' : 'Suivre') : …`.
- [ ] **Step 4:** Tests PASS.
- [ ] **Step 5:** Commit `feat(ui): bouton Suivre pour une session en direct ailleurs`.

### Task 3: Menu and tray say « Suivre »

**Files:**
- Modify: `src/shared/ipc.ts` (`ShellReport.follow?`), `src/main/main.ts` (shell report validation + `ShellState`), `src/main/nativeShell.ts`
- Test: `tests/nativeShell.test.ts`

- [ ] **Step 1: Failing test** `idle on a session live elsewhere: the start item reads Suivre` — `appMenuTemplate({ ...idle, canStart: true, follow: true })` and `trayMenuTemplate(...)` contain « Suivre », not « Démarrer ».
- [ ] **Step 2:** FAIL. **Step 3:** `ShellState.follow?: boolean`; label `s.follow ? 'Suivre' : 'Démarrer'`. **Step 4:** PASS.
- [ ] **Step 5:** `npm run typecheck && npm test` green; commit `feat(shell): Suivre dans le menu et la barre système`.
