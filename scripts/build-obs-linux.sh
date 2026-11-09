#!/usr/bin/env bash
# Builds OBS Studio 32.1.0 from source on Ubuntu 24.04 x86_64 (browser source + obs-websocket)
# and stages a self-contained, relocatable tree in vendor/obs/linux/obs for electron-builder:
#
#   vendor/obs/linux/obs/bin/obs             OBS executable (RPATH $ORIGIN/../lib)
#   vendor/obs/linux/obs/bin/qt.conf         points Qt at the bundled Qt plugins
#   vendor/obs/linux/obs/lib/                libobs + bundled non-system shared libs (Qt6, FFmpeg, ...)
#   vendor/obs/linux/obs/lib/obs-plugins/    OBS modules + OBS's prebuilt CEF (libcef.so, paks, locales)
#   vendor/obs/linux/obs/lib/qt6/plugins/    Qt platform/image/icon plugins
#   vendor/obs/linux/obs/share/obs/          libobs / frontend / plugin data
#   vendor/obs/linux/obs/COPYING             GPLv2 text
#
# OBS finds its plugins and data relative to its own executable (bin/../lib/obs-plugins,
# bin/../share/obs), so the tree works from any location, including a read-only AppImage mount.
# CMAKE_INSTALL_PREFIX is /obs (a path that never exists on user machines) so the compiled-in
# fallback search paths can never pick up a system-wide OBS installation's plugins.
#
# Inputs are pinned: obs-studio tag + commit, CEF archive SHA-256 (from obs-studio's
# CMakePresets.json at that tag), AppImage excludelist commit + SHA-256. The small LinTO Live
# patches in scripts/obs-linux-patches/ are applied to the source and shipped in patches/.
#
# Usage: scripts/build-obs-linux.sh            (installs apt build deps with sudo)
#        SKIP_APT=1 scripts/build-obs-linux.sh (deps already installed)
#        DEPS_ONLY=1 scripts/build-obs-linux.sh (only install the deps)
# From macOS or any other Docker host: scripts/build-linux-docker.sh (OBS + AppImage in a container).
# Env:   WORK_DIR (default vendor/cache/obs-linux-build), JOBS (default nproc)
set -euo pipefail

OBS_VERSION="32.1.0"
OBS_COMMIT="5533a277e4400203b50114c993f89878d50a27b9"
OBS_REPO="https://github.com/obsproject/obs-studio.git"
COPYING_SHA256="8177f97513213526df2cf6184d8ff986c675afb514d4e68a404010521b880643"

# CMakePresets.json @ 32.1.0 -> configurePresets["dependencies"].vendor["obsproject.com/obs-studio"]
#   .dependencies.cef: version 6533, baseUrl https://cdn-fastly.obsproject.com/downloads,
#   hashes["ubuntu-x86_64"], revision["ubuntu-x86_64"] = 6 (file name built as in setup_ubuntu).
CEF_VERSION="6533"
CEF_REVISION="6"
CEF_DIRNAME="cef_binary_${CEF_VERSION}_linux_x86_64"
CEF_FILE="${CEF_DIRNAME}_v${CEF_REVISION}.tar.xz"
CEF_URL="https://cdn-fastly.obsproject.com/downloads/${CEF_FILE}"
CEF_SHA256="7963335519a19ccdc5233f7334c5ab023026e2f3e9a0cc417007c09d86608146"

# Libraries every target desktop provides (glibc, GL/X11 core, audio servers, ...), the list used
# by linuxdeploy/appimagetool. Pinned to a commit and checked.
EXCLUDELIST_COMMIT="15a64c20dc23a0154622ba25829364323903b6b5"
EXCLUDELIST_URL="https://raw.githubusercontent.com/AppImageCommunity/pkg2appimage/${EXCLUDELIST_COMMIT}/excludelist"
EXCLUDELIST_SHA256="50db0f894f34b169c47a5cbc0c17dbab61e9edebca5bc8269a1e6ac1bf4bdad9"

# Additional libraries left to the host on purpose: they talk to host daemons/drivers whose
# ABI must match the host (GPU/VA drivers, D-Bus, udev, PulseAudio/PipeWire, GIO modules).
EXTRA_EXCLUDE_REGEX='^(libglib-2\.0|libgobject-2\.0|libgio-2\.0|libgmodule-2\.0|libgthread-2\.0|libdbus-1|libudev|libsystemd|libpulse|libpulse-simple|libpulsecommon-.*|libva|libva-.*|libvdpau|libvulkan|libnvidia-.*|libcuda|libGLESv2|libEGL_mesa|libGLX_mesa)\.so'

