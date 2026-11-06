#!/usr/bin/env bash
# Fetches the official, unmodified OBS Studio 32.1.0 build for macOS Apple Silicon
# into vendor/obs/macos/OBS.app (+ COPYING), for electron-builder extraResources.
# The DMG's SHA-256 is pinned below (matches the checksum published in the release notes).
set -euo pipefail

OBS_VERSION="32.1.0"
OBS_COMMIT="5533a277e4400203b50114c993f89878d50a27b9"
DMG_NAME="OBS-Studio-${OBS_VERSION}-macOS-Apple.dmg"
DMG_URL="https://github.com/obsproject/obs-studio/releases/download/${OBS_VERSION}/${DMG_NAME}"
DMG_SHA256="a5dc3507be161becef5cad8112c4acd168cbc37c80fc186b66ed453b7e9f4fc5"
COPYING_URL="https://raw.githubusercontent.com/obsproject/obs-studio/${OBS_COMMIT}/COPYING"
COPYING_SHA256="8177f97513213526df2cf6184d8ff986c675afb514d4e68a404010521b880643"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="$ROOT/vendor/cache"
DEST="$ROOT/vendor/obs/macos"
DMG="$CACHE/$DMG_NAME"

[[ "$(uname -s)" == "Darwin" ]] || { echo "macOS only" >&2; exit 1; }
mkdir -p "$CACHE" "$DEST"

sha_ok() { [[ -f "$1" ]] && [[ "$(shasum -a 256 "$1" | cut -d' ' -f1)" == "$2" ]]; }

if ! sha_ok "$DMG" "$DMG_SHA256"; then
  echo "Downloading $DMG_URL"
  curl -fL --progress-bar --retry 3 -o "$DMG.part" "$DMG_URL"
  mv "$DMG.part" "$DMG"
fi
if ! sha_ok "$DMG" "$DMG_SHA256"; then
  echo "SHA-256 mismatch for $DMG (expected $DMG_SHA256)" >&2
  rm -f "$DMG"
  exit 1
fi
echo "DMG SHA-256 OK"

MNT="$(mktemp -d /tmp/obs-dmg.XXXXXX)"
cleanup() { hdiutil detach "$MNT" -quiet >/dev/null 2>&1 || true; rmdir "$MNT" 2>/dev/null || true; }
trap cleanup EXIT
hdiutil attach "$DMG" -nobrowse -readonly -noautoopen -mountpoint "$MNT" -quiet

rm -rf "$DEST/OBS.app"
ditto "$MNT/OBS.app" "$DEST/OBS.app"
cleanup
trap - EXIT

codesign --verify --deep --strict "$DEST/OBS.app"
echo "OBS.app signature intact"

curl -fsSL --retry 3 -o "$DEST/COPYING" "$COPYING_URL"
if ! sha_ok "$DEST/COPYING" "$COPYING_SHA256"; then
  echo "SHA-256 mismatch for COPYING" >&2
  exit 1
fi

echo "OBS $OBS_VERSION ready in $DEST"
