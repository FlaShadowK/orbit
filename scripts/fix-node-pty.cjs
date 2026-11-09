// node-pty's prebuilt spawn-helper binaries ship without the executable bit,
// which makes every terminal fail with "posix_spawnp failed" on builds that use
// the prebuilds (e.g. the Intel macOS build). Restore it after install.
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..', 'node_modules', 'node-pty')
for (const dir of ['prebuilds/darwin-x64', 'prebuilds/darwin-arm64', 'build/Release']) {
  const helper = path.join(root, dir, 'spawn-helper')
  if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755)
}