# OBS's prebuilt CEF files: shipped as-is apart from their debug info (not scanned, not patched,
# no RPATH change). CEF's own dependencies
# (NSS, ATK, CUPS, ...) are standard desktop libraries resolved from the host.
CEF_FILES_REGEX='/(libcef\.so|libEGL\.so|libGLESv2\.so|libvk_swiftshader\.so|libvulkan\.so\.1|chrome-sandbox)$'

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK_DIR:-$ROOT/vendor/cache/obs-linux-build}"
DEST_PARENT="$ROOT/vendor/obs/linux"
DEST="$DEST_PARENT/obs"
SRC="$WORK/obs-studio"
DEPS="$WORK/deps"
BUILD="$SRC/build_ubuntu"
JOBS="${JOBS:-$(nproc)}"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
sha_ok() { [[ -f "$1" ]] && [[ "$(sha256sum "$1" | cut -d' ' -f1)" == "$2" ]]; }

[[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]] || die "Linux x86_64 only"
if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  [[ "${ID:-}" == "ubuntu" && "${VERSION_ID:-}" == "24.04" ]] ||
    echo "WARNING: tested on Ubuntu 24.04 only (this is ${PRETTY_NAME:-unknown})" >&2
fi

# ---------------------------------------------------------------------------------------------
# 1. Build dependencies: exactly obs-studio's CI list (.github/scripts/utils.zsh/setup_ubuntu and
#    .github/scripts/.Aptfile @ 32.1.0) + patchelf for the bundling step.
# ---------------------------------------------------------------------------------------------
if [[ -z "${SKIP_APT:-}" ]]; then
  log "Installing build dependencies (apt)"
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ccache cmake curl git jq ninja-build pkg-config patchelf xz-utils ca-certificates \
    build-essential libglib2.0-dev \
    extra-cmake-modules lsb-release dh-cmake \
    libcurl4-openssl-dev \
    libavcodec-dev libavdevice-dev libavfilter-dev libavformat-dev libavutil-dev \
    libswresample-dev libswscale-dev \
    libjansson-dev \
    libx11-xcb-dev \
    libgles2-mesa-dev \
    libwayland-dev \
    libpipewire-0.3-dev \
    libpulse-dev \
    libx264-dev \
    libmbedtls-dev \
    libgl1-mesa-dev \
    uthash-dev \
    libsimde-dev \
    libluajit-5.1-dev python3-dev \
    libx11-dev libxcb-randr0-dev libxcb-shm0-dev libxcb-xinerama0-dev \
    libxcb-composite0-dev libxinerama-dev libxcb1-dev libxcb-xfixes0-dev \
    swig libcmocka-dev libxss-dev libglvnd-dev \
    libxkbcommon-dev libatk1.0-dev libatk-bridge2.0-dev libxcomposite-dev libxdamage-dev \
    libasound2-dev libfdk-aac-dev libfontconfig-dev libfreetype6-dev libjack-jackd2-dev \
    libsndio-dev libspeexdsp-dev libudev-dev libv4l-dev libva-dev libvlc-dev \
    libpci-dev libdrm-dev \
    nlohmann-json3-dev libwebsocketpp-dev libasio-dev libqrcodegencpp-dev \
    libffmpeg-nvenc-dev librist-dev libsrt-openssl-dev \
    qt6-base-dev libqt6svg6-dev qt6-base-private-dev \
    libvpl-dev libvpl2 \
    libnss3 libnspr4
  # libnss3/libnspr4: obs-browser links against OBS's prebuilt libcef.so, which needs them to link;
  # GitHub's runners happen to have them, a clean Ubuntu does not.
fi
# DEPS_ONLY=1: stop after the dependencies (used to bake them into scripts/build-linux-docker.sh's image).
[[ -z "${DEPS_ONLY:-}" ]] || exit 0
for tool in git cmake ninja curl patchelf sha256sum ldd tar strip; do
  command -v "$tool" >/dev/null || die "missing tool: $tool"
done

mkdir -p "$WORK" "$DEPS"

# ---------------------------------------------------------------------------------------------
# 2. Sources: obs-studio at the pinned tag/commit, with the obs-browser and obs-websocket submodules.
# ---------------------------------------------------------------------------------------------
if [[ -d "$SRC/.git" ]] && [[ "$(git -C "$SRC" rev-parse HEAD)" == "$OBS_COMMIT" ]]; then
  log "Reusing obs-studio checkout at $OBS_COMMIT"
