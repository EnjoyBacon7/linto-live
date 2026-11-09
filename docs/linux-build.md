# Linux build (AppImage with OBS built from source)

LinTO Live for Linux is one AppImage (x86_64) that contains the Electron app and its own OBS
Studio 32.1.0, built from source with the browser source and obs-websocket. Nothing is installed
system-wide; OBS runs hidden with its configuration under the app's `userData`.

- OBS build script: `scripts/build-obs-linux.sh` (Ubuntu 24.04 x86_64 only), plus the small OBS
  patch in `scripts/obs-linux-patches/`
- From macOS (or any Docker host): `npm run dist:linux:docker` (`scripts/build-linux-docker.sh`)
- Electron packaging: `electron-builder.yml` (`linux` section), `npm run dist:linux`
- CI: `.github/workflows/linux.yml` (ubuntu-24.04, OBS build cached on tag + script hash)
- Provenance / license: `resources/obs/SOURCE.md`, `resources/obs/COPYING` in the package

## Building locally (Ubuntu 24.04 x86_64)

Needs ~15 GB of free disk, 30-60 min for the OBS build on 4 cores, `sudo` for apt.

```bash
git clone <this repo> linto-live && cd linto-live
bash scripts/build-obs-linux.sh          # apt deps + OBS build -> vendor/obs/linux/obs
# (SKIP_APT=1 if the build dependencies are already installed; JOBS=<n> to limit parallelism)

# Node 22 (e.g. via nvm), then:
npm ci
npm test
npm run dist:linux                       # -> dist/LinTO-Live-<version>-x86_64.AppImage
```

`vendor/` and `dist/` are git-ignored. Delete `vendor/cache/obs-linux-build` after a successful
build to reclaim ~5 GB (sources, CEF archive, build tree); rerunning the script reuses them.

## Building from macOS (Docker)

```bash
npm run dist:linux:docker                # -> dist/LinTO-Live-<version>-x86_64.AppImage
```

`scripts/build-linux-docker.sh` does the same as above inside an Ubuntu 24.04 x86_64 container:
an image with the OBS build dependencies and Node (`linto-live-linux-build`, ~3 GB in Docker's
disk), then `build-obs-linux.sh` into `vendor/obs/linux` (bind mount), then `npm ci`, typecheck,
unit tests and `dist:linux` on a copy of the repo in `vendor/cache/linux-work` (the Mac's
`node_modules` is never touched). On Apple silicon everything runs under Rosetta: about an hour
for the first OBS build, ~10 min for later runs (`SKIP_OBS=1` skips the OBS step).

