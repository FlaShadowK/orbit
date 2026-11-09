#!/usr/bin/env bash
# Build Linux packages (AppImage, deb, rpm) inside a Linux container so node-pty is
# compiled for Linux. Requires Docker (Docker Desktop, colima, OrbStack…).
set -euo pipefail
cd "$(dirname "$0")/.."
ARCH="${ARCH:-amd64}"   # amd64 | arm64
docker run --rm --platform "linux/${ARCH}" \
  -v "$PWD":/src:ro -v "$PWD/dist":/out \
  electronuserland/builder:20 bash -lc '
    set -e
    mkdir -p /build && cd /build
    tar -C /src --exclude=node_modules --exclude=dist --exclude=out --exclude=.git -cf - . | tar -xf -
    npm ci --no-audit --no-fund --ignore-scripts
    # cpu-features is an optional ssh2 speed-up; ssh2 works without it
    rm -rf node_modules/cpu-features
    node scripts/fix-node-pty.cjs
    npx electron-builder install-app-deps
    npm run build
    npx electron-builder --linux --publish never
    cp dist/*.AppImage dist/*.deb dist/*.rpm /out/ 2>/dev/null || true
  '