else
  log "Cloning obs-studio $OBS_VERSION"
  rm -rf "$SRC"
  git -c advice.detachedHead=false clone --depth 1 --branch "$OBS_VERSION" "$OBS_REPO" "$SRC"
fi
[[ "$(git -C "$SRC" rev-parse HEAD)" == "$OBS_COMMIT" ]] ||
  die "tag $OBS_VERSION is $(git -C "$SRC" rev-parse HEAD), expected $OBS_COMMIT"
git -C "$SRC" submodule update --init --depth 1 plugins/obs-browser plugins/obs-websocket
sha_ok "$SRC/COPYING" "$COPYING_SHA256" || die "unexpected COPYING checksum"

# LinTO Live patches (scripts/obs-linux-patches/*.patch, shipped in patches/ next to COPYING).
# Idempotent: a patch already applied to a reused checkout is left alone.
PATCHES_DIR="$ROOT/scripts/obs-linux-patches"
shopt -s nullglob
PATCHES=("$PATCHES_DIR"/*.patch)
shopt -u nullglob
for patch in "${PATCHES[@]}"; do
  if git -C "$SRC" apply --reverse --check "$patch" 2>/dev/null; then
    echo "already applied: $(basename "$patch")"
  else
    log "Applying $(basename "$patch")"
    git -C "$SRC" apply "$patch"
  fi
done

# ---------------------------------------------------------------------------------------------
# 3. OBS's prebuilt CEF for Linux x86_64 (same archive + checksum as obs-studio's own CI).
# ---------------------------------------------------------------------------------------------
CEF_ARCHIVE="$DEPS/$CEF_FILE"
CEF_ROOT="$DEPS/$CEF_DIRNAME"
if ! sha_ok "$CEF_ARCHIVE" "$CEF_SHA256"; then
  log "Downloading $CEF_URL"
  curl -fL --retry 3 --progress-bar -o "$CEF_ARCHIVE.part" "$CEF_URL"
  mv "$CEF_ARCHIVE.part" "$CEF_ARCHIVE"
fi
sha_ok "$CEF_ARCHIVE" "$CEF_SHA256" || { rm -f "$CEF_ARCHIVE"; die "CEF checksum mismatch"; }
if [[ ! -f "$CEF_ROOT/Release/libcef.so" ]]; then
  log "Extracting CEF"
  rm -rf "$CEF_ROOT" && mkdir -p "$CEF_ROOT"
  XZ_OPT=-T0 tar --strip-components 1 -xJf "$CEF_ARCHIVE" -C "$CEF_ROOT"
fi
[[ -f "$CEF_ROOT/build/libcef_dll_wrapper/libcef_dll_wrapper.a" ]] || die "CEF wrapper missing"

# ---------------------------------------------------------------------------------------------
# 4. Configure / build / install. Based on the "ubuntu" preset (Ninja, AJA off, WebRTC off),
#    overridden to Release, a flat lib/ dir and a relocatable layout.
# ---------------------------------------------------------------------------------------------
log "Configuring obs-studio"
cd "$SRC"
cmake -S "$SRC" --preset ubuntu \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_COMPILE_WARNING_AS_ERROR=OFF \
  -DCMAKE_INSTALL_PREFIX=/obs \
  -DCMAKE_INSTALL_LIBDIR=lib \
  -DENABLE_RELOCATABLE=ON \
  -DENABLE_PORTABLE_CONFIG=OFF \
  -DENABLE_BROWSER=ON \
  -DCEF_ROOT_DIR="$CEF_ROOT" \
  -DENABLE_WEBSOCKET=ON \
  -DENABLE_AJA=OFF \
  -DENABLE_WEBRTC=OFF \
  -DENABLE_NEW_MPEGTS_OUTPUT=ON \
  -DENABLE_SCRIPTING=OFF \
  -DENABLE_VLC=OFF \
  -DENABLE_WHATSNEW=OFF

log "Building obs-studio ($JOBS jobs)"
cmake --build "$BUILD" --config Release --parallel "$JOBS"

log "Installing into $DEST"
rm -rf "$DEST_PARENT"
mkdir -p "$DEST_PARENT"
DESTDIR="$DEST_PARENT" cmake --install "$BUILD" --config Release --strip
[[ -x "$DEST/bin/obs" ]] || die "install did not produce $DEST/bin/obs (prefix must be /obs)"
[[ -f "$DEST/lib/obs-plugins/obs-browser.so" ]] || die "obs-browser plugin missing"
[[ -f "$DEST/lib/obs-plugins/obs-websocket.so" ]] || die "obs-websocket plugin missing"
[[ -f "$DEST/lib/obs-plugins/libcef.so" ]] || die "CEF not installed next to obs-browser"
[[ -d "$DEST/share/obs/libobs" ]] || die "libobs data missing"

# Development files are not needed at runtime.
rm -rf "$DEST/include" "$DEST/lib/cmake" "$DEST/lib/pkgconfig"

# OBS's prebuilt CEF binaries carry their debug info (libcef.so alone is ~1.9 GB, ~350 MB without):
# drop it, as OBS's own Linux packages do. Code and symbols used at runtime are untouched.
while IFS= read -r -d '' f; do
  strip --strip-debug "$f"
done < <(find "$DEST/lib/obs-plugins" -maxdepth 1 -type f \( -name 'libcef.so' -o -name 'libEGL.so' \
  -o -name 'libGLESv2.so' -o -name 'libvk_swiftshader.so' -o -name 'libvulkan.so.1' \) -print0)

# Replace intra-tree symlinks (e.g. libobs.so.0 -> libobs.so.30) by real files: the tree is
# copied by electron-builder and packed into squashfs; plain files avoid any symlink handling.
while IFS= read -r -d '' link; do
  target="$(readlink -f "$link")"
  if [[ -f "$target" ]]; then
    cp --remove-destination "$target" "$link"
  else
    rm -f "$link"
  fi
done < <(find "$DEST" -type l -print0)

# ---------------------------------------------------------------------------------------------
# 5. Qt plugins + qt.conf (Qt would otherwise load the host's Qt plugins against our Qt libs).
# ---------------------------------------------------------------------------------------------
log "Bundling Qt plugins"
qtcore="$(ldd "$DEST/bin/obs" | awk '$1 ~ /^libQt6Core\.so/ { print $3 }')"
[[ -n "$qtcore" ]] || die "cannot locate libQt6Core used by obs"
QT_PLUGINS="${QT_PLUGINS_DIR:-$(dirname "$(readlink -f "$qtcore")")/qt6/plugins}"
[[ -f "$QT_PLUGINS/platforms/libqxcb.so" ]] || die "Qt xcb platform plugin not found in $QT_PLUGINS"
mkdir -p "$DEST/lib/qt6/plugins/platforms"
cp -L "$QT_PLUGINS/platforms/libqxcb.so" "$DEST/lib/qt6/plugins/platforms/"
for dir in xcbglintegrations imageformats iconengines platforminputcontexts; do
  shopt -s nullglob
  plugins=("$QT_PLUGINS/$dir"/*.so)
  shopt -u nullglob
  if ((${#plugins[@]} > 0)); then
    mkdir -p "$DEST/lib/qt6/plugins/$dir"
    cp -L "${plugins[@]}" "$DEST/lib/qt6/plugins/$dir/"
  fi
done
cat > "$DEST/bin/qt.conf" <<'EOF'
[Paths]
Prefix = ..
Plugins = lib/qt6/plugins
EOF

# ---------------------------------------------------------------------------------------------
# 6. Bundle the shared-library closure (minus the excludelist) into lib/ and set RPATHs.
# ---------------------------------------------------------------------------------------------
log "Bundling shared libraries"
EXCLUDELIST="$DEPS/excludelist"
if ! sha_ok "$EXCLUDELIST" "$EXCLUDELIST_SHA256"; then
  curl -fsSL --retry 3 -o "$EXCLUDELIST" "$EXCLUDELIST_URL"
fi
sha_ok "$EXCLUDELIST" "$EXCLUDELIST_SHA256" || die "excludelist checksum mismatch"
mapfile -t EXCLUDED < <(sed -e 's/#.*//' -e 's/[[:space:]]//g' "$EXCLUDELIST" | grep -v '^$')

is_excluded() {
  local name="$1" e
  [[ "$name" =~ $EXTRA_EXCLUDE_REGEX ]] && return 0
  for e in "${EXCLUDED[@]}"; do [[ "$name" == "$e" ]] && return 0; done
  return 1
}
is_elf() { [[ "$(head -c 4 "$1" 2>/dev/null | od -An -c | tr -d ' ')" == '177ELF' ]]; }

# All ELF files we own (everything except OBS's prebuilt CEF binaries).
own_elves() {
  find "$DEST" -type f \( -perm -u+x -o -name '*.so' -o -name '*.so.*' \) -print0 |
    while IFS= read -r -d '' f; do
      [[ "$f" =~ $CEF_FILES_REGEX ]] && continue
      is_elf "$f" && printf '%s\0' "$f"
    done
}

SEARCH_PATH="$DEST/lib:$DEST/lib/obs-plugins"
# Walk direct dependencies (DT_NEEDED) breadth-first, resolving each one with ldd as the loader
# would. Excluded libraries are neither copied nor traversed: their own dependencies belong to
# the host as well.
declare -A seen=()
queue=()
while IFS= read -r -d '' elf; do queue+=("$elf"); done < <(own_elves)
missing=0
bundled=0
while ((${#queue[@]} > 0)); do
  elf="${queue[0]}"
  queue=("${queue[@]:1}")
  declare -A resolved=()
  while read -r name arrow path _; do
    [[ "$arrow" == "=>" ]] && resolved["$name"]="$path"
  done < <(LD_LIBRARY_PATH="$SEARCH_PATH" ldd "$elf" 2>/dev/null || true)
  while read -r name; do
    [[ -n "$name" ]] || continue
    [[ -n "${seen[$name]:-}" ]] && continue
    seen["$name"]=1
    is_excluded "$name" && continue
    path="${resolved[$name]:-not}"
    if [[ "$path" == "not" ]]; then
      echo "unresolved dependency of ${elf#"$DEST"/}: $name" >&2
      missing=1
      continue
    fi
    [[ "$path" == "$DEST"/* ]] && continue
    cp -L "$path" "$DEST/lib/$name"
    chmod 0755 "$DEST/lib/$name"
    bundled=$((bundled + 1))
    queue+=("$DEST/lib/$name")
  done < <(patchelf --print-needed "$elf")
  unset resolved
done
echo "bundled $bundled libraries into lib/"
[[ $missing -eq 0 ]] || die "unresolved shared library dependencies (see above)"

log "Setting RPATHs"
# DT_RPATH (--force-rpath) rather than DT_RUNPATH: DT_RPATH takes precedence over
# LD_LIBRARY_PATH, which AppImage launchers like to set.
while IFS= read -r -d '' elf; do
  dir="$(dirname "$elf")"
  rel="$(realpath --relative-to="$dir" "$DEST/lib")"
  if [[ "$rel" == "." ]]; then
    rpath='$ORIGIN'
  elif [[ "$dir" == "$DEST/lib/obs-plugins" ]]; then
    rpath="\$ORIGIN:\$ORIGIN/$rel" # CEF lives next to obs-browser
  else
    rpath="\$ORIGIN/$rel"
  fi
  patchelf --force-rpath --set-rpath "$rpath" "$elf"
done < <(own_elves)

# ---------------------------------------------------------------------------------------------
# 7. Sanity checks: nothing unresolved without LD_LIBRARY_PATH, OBS starts far enough to print
#    its version, license + provenance recorded.
# ---------------------------------------------------------------------------------------------
log "Checking the staged tree"
bad=0
while IFS= read -r -d '' elf; do
  out="$(env -u LD_LIBRARY_PATH ldd "$elf" 2>&1 || true)"
  if grep -q 'not found' <<<"$out"; then
    echo "still unresolved: ${elf#"$DEST"/}" >&2
    grep 'not found' <<<"$out" >&2
    bad=1
  fi
done < <(own_elves)
[[ $bad -eq 0 ]] || die "staged tree has unresolved libraries"
if version="$(env -u LD_LIBRARY_PATH timeout 30 "$DEST/bin/obs" --version 2>&1)"; then
  echo "$version"
else
  echo "WARNING: 'obs --version' failed (expected without a display on some hosts)" >&2
fi

cp "$SRC/COPYING" "$DEST/COPYING"
rm -rf "$DEST/patches"
if ((${#PATCHES[@]} > 0)); then
  mkdir -p "$DEST/patches"
  cp "${PATCHES[@]}" "$DEST/patches/"
fi
cat > "$DEST/BUILD-INFO.txt" <<EOF
OBS Studio $OBS_VERSION built from source by scripts/build-obs-linux.sh (LinTO Live)
obs-studio commit: $OBS_COMMIT
obs-browser commit: $(git -C "$SRC/plugins/obs-browser" rev-parse HEAD)
obs-websocket commit: $(git -C "$SRC/plugins/obs-websocket" rev-parse HEAD)
CEF: $CEF_FILE (sha256 $CEF_SHA256)
LinTO Live patches: $(cd "$PATCHES_DIR" && ls -1 -- *.patch 2>/dev/null | tr '\n' ' ')
Build host: ${PRETTY_NAME:-unknown}, $(uname -srm)
EOF

du -sh "$DEST"
log "OBS $OBS_VERSION ready in $DEST (executable: $DEST/bin/obs)"
