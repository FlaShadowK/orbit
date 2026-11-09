#!/usr/bin/env bash
# Render build/dmg/background.html → build/background.tiff (1x + 2x, so the DMG window is sharp on Retina).
# macOS only: needs Google Chrome and tiffutil.
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TMP="$(mktemp -d)"
for s in 1 2; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=$s \
    --window-size=660,400 --screenshot="$TMP/bg@$s.png" "file://$PWD/build/dmg/background.html" >/dev/null 2>&1
done
tiffutil -cathidpicheck "$TMP/bg@1.png" "$TMP/bg@2.png" -out build/background.tiff >/dev/null
rm -rf "$TMP"
echo "wrote build/background.tiff"
