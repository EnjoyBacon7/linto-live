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
