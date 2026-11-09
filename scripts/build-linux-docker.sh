#!/usr/bin/env bash
# Builds the Linux AppImage (dist/LinTO-Live-<version>-x86_64.AppImage) inside an Ubuntu 24.04
# x86_64 container, from any Docker host, including macOS on Apple silicon (x86_64 emulation,
# Docker Desktop's Rosetta: the first OBS build takes about an hour).
#
#   bash scripts/build-linux-docker.sh
#
# - OBS is built by scripts/build-obs-linux.sh into vendor/obs/linux (bind mount; its work tree
#   vendor/cache/obs-linux-build is reused by later runs: delete it to reclaim ~5 GB).
# - npm ci / electron-builder run on a copy of the repository in vendor/cache/linux-work (git-ignored),
#   so the host's node_modules (macOS Electron) is never touched. Kept on the host rather than in
#   a Docker volume: Docker Desktop's disk is often small.
# - The linto-live-linux-build image (OBS build deps + Node, ~3 GB) can be removed with
#   `docker rmi linto-live-linux-build`.
#
# Env: JOBS (OBS build parallelism, default: all CPUs), SKIP_OBS=1 (reuse vendor/obs/linux as is).
# Note: AppImages cannot be started under Rosetta/qemu emulation (their ELF header carries the
# AppImage magic); test them on a real x86_64 Linux machine.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE=linto-live-linux-build
WORK_HOST="$ROOT/vendor/cache/linux-work"
NODE_VERSION=22.12.0

command -v docker >/dev/null || { echo "docker not found" >&2; exit 1; }

echo "==> Building the $IMAGE image (Ubuntu 24.04 x86_64, OBS build deps, Node $NODE_VERSION)"
# The apt list lives in build-obs-linux.sh: run its dependency step once, inside the image.
docker build --platform linux/amd64 -t "$IMAGE" -f - "$ROOT/scripts" <<EOF
FROM ubuntu:24.04
RUN apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq sudo rsync >/dev/null
COPY build-obs-linux.sh /tmp/build-obs-linux.sh
RUN DEPS_ONLY=1 bash /tmp/build-obs-linux.sh && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz \
    | tar -xJ -C /usr/local --strip-components 1 && node --version
EOF

if [[ -z "${SKIP_OBS:-}" ]]; then
  echo "==> Building OBS (scripts/build-obs-linux.sh)"
  # The script is copied first: editing it on the host while it runs must not affect this build.
  docker run --rm --platform linux/amd64 -v "$ROOT":/src -w /src -e SKIP_APT=1 -e "JOBS=${JOBS:-}" "$IMAGE" \
    bash -c 'cp scripts/build-obs-linux.sh /tmp/b.sh && sed -i "s|^ROOT=.*|ROOT=/src|" /tmp/b.sh && bash /tmp/b.sh'
fi
[[ -x "$ROOT/vendor/obs/linux/obs/bin/obs" ]] || { echo "vendor/obs/linux/obs/bin/obs missing" >&2; exit 1; }

echo "==> npm ci, typecheck, unit tests, AppImage"
mkdir -p "$WORK_HOST" "$ROOT/dist"
docker run --rm --platform linux/amd64 -v "$ROOT":/src:ro -v "$WORK_HOST":/work -v "$ROOT/vendor/obs":/work/vendor/obs:ro \
  -v "$ROOT/dist":/out "$IMAGE" bash -c '
  set -euo pipefail
  rsync -a --delete --exclude /node_modules --exclude /vendor --exclude /dist --exclude /out --exclude /.git \
    --exclude /spikes /src/ /work/
  cd /work
  npm ci --no-audit --no-fund
  npm run typecheck
  npm test
  rm -rf dist
  npm run dist:linux
  cp dist/*.AppImage /out/
  ls -la /out/*.AppImage
'
