/**
 * Auto-update from GitHub Releases.
 *
 * Windows / Linux: electron-updater (NSIS, AppImage, deb, rpm) reading latest.yml / latest-linux.yml.
 * macOS: Squirrel.Mac only accepts updates signed with the same Apple Developer ID, and our
 * builds are ad-hoc signed, so on macOS we download the release .zip ourselves, verify its
 * sha512 from latest-mac.yml, and swap the app bundle after Orbit quits.
 */
import { app, dialog, net, shell } from 'electron'
import { spawn, execFile } from 'child_process'
import { createHash } from 'crypto'
import { accessSync, constants, createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '@shared/types'
import { emit } from './events'
import { store } from './store'
import { compareVersions, parseLatestYml } from './updateInfo'

const OWNER = 'FlaShadowK'
const REPO = 'orbit'
const RELEASES_URL = `https://github.com/${OWNER}/${REPO}/releases/latest`
/** where latest-mac.yml and the zips are downloaded from (overridable to test updates against a local server) */
const FEED_URL = process.env.ORBIT_UPDATE_FEED || `${RELEASES_URL}/download`
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000
const IS_MAC = process.platform === 'darwin'

let state: UpdateState = { status: 'idle' }
let timer: NodeJS.Timeout | undefined
/** macOS: the extracted, verified new Orbit.app waiting to be swapped in */
let stagedApp: string | undefined

function setState(next: UpdateState): void {
  state = next
  emit({ type: 'update', state })
}

export function updateState(): UpdateState {
  return state
}

export function initUpdater(): void {
  if (!app.isPackaged) return // dev builds don't update themselves
  if (!IS_MAC) {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('checking-for-update', () => setState({ status: 'checking' }))
    autoUpdater.on('update-not-available', () => setState({ status: 'none' }))
    autoUpdater.on('update-available', (i) => setState({ status: 'downloading', version: i.version, percent: 0 }))
    autoUpdater.on('download-progress', (p) =>
      setState({ status: 'downloading', version: state.version ?? '', percent: Math.round(p.percent) })
    )
    autoUpdater.on('update-downloaded', (i) => setState({ status: 'ready', version: i.version }))
    autoUpdater.on('error', (err) => setState({ status: 'error', error: err.message, version: state.version }))
  }
  schedule(10_000)
}

function schedule(delay: number): void {
  clearTimeout(timer)
  if (!app.isPackaged || store.getSettings().autoUpdate === false) return
  timer = setTimeout(() => checkForUpdates(false).finally(() => schedule(CHECK_EVERY_MS)), delay)
}

/** Settings toggle changed: start or stop the periodic check. */
export function rescheduleUpdates(): void {
  schedule(10_000)
}

/** `manual`: started from the menu, so tell the user about "no update" and errors too. */
export async function checkForUpdates(manual: boolean): Promise<void> {
  if (!app.isPackaged) {
    if (manual) dialog.showMessageBox({ message: 'Updates are disabled in development builds.' })
    return
  }
  if (state.status === 'downloading' || state.status === 'checking') return
  if (state.status === 'ready') {
    if (manual) promptRestart()
    return
  }
  try {
    if (IS_MAC) await checkMac()
    else await autoUpdater.checkForUpdates()
  } catch (err) {
    setState({ status: 'error', error: (err as Error).message })
  }
  if (!manual) return
  const s = updateState() // re-read: the check above changed it
  if (s.status === 'none') dialog.showMessageBox({ message: `Orbit ${app.getVersion()} is the latest version.` })
  else if (s.status === 'error') dialog.showMessageBox({ type: 'warning', message: 'Could not check for updates', detail: s.error })
  else if (s.status === 'ready') promptRestart()
}

function promptRestart(): void {
  if (state.status !== 'ready') return
  const version = state.version
  dialog
    .showMessageBox({ message: `Orbit ${version} is ready to install`, detail: 'Restart now to update?', buttons: ['Restart', 'Later'], defaultId: 0 })
    .then((r) => r.response === 0 && installUpdate())
}

export function installUpdate(): void {
  if (state.status !== 'ready') return
  if (!IS_MAC) {
    autoUpdater.quitAndInstall(false, true)
    return
  }
  if (!stagedApp) return
  const current = currentBundle()
  // relaunch with the same command-line flags (e.g. --user-data-dir) as this run
  const args = process.argv.slice(1).filter((a) => !a.startsWith('-psn_'))
  const relaunch = `open -n "$APP"${args.length ? ` --args ${args.map(sh).join(' ')}` : ''}`
  const script = join(app.getPath('temp'), `orbit-update-${Date.now()}.sh`)
  // wait for this process to exit, swap the bundle (rolling back on failure), relaunch
  writeFileSync(
    script,
    `#!/bin/bash
while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done
APP=${sh(current)}
NEW=${sh(stagedApp)}
rm -rf "$APP.old"
if mv "$APP" "$APP.old" && mv "$NEW" "$APP"; then rm -rf "$APP.old"; else [ -d "$APP.old" ] && mv "$APP.old" "$APP"; fi
xattr -dr com.apple.quarantine "$APP" 2>/dev/null
${relaunch}
rm -f "$0"
`,
    { mode: 0o755 }
  )
  spawn('/bin/bash', [script], { detached: true, stdio: 'ignore' }).unref()
  app.quit()
}

const sh = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

/** /Applications/Orbit.app for /Applications/Orbit.app/Contents/MacOS/Orbit */
function currentBundle(): string {
  return dirname(dirname(dirname(app.getPath('exe'))))
}

/** Can we replace our own bundle? Not from a read-only DMG or a translocated (quarantined) copy. */
function canSelfUpdate(): boolean {
  const bundle = currentBundle()
  if (bundle.startsWith('/Volumes/') || bundle.includes('/AppTranslocation/')) return false
  try {
    accessSync(dirname(bundle), constants.W_OK)
    accessSync(bundle, constants.W_OK)
    return true
  } catch {
    return false
  }
}

async function checkMac(): Promise<void> {
  setState({ status: 'checking' })
  const res = await net.fetch(`${FEED_URL}/latest-mac.yml`, { cache: 'no-store' })
  if (res.status === 404) return setState({ status: 'none' }) // no release with update info yet
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`)
  const info = parseLatestYml(await res.text())
  if (compareVersions(info.version, app.getVersion()) <= 0) return setState({ status: 'none', version: info.version })
  const file = info.files.find((f) => f.url.endsWith('.zip') && f.url.includes(`-mac-${process.arch}`))
  if (!file) throw new Error(`Release ${info.version} has no macOS ${process.arch} update`)

  if (!canSelfUpdate()) {
    setState({ status: 'available', version: info.version })
    const r = await dialog.showMessageBox({
      message: `Orbit ${info.version} is available`,
      detail: 'Move Orbit to your Applications folder to get automatic updates. Download the new version now?',
      buttons: ['Download', 'Later'],
      defaultId: 0
    })
    if (r.response === 0) shell.openExternal(RELEASES_URL)
    return
  }

  setState({ status: 'downloading', version: info.version, percent: 0 })
  const dir = join(app.getPath('temp'), `orbit-update-${info.version}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const zip = join(dir, 'update.zip')
  const sha512 = await download(`${FEED_URL}/${file.url}`, zip, file.size, (percent) =>
    setState({ status: 'downloading', version: info.version, percent })
  )
  if (sha512 !== file.sha512) throw new Error('Downloaded update is corrupted (checksum mismatch)')
  await run('/usr/bin/ditto', ['-x', '-k', zip, dir])
  const extracted = join(dir, 'Orbit.app')
  if (!existsSync(extracted)) throw new Error('Update archive does not contain Orbit.app')
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', extracted])
  rmSync(zip, { force: true })
  stagedApp = extracted
  setState({ status: 'ready', version: info.version })
}

async function download(url: string, to: string, size: number | undefined, progress: (percent: number) => void): Promise<string> {
  const res = await net.fetch(url)
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`)
  const total = size ?? Number(res.headers.get('content-length') ?? 0)
  const hash = createHash('sha512')
  const out = createWriteStream(to)
  let got = 0
  let last = -1
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    hash.update(value)
    if (!out.write(value)) await new Promise((r) => out.once('drain', r))
    got += value.length
    const pct = total ? Math.floor((got / total) * 100) : 0
    if (pct !== last) progress((last = pct))
  }
  await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
  return hash.digest('base64')
}

function run(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) =>
    execFile(file, args, (err, _out, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve()))
  )
}
