# Spike results

## Step 1 - hidden OBS + projector (macOS): PASS (windowed projector only, single display)

Environment: OBS 32.1.0 (window title says "32.1.0-rc4"), obs-websocket 5.7.2, one display connected
(Built-in Retina 1512x982, `GetMonitorList` returned a single monitor, index 0).

Working launch (first combination tried, no fallback needed):
`OBS --multi --minimize-to-tray --disable-updater --disable-missing-files-check --collection "LinTO Live" --profile "LinTO Live" --scene "LinTO Live" --websocket_port <port> --websocket_password <pw>`
with `CFFIXED_USER_HOME=<temp dir>` and the seeded files in `spikes/obs-common.mjs` (user.ini `SysTrayEnabled=true`, `SysTrayWhenStarted=true`).

- Websocket accepted a connection within a few seconds; no dialog appeared (seed suppresses first-run / permissions / update prompts).
- `CreateInput` color_source_v3 in scene "LinTO Live" OK.
- `OpenVideoMixProjector {PROGRAM, monitorIndex: -1}` OK. CGWindowList for the OBS pid:
  - "Projector - Program" 480x302 at (516,302), on-screen = yes.
  - Main window "OBS 32.1.0-rc4 - Profile: LinTO Live - Scenes: LinTO Live" 1280x992, on-screen = **false** (hidden to tray).
  - one 0x0 off-screen helper window.
- Dock icon: **no**. `NSRunningApplication.activationPolicy` = 2 (prohibited), `lsappinfo` type = BackgroundOnly.
- NOT verified: fullscreen projector on a second display (`monitorIndex >= 1`) - only one display available. Re-run
  `node spikes/hidden-projector.mjs --monitor 1` once a second display/HDMI is plugged in (HOLD_MS=20000 to keep it open).
  The no-`--minimize-to-tray` fallback is available via `--no-tray` but was not needed.
- Real OBS config `~/Library/Application Support/obs-studio` mtime unchanged before/after (1793958814). Temp dir removed, OBS stopped with SIGTERM.

Tools: `spikes/list-windows.swift <pid>` (CGWindowList), `spikes/policy.swift <pid>` (activation policy).

## Step 2 - OBS -> LinTO: script ready, NOT RUN - waiting for credentials

`spikes/stream-to-linto.mjs` is written (login or token, org + transcriber profile pick, session create with the
Global Constraints payload, SRT-then-RTMP mapping to `rtmp_custom`, `coreaudio_input_capture`, `StartStream`,
socket.io `join_room`, prints `final` events + session status every 5 s, stops and cleans up). It fails fast
(exit 2) without credentials. Non-authenticated parts checked: `https://studio.linto.ai/config.js` exposes the
expected `VUE_APP_CONVO_API/AUTH`, `VUE_APP_SESSION_WS(_PATH)`; `/cm-api/auth/list` lists local, oidc, oidc/organization, google, github.

Run (SRT first, then RTMP; speak during the run):
```
cd spikes && LINTO_EMAIL=... LINTO_PASSWORD=... node stream-to-linto.mjs
cd spikes && LINTO_EMAIL=... LINTO_PASSWORD=... SPIKE_PROTOCOL=rtmp node stream-to-linto.mjs
# or LINTO_TOKEN=<auth_token> for SSO accounts; optional LINTO_ORG_ID, LINTO_PROFILE_ID, SPIKE_AUDIO_DEVICE, SPIKE_DURATION_S
```
Record here: protocol that worked, session reaching `active`, `final` latency.

## Spike B — OBS → LinTO (2026-11-09, studio.linto.ai, profil 26 « LinTO Live » voxstral)

Audio : phrase française `say -v Thomas` lue en boucle par une source `ffmpeg_source` (sans micro).
Compte machine rôle 4 (Meeting manager) ; un rôle 3 (Quick meeting) reçoit 403 à la création de session.

