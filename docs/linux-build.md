# Linux build (AppImage with OBS built from source)

LinTO Live for Linux is one AppImage (x86_64) that contains the Electron app and its own OBS
Studio 32.1.0, built from source with the browser source and obs-websocket. Nothing is installed
system-wide; OBS runs hidden with its configuration under the app's `userData`.

- OBS build script: `scripts/build-obs-linux.sh` (Ubuntu 24.04 x86_64 only)
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

## What `scripts/build-obs-linux.sh` does

1. Installs OBS's own Ubuntu CI build dependencies (the list in
   `.github/scripts/utils.zsh/setup_ubuntu` + `.github/scripts/.Aptfile` at tag 32.1.0) plus
   `patchelf`.
2. Clones obs-studio at tag `32.1.0`, checks the commit is
   `5533a277e4400203b50114c993f89878d50a27b9`, fetches the `obs-browser` and `obs-websocket`
   submodules, checks the `COPYING` checksum.
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
- [ ] Log in, pick a session, start: no OBS window, no OBS tray dialog, no first-run wizard ever
      appears; the projector opens on the chosen output; `ps aux | grep resources/obs/bin/obs`
      shows OBS running from `/tmp/.mount_*/resources/obs/bin/obs`.
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

- [ ] During a live session with captions arriving (or with `scripts/overlay-demo.ts` feeding the
      overlay), the projector / preview shows the caption text over the video.
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
- **Wayland session**: the app forces `QT_QPA_PLATFORM=xcb`, so OBS runs through XWayland;
  projector placement on the right screen is only guaranteed on X11.
- **Other distributions** are best effort: the tree is built on Ubuntu 24.04 (glibc 2.39) and
  needs at least that glibc.
