# Lissage des sous-titres Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A « Lissage » slider (0–10 s) that delays the subtitle band so words only show once stable and come out at an even pace.

**Architecture:** A `CaptionSmoother` (main process) sits between the routed captions and `overlay.push`. It keeps a list of segments; a word of the open segment is admitted once unchanged for the delay (all words on final); admitted words are released one at a time, the interval shrinking so the queue empties within the delay. At 0 it is a pass-through.

**Tech Stack:** TypeScript, Electron main, React renderer, vitest (fake timers).

**Spec:** `docs/superpowers/specs/2026-11-26-lissage-sous-titres-design.md`

## Global Constraints

- Setting `subtitleSmoothingMs`: integer 0–10000, step 250, default 0 (= today's behaviour, messages identical).
- Band messages unchanged: `{type:'partial'|'final', text}`, `{type:'reset'}`; `layout.js` / `overlay.js` untouched.
- Base pace 250 ms/word (~4 words/s); interval = `min(250, (lastAdmitted + delay - now) / waiting)` so each word shows within the delay of its admission.
- UI copy: « Lissage », value « Direct » at 0 else « 1,5 s »; double-click → 0.

## Review Focus

- Slider moved to 0 while words are queued → the queue flushes at once (test in Task 1).
- Reset (clear, stop, language change, stale) while words are queued → nothing queued is shown afterwards (Task 1 + Task 2).
- Partial that shrinks below what is already shown → no crash, shows the new text (Task 1).
- Next segment's partials arriving while the previous final is still draining → order kept (Task 1).
- Empty final → still closes the segment (Task 1).

---

### Task 1: `CaptionSmoother`

**Files:** Create `src/main/captionSmoother.ts`; Test `tests/captionSmoother.test.ts`

**Interfaces — Produces:**
- `type BandCaption = { type: 'partial' | 'final'; text: string }`
- `class CaptionSmoother { constructor(sink: (m: BandCaption) => void, delayMs: () => number); caption(m: BandCaption): void; clear(): void }`

- [ ] Tests (fake timers): pass-through at 0; word shown only after being stable for the delay; a rewritten word restarts its wait; final admits all words, released one by one then `final`; pacing speeds up with backlog (all released within delay); delay set to 0 flushes; `clear()` drops queue; shrinking partial; next segment waits behind draining final; empty final.
- [ ] Implement; run `npx vitest run tests/captionSmoother.test.ts` → PASS. Commit.

### Task 2: Setting + wiring in `LiveController`

**Files:** Modify `src/shared/types.ts` (field + `subtitleSmoothingMs(s)` helper, `SUBTITLE_SMOOTHING_MAX = 10000`, `SUBTITLE_SMOOTHING_STEP = 250`), `src/shared/ipc.ts` (`checkSettingsPatch` rejects non-number / out of range), `src/main/live.ts` (all band caption/reset pushes go through a private `toBand(m)`; captions → smoother, reset → `smoother.clear()` then push); tests in `tests/subtitleSettings.test.ts`, `tests/live.test.ts`.

- [ ] Tests: helper clamps/rounds; patch validation; with smoothing 1000 a partial reaches `overlay.push` only after 1 s; a reset during the wait drops it.
- [ ] Implement; `npx vitest run` → PASS. Commit.

### Task 3: Inspector slider

**Files:** Modify `src/renderer/main/Inspector.tsx` (`Smoothing` component under `BandPosition`, same pattern), `src/renderer/main/mainWindow.css` (reuse `.band-position` styles); test in `tests/renderer/mainWindow.test.tsx` or `sheetForms`-style test.

- [ ] Test: slider labelled « Lissage des sous-titres », shows « Direct », change saves `{ subtitleSmoothingMs: 1500 }` and shows « 1,5 s ».
- [ ] Implement; `npm run typecheck && npx vitest run` → PASS. Commit.
