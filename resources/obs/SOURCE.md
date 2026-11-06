# OBS Studio bundled with LinTO Live

LinTO Live ships an unmodified copy of **OBS Studio 32.1.0** and drives it as a
separate process over obs-websocket (mere aggregation; LinTO Live is not a derivative
of OBS Studio).

## macOS (Apple Silicon)

- Binary: the official, unmodified `OBS.app` from the release asset
  `OBS-Studio-32.1.0-macOS-Apple.dmg`, copied as-is (not rebuilt, not re-signed; it
  keeps its original "Wizards of OBS LLC" code signature).
- Release: https://github.com/obsproject/obs-studio/releases/tag/32.1.0
- DMG SHA-256: `a5dc3507be161becef5cad8112c4acd168cbc37c80fc186b66ed453b7e9f4fc5`
- Fetch script: `scripts/fetch-obs-macos.sh` in the LinTO Live repository.

## Linux (x86_64)

- Binary: built from the unmodified source below (tag `32.1.0`, commit
  `5533a277e4400203b50114c993f89878d50a27b9`, with its `obs-browser` and `obs-websocket`
  submodules) on Ubuntu 24.04 by `scripts/build-obs-linux.sh` in the LinTO Live repository.
  The exact submodule commits and build host are recorded in `BUILD-INFO.txt` next to this file.
- Configuration: Release, `CMAKE_INSTALL_PREFIX=/obs`, `ENABLE_RELOCATABLE=ON`,
  `ENABLE_BROWSER=ON`, `ENABLE_WEBSOCKET=ON`, `ENABLE_NEW_MPEGTS_OUTPUT=ON`, `ENABLE_AJA=OFF`,
  `ENABLE_WEBRTC=OFF`, `ENABLE_SCRIPTING=OFF`, `ENABLE_VLC=OFF`, `ENABLE_WHATSNEW=OFF`.
- Browser source: OBS's own prebuilt Chromium Embedded Framework
  `cef_binary_6533_linux_x86_64_v6.tar.xz` from https://cdn-fastly.obsproject.com/downloads/
  (SHA-256 `7963335519a19ccdc5233f7334c5ab023026e2f3e9a0cc417007c09d86608146`, as pinned in
  obs-studio's `CMakePresets.json` at that tag). CEF is BSD-licensed.
- Bundled shared libraries in `lib/` (Qt 6, FFmpeg, x264, ...) are unmodified Ubuntu 24.04
  binaries, copied with only their RPATH changed. Their sources are available from Ubuntu
  (`apt-get source <package>`, https://launchpad.net/ubuntu/noble).

## Corresponding source code

- Repository: https://github.com/obsproject/obs-studio
- Tag: `32.1.0`
- Commit: `5533a277e4400203b50114c993f89878d50a27b9`
- Source tarball (with submodules) published with the release:
  https://github.com/obsproject/obs-studio/releases/download/32.1.0/OBS-Studio-32.1.0-Sources.tar.gz
  (SHA-256 `e03440278ef0e14232325e5a7068a18c03f358d949ab20e3d29308b7692ad7e2`)

## License

OBS Studio is free software, licensed under the GNU General Public License, version 2
(or, at your option, any later version). The full license text is in `COPYING`, next
to this file. OBS Studio comes with ABSOLUTELY NO WARRANTY. "OBS" and "OBS Studio" are
trademarks of their owners; LinTO Live is not affiliated with or endorsed by the OBS
Project.
