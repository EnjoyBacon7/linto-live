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