What can and cannot be checked under emulation (Docker Desktop's Rosetta, Apple silicon):

- Works: the OBS build, `npm test`, the integration tests against the staged OBS
  (`LINTO_LIVE_IT=1 LINTO_LIVE_OBS=$PWD/vendor/obs/linux/obs/bin/obs xvfb-run npm run test:it`, with
  PulseAudio running and a non-monitor source such as `module-virtual-source`: OBS's
  `pulse_input_capture` hides monitors), the app UI and the projector window under Xvfb.
- Does not work: starting the `.AppImage` file itself (its ELF header carries the AppImage magic,
  which the emulator's binfmt entry rejects: "Exec format error"; extract it with `unsquashfs -o
  <offset>` instead), and the browser source: CEF's GPU process cannot start under Rosetta and
  CEF then aborts OBS ("GPU process isn't usable. Goodbye.", even with `--disable-gpu`). The
  caption overlay must be checked on real x86_64 hardware (checklist section 3).

## What `scripts/build-obs-linux.sh` does

1. Installs OBS's own Ubuntu CI build dependencies (the list in
   `.github/scripts/utils.zsh/setup_ubuntu` + `.github/scripts/.Aptfile` at tag 32.1.0) plus
   `patchelf` and `libnss3`/`libnspr4` (needed to link against CEF; GitHub's runners happen to
   have them, a clean Ubuntu does not).
2. Clones obs-studio at tag `32.1.0`, checks the commit is
   `5533a277e4400203b50114c993f89878d50a27b9`, fetches the `obs-browser` and `obs-websocket`
   submodules, checks the `COPYING` checksum, applies `scripts/obs-linux-patches/*.patch`
   (idempotent) and later ships them in `patches/` next to `COPYING`. The only patch:
   `--minimize-to-tray` keeps OBS's main window hidden even without a system tray. Upstream only
   hides it when a tray is available, so on GNOME without the AppIndicator extension (Fedora,
   Debian...) or under Xvfb, OBS's main window would appear. The app also seeds
   `SysTrayEnabled=false` on Linux, so no OBS icon shows up in the panel either.
3. Downloads OBS's prebuilt CEF for Linux (`cef_binary_6533_linux_x86_64_v6.tar.xz`) and verifies
   the SHA-256 pinned in obs-studio's `CMakePresets.json` at that tag.
4. Configures with the upstream `ubuntu` preset, overridden to: Release,
   `CMAKE_INSTALL_PREFIX=/obs`, `CMAKE_INSTALL_LIBDIR=lib`, `ENABLE_RELOCATABLE=ON`, browser on
   (`CEF_ROOT_DIR`), websocket on, new MPEG-TS output on, AJA/WebRTC/scripting/VLC/What's New off.
   Builds, then `DESTDIR=vendor/obs/linux cmake --install --strip`, giving
   `vendor/obs/linux/obs/{bin,lib,lib/obs-plugins,share/obs}`.
   - OBS looks for its plugins and data relative to its executable (`bin/../lib/obs-plugins`,
     `bin/../share/obs`), so the tree runs from anywhere, including the read-only AppImage mount.
   - The `/obs` prefix never exists on user machines, so OBS's compiled-in fallback paths cannot
     load a system-wide OBS's plugins.
   - The debug info of OBS's prebuilt CEF binaries is stripped (`libcef.so`: 1.9 GB -> ~350 MB;
     the staged tree is ~740 MB, the AppImage ~390 MB).
5. Copies the Qt platform (`xcb` only, the app forces `QT_QPA_PLATFORM=xcb`), xcb-GL, image-format,
   icon-engine and input-context plugins into `lib/qt6/plugins` and writes `bin/qt.conf`.
6. Bundles the dependency closure of every OBS binary/plugin into `lib/`, except libraries the host
   must provide: the AppImage project's `excludelist` (glibc, libstdc++, GL/EGL, X11/xcb core,
   ALSA/JACK/PipeWire, fontconfig/freetype/harfbuzz, ... pinned commit + checksum) and a short
   extra list (GLib/GIO, D-Bus, udev/systemd, PulseAudio, VA-API/VDPAU, Vulkan loader, GPU
   drivers). Excluded libraries are not traversed. OBS's prebuilt CEF files are shipped as-is;
   their dependencies (NSS, ATK, CUPS, ...) come from the host.
7. Sets `DT_RPATH` with patchelf (`bin/*` -> `$ORIGIN/../lib`, `lib/*` -> `$ORIGIN`,
   `lib/obs-plugins/*` -> `$ORIGIN:$ORIGIN/..`, Qt plugins -> `$ORIGIN/../../..`). `DT_RPATH`
   (not `RUNPATH`) wins over `LD_LIBRARY_PATH`; the app also strips the AppImage's
   `$APPDIR/usr/lib` from `LD_LIBRARY_PATH` before spawning OBS (`src/main/paths.ts`).
8. Fails if any binary still has an unresolved library without `LD_LIBRARY_PATH`, runs
   `obs --version`, copies `COPYING` and writes `BUILD-INFO.txt` (commits, CEF archive, build host).

In the packaged app, the tree lands in `<AppImage>/resources/obs/`, and the app starts
`resources/obs/bin/obs` (`src/main/obs/locate.ts`). Unlike macOS, there is no copy out of the
package: OBS runs directly from the AppImage's read-only FUSE mount.

## Verification checklist (Task 17 Step 4: to run by hand)

Run on a clean Ubuntu 24.04 desktop VM, X11 session ("Ubuntu on Xorg" at the login screen), with
a webcam or capture card and a microphone attached if available. Use the AppImage artifact from CI
(`LinTO-Live-linux-x86_64`) or a local build. Tick every box; note anything else in the PR.

### 0. Preparation

- [ ] `ls ~/.config/obs-studio` reports "No such file or directory" (if it exists because OBS
      was installed before, note `stat -c %Y ~/.config/obs-studio` and compare at the end).
- [ ] `sudo apt install libfuse2t64` if the AppImage complains about FUSE (Ubuntu 24.04 ships
      without libfuse2).

### 1. The AppImage runs

- [ ] `chmod +x LinTO-Live-*.AppImage && ./LinTO-Live-*.AppImage` opens the LinTO Live window
      (if Electron aborts with a sandbox / user-namespace error from Ubuntu's AppArmor policy,
      retry with `--no-sandbox` and report it: see "Known risks").
- [ ] Log in, pick a session, start: no OBS window, no OBS tray icon or dialog, no first-run
      wizard ever appears; `ps aux | grep resources/obs/bin/obs` shows OBS running from
      `/tmp/.mount_*/resources/obs/bin/obs`.
- [ ] The LinTO Live tray icon (light screen with caption lines; a red dot while live) is visible
      in the top bar, its menu works; the dock / taskbar shows the LinTO Live icon for the window.
- [ ] Without a keyring (e.g. a session without gnome-keyring): logging in still works and
      survives a restart (the app logs « No usable keyring (basic_text) » and stores the token
      obfuscated only).
- [ ] Closing the main window during a show minimises it (it stays in the taskbar).
- [ ] Démarrer opens the output window (an OBS projector window, not fullscreen) for you to drag
      to the projector / capture screen. Close it, then Fenêtre › « Afficher la fenêtre de sortie »
      (Ctrl+1) reopens one. Arrêter leaves it open, black.
- [ ] Right-click the output window: OBS's menu offers « Plein écran » (fullscreen on a chosen
      screen). Pick the screen it is on and note in the PR whether it goes fullscreen there, and
      whether Échap / the same menu brings it back to a window.
- [ ] `cat /proc/$(pgrep -f resources/obs/bin/obs | head -1)/maps | grep -c '/tmp/.mount_.*/resources/obs/lib/'`
      is > 0 and `... | grep -E 'libQt6Core|libavcodec|libobs'` only shows paths inside
      `/tmp/.mount_*/resources/obs/lib` (bundled libs are really used).
- [ ] OBS log (`~/.config/LinTO Live/obs-home/config/obs-studio/logs/`, newest file) shows
      `Loaded module 'obs-browser.so'`, `Loaded module 'obs-websocket.so'`, `v4l2`, `pulse`, and no
      `Failed to load module` for those.
- [ ] Nothing was written next to the binary: the mount is read-only, so any attempt would show
      as an error in that log (`grep -i 'read-only' <log>` is empty).

### 2. Integration tests against the bundled OBS

```bash
./LinTO-Live-*.AppImage --appimage-extract           # -> ./squashfs-root
git clone <this repo> && cd linto-live && npm ci
LINTO_LIVE_IT=1 LINTO_LIVE_OBS="$PWD/../squashfs-root/resources/obs/bin/obs" npm run test:it
```

- [ ] Both integration tests pass (`ObsProcess`, `ObsController`: input kinds include
      `v4l2_input`, `pulse_input_capture`, `browser_source`; at least one audio device; screenshot).

### 3. The browser source renders the overlay

- [ ] During a live session with captions arriving, the output window / preview shows the caption
      text over the video.
- [ ] Without live captions, `npx tsx scripts/overlay-demo.ts` (from the repo clone of step 2)
      prints an overlay URL and loops through the messages the app sends (`partial` / `final` text,
      words corrected by later partials, a partial long enough to fill both lines, then `reset`).
      Open that URL in a browser (or set it as the URL of the scene's browser source): the black
      band shows the text on at most two lines, words already placed do not jump, and the band
      disappears on `reset`.
- [ ] A screenshot of the scene (app preview, or `GetSourceScreenshot` on scene `LinTO Live`) has
      non-black pixels in the caption area (bottom of the frame) while the video source is black /
      absent.

### 4. Isolation

- [ ] After a full run (start, captions, stop, quit), `~/.config/obs-studio` still does not exist
      (or its mtime is unchanged), and `~/.cache/obs-studio` was not created.
- [ ] OBS's config and cache are under `~/.config/LinTO Live/obs-home/{config,cache}`.

### 5. Uninstall

- [ ] In-app uninstall: afterwards the AppImage file itself is gone (moved to the trash, per
      Task 15), and so is every Task 15 Linux path: `~/.config/LinTO Live` (userData, includes
      `obs-home`), `~/.cache/LinTO Live`, and `~/.local/share/applications/*linto-live*.desktop`
      if a desktop integration created one.
- [ ] No OBS process remains (`pgrep -f resources/obs/bin/obs` is empty), `~/.config/obs-studio`
      still absent.

## Known risks (what to look at first if the checklist fails)

- **Electron sandbox on Ubuntu 24.04**: AppArmor restricts unprivileged user namespaces; the
  electron-builder AppImage launcher adds `--no-sandbox` automatically when `unshare -Ur true`
  fails, so it should start. If it does not, that is an Electron/AppImage issue, not OBS.
- **OBS's CEF** runs with `no_sandbox` (set by obs-browser), so `chrome-sandbox` needs no setuid
  bit inside the AppImage.
- **Host libraries left out on purpose** (see step 6 above) must exist on the target. They do on a
  standard Ubuntu 24.04 desktop; a minimal install may lack e.g. `libnss3` (CEF) or
  `libxcb-cursor0`. `ldd squashfs-root/resources/obs/bin/obs | grep 'not found'` and the same on
  `.../lib/obs-plugins/libcef.so` list what is missing.
- **Browser source / CEF without a working GPU process** (VMs without 3D acceleration, broken GPU
  drivers, x86 emulation): Chromium aborts the whole OBS process with « GPU process isn't usable.
  Goodbye. » shortly after the overlay loads; the app then sees OBS restart in a loop. Seen under
  Rosetta; look for that line in OBS's stderr / crash of OBS right after the scene is built.
- **Wayland session**: the app forces `QT_QPA_PLATFORM=xcb`, so OBS runs through XWayland;
  projector placement on the right screen is only guaranteed on X11.
- **Other distributions** are best effort: the tree is built on Ubuntu 24.04 (glibc 2.39) and
  needs at least that glibc.