- **SRT : OK.** Session `active` en continu, sous-titres `partial`/`final` exacts mot pour mot,
  ~1 phrase finalisée toutes les 3-5 s, latence de quelques secondes. → défaut de l'appli confirmé.
- **RTMP : KO.** La session alterne `active`/`ready` toutes les ~3,5 s et les `final` arrivent vides
  (connexion qui tombe et se refait). Non creusé : le repli RTMP ne doit pas être considéré comme fiable.
  → L'appli n'utilise que SRT : une session sans point SRT est signalée comme « RTMP non pris en charge ».
- Le script attend désormais qu'OBS soit prêt (code 207 au chargement), comme l'appli.

## Phonetic correction of proper nouns (2026-11-17): promising, NOT tested on real LinTO output yet

`spikes/phonetic-names/` (throwaway). `node spikes/phonetic-names/run.mjs` runs invented cases;
`node spikes/phonetic-names/run.mjs names.txt transcript.(txt|json)` corrects a real transcript (the app's JSON export works).
The 50k-word French frequency list (OpenSubtitles, CC BY-SA 4.0) is downloaded on first run into `.cache/`.

How it matches: every run of 1..(name words + 2) transcribed words, within one phrase (no punctuation inside),
is encoded with talisman's French **sonnex** and compared to each name's code with a Levenshtein distance
(≤ 25 % of the code length; names whose code is under 6 characters must match exactly). Guards: a single
everyday word (or its plural) is never replaced; a run made only of everyday words must sound identical;
a run never starts or ends on an article/preposition.

- Invented mishearings: **21/22**. Fixed: « camille biseul », « lina gora », « linnagora », « linto », « Michel roquard »,
  « saint brieu », « anne idalgo », « jean luc mélanchon », « plougastel daoulas », « kerjan »… Left alone: « macro »,
  « marron », « tiers », « tierce », « bise sur l'œil »… Missed: « Bise œil » for Bizeul (two everyday words, one sound off:
  loosening that rule brings back « ni seuls » → Bizeul).
- False positives, 133k words of French Wikipedia with the same 13 names: 10 before the guards, **1 after** (« Sant Brieg »,
  the Breton name, → Saint-Brieuc).
- Speed: ~0.4 ms per segment with 13 names; ~0.5 ms per word with 312 names (naive loop, no index). Fine for finals.
- Not looked at: partials (would flicker), translations (made server-side from the wrong text), names in other languages
  (sonnex is French-only), capitalisation-only fixes.

Server-side alternative: linto-stt's Whisper engine (faster-whisper backend) has a `HOTWORDS` env var, read once at start,
for the whole server; the streaming config only carries `sample_rate` and `language`, so no per-session list without
changes in linto-stt and the LinTO session services.
- First real LinTO test (app build): « Ici, les Moulineaux. » for Issy-les-Moulineaux was missed because the comma ended the
  phrase. Commas no longer end a phrase (LinTO puts them anywhere); `. ! ? ; :` still do. Wikipedia false positives unchanged (1).
- « chez l'LINAGORA » : no elision before a consonant in French, so an elided word in front of a listed name starting
  with a consonant is undone (« l' » dropped, « d' » → « de », « qu' » → « que »…), even when LinTO spelled the name right.
- « Camille Bizzle … à Issy-les-Moulineaux chez LINAGORA » : (1) bug, « Issy-les-Moulineaux chez » (3 edits, allowed for a
  long code) replaced « chez » away because the exact match was skipped as a no-op; exact matches now stay candidates and
  win. (2) Short names (code < 6) now accept one vowel sound inserted/deleted (« Bizzle »), still not substitutions
  (« Basel ») nor consonant edits (« Izel »). Wikipedia false positives unchanged (1).
- « Camille Bizzol » : fixed with « Camille Bizeul » in the list (long code, 1 edit), not with « Bizeul » alone. Short names
  now also accept one vowel sound changed after the first syllable (not « Basel »). Wikipedia false positives unchanged (1).
