import { app, dialog, ipcMain, shell, BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir, userInfo } from 'os'
import { join } from 'path'
import type { GitChange, ServerInput, SessionSpec, Settings, Space, StatRange } from '@shared/types'
import { store } from './store'
import * as ssh from './ssh'
import { listAgents } from './agents'
import { foregroundProcesses, killSession, resizeSession, startSession, writeSession } from './sessions'
import * as git from './git'
import * as beszel from './beszel'
import { listDir, readFile, watchRoot, writeFile } from './files'
import { getActivity, getStatuses, setTabTitle } from './events'
import { mcpEndpoint } from './mcp'
import { parseSshConfig } from './sshConfig'
import { shellEnv, which } from './shellEnv'
import { isSafeExternalUrl } from './links'
import { closeDetached, detachTab, focusDetached, mainWindow, type DetachRequest } from './windows'
import { checkForUpdates, installUpdate, rescheduleUpdates, updateState } from './updater'

export function registerIpc(): void {
  const h = ipcMain.handle.bind(ipcMain)

  h('app:info', () => ({
    ...(() => {
      const { url, token } = mcpEndpoint()
      return { mcpUrl: url, mcpToken: token }
    })(),
    platform: process.platform,
    home: homedir(),
    version: app.getVersion()
  }))

  // spaces / settings
  h('spaces:get', () => store.getSpaces())
  h('spaces:set', (e, spaces: Space[], activeSpaceId?: string) => {
    // only the main window owns the layout; detached windows hold a read-only copy
    if (e.sender !== mainWindow()?.webContents) return
    store.setSpaces(spaces, activeSpaceId)
    for (const s of spaces) if (existsSync(s.root)) watchRoot(s.root)
  })
  h('settings:get', () => store.getSettings())
  h('settings:set', (_e, patch: Partial<Settings>) => {
    const next = store.setSettings(patch)
    if ('autoUpdate' in patch) rescheduleUpdates()
    return next
  })
  h('dialog:folder', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  h('dialog:file', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile', 'showHiddenFiles'], defaultPath: join(homedir(), '.ssh') })
    return r.canceled ? null : r.filePaths[0]
  })
  h('shell:reveal', (_e, p: string) => shell.showItemInFolder(p))
  h('shell:open', (_e, url: string) => {
    if (isSafeExternalUrl(url)) return shell.openExternal(url)
  })

  // agents & status
  h('agents:list', () => listAgents())
  h('status:get', () => getStatuses())
  h('tab:title', (_e, tabId: string, title: string) => setTabTitle(tabId, title))

  // terminal sessions
  h('term:start', (_e, spec: SessionSpec) => startSession(spec))
  ipcMain.on('term:write', (_e, id: string, data: string) => writeSession(id, data))
  ipcMain.on('term:resize', (_e, id: string, cols: number, rows: number) => resizeSession(id, cols, rows))
  h('term:kill', (_e, id: string) => killSession(id))
  h('term:foreground', (_e, ids: string[]) => foregroundProcesses(ids))
  // save a pasted image to a temp file so it can be pasted as a path
  h('clipboard:saveImage', (_e, bytes: Uint8Array, mime: string) => {
    const ext = (mime.split('/')[1] ?? 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'png'
    const dir = join(app.getPath('temp'), 'orbit-paste')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `image-${Date.now()}.${ext}`)
    writeFileSync(file, Buffer.from(bytes))
    return file
  })

  // local files
  h('fs:list', (_e, dir: string) => listDir(dir))
  h('fs:read', (_e, p: string) => readFile(p))
  h('fs:write', (_e, p: string, c: string) => writeFile(p, c))
  h('fs:watch', (_e, root: string) => watchRoot(root))

  // servers
  h('servers:list', () => store.getServers())
  h('servers:secret', (_e, id: string) => {
    const s = store.getSecret(id)
    // only reveal which fields are set, never the values
    return { password: !!s.password, privateKey: !!s.privateKey, passphrase: !!s.passphrase, beszelPassword: !!s.beszelPassword }
  })
  h('beszel:systems', (_e, serverId: string | undefined, creds: { url: string; email: string; password?: string }) =>
    beszel.listSystems(serverId, creds)
  )
  h('beszel:snapshot', (_e, serverId: string, range?: StatRange) => beszel.snapshot(serverId, range))
  h('servers:save', (_e, input: ServerInput) => {
    if (input.id) {
      ssh.disconnect(input.id)
      beszel.invalidate(input.id)
    }
    return store.upsertServer(input)
  })
  h('servers:remove', (_e, id: string) => {
    ssh.disconnect(id)
    store.removeServer(id)
  })
  h('servers:test', (_e, id: string) => ssh.testConnection(id))
  h('servers:importSshConfig', () => {
    const file = join(homedir(), '.ssh', 'config')
    if (!existsSync(file)) return 0
    const hosts = parseSshConfig(readFileSync(file, 'utf8'), userInfo().username)
    const existing = new Set(store.getServers().map((s) => s.name))
    let added = 0
    const byName = new Map<string, string>()
    for (const h of hosts) {
      if (existing.has(h.name)) continue
      const s = store.upsertServer({
        name: h.name, host: h.host, port: h.port, username: h.username,
        auth: h.keyPath ? 'key' : 'agent', keyPath: h.keyPath, tags: ['ssh-config'], color: '#7c8cff'
      })
      byName.set(h.name, s.id)
      added++
    }
    // resolve ProxyJump after all hosts exist
    for (const h of hosts) {
      const id = byName.get(h.name)
      const jump = h.proxyJump && store.getServer(h.proxyJump.split(',')[0])
      if (id && jump) store.upsertServer({ ...store.getServer(id)!, jumpServerId: jump.id })
    }
    return added
  })

  // sftp
  h('sftp:home', (_e, id: string) => ssh.remoteHome(id))
  h('sftp:list', (_e, id: string, p: string) => ssh.sftpList(id, p))
  h('sftp:read', (_e, id: string, p: string) => ssh.sftpRead(id, p))
  h('sftp:write', (_e, id: string, p: string, c: string) => ssh.sftpWrite(id, p, c))

  // git
  h('git:status', (_e, cwd: string) => git.status(cwd))
  h('git:branches', (_e, cwd: string) => git.branches(cwd))
  h('git:fileVersions', (_e, cwd: string, change: GitChange) => git.fileVersions(cwd, change))
  h('git:commit', (_e, cwd: string, message: string, paths: string[]) => git.commit(cwd, message, paths))
  h('git:pull', (_e, cwd: string) => git.pull(cwd))
  h('git:push', (_e, cwd: string) => git.push(cwd))
  h('git:checkout', (_e, cwd: string, branch: string, create: boolean) => git.checkout(cwd, branch, create))
  h('git:init', (_e, cwd: string) => git.init(cwd))
  h('git:watch', (_e, cwd: string) => git.watch(cwd))

  // windows
  h('window:detach', (_e, req: DetachRequest) => detachTab(req))
  h('window:closeDetached', (_e, tabId: string) => closeDetached(tabId))
  h('window:focusDetached', (_e, tabId: string) => focusDetached(tabId))

  // updates
  h('updates:state', () => updateState())
  h('updates:check', () => checkForUpdates(true))
  h('updates:install', () => installUpdate())

  // activity / mcp
  h('activity:get', () => getActivity())
  h('mcp:registerGlobal', async () => {
    const claude = which('claude')
    if (!claude) throw new Error('Claude Code CLI not found in PATH')
    const { url, token } = mcpEndpoint()
    const run = (args: string[]): Promise<string> =>
      new Promise((res, rej) =>
        execFile(claude, args, { env: shellEnv() as NodeJS.ProcessEnv }, (err, stdout, stderr) =>
          err ? rej(new Error(stderr || err.message)) : res(stdout)
        )
      )
    await run(['mcp', 'remove', '-s', 'user', 'orbit']).catch(() => {})
    return run(['mcp', 'add', '-s', 'user', '--transport', 'http', 'orbit', url, '--header', `Authorization: Bearer ${token}`])
  })
}
