import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { OrbitApi } from './index.d'

const inv = (ch: string) => (...args: unknown[]) => ipcRenderer.invoke(ch, ...args)
function listen<T extends unknown[]>(ch: string, cb: (...args: T) => void): () => void {
  const h = (_: unknown, ...args: unknown[]): void => cb(...(args as T))
  ipcRenderer.on(ch, h)
  return () => ipcRenderer.removeListener(ch, h)
}

const api: OrbitApi = {
  info: inv('app:info') as OrbitApi['info'],
  getSpaces: inv('spaces:get') as OrbitApi['getSpaces'],
  setSpaces: inv('spaces:set') as OrbitApi['setSpaces'],
  getSettings: inv('settings:get') as OrbitApi['getSettings'],
  setSettings: inv('settings:set') as OrbitApi['setSettings'],
  pickFolder: inv('dialog:folder') as OrbitApi['pickFolder'],
  pickFile: inv('dialog:file') as OrbitApi['pickFile'],
  reveal: inv('shell:reveal') as OrbitApi['reveal'],
  openExternal: inv('shell:open') as OrbitApi['openExternal'],

  listAgents: inv('agents:list') as OrbitApi['listAgents'],
  getStatuses: inv('status:get') as OrbitApi['getStatuses'],
  setTabTitle: inv('tab:title') as OrbitApi['setTabTitle'],

  termStart: inv('term:start') as OrbitApi['termStart'],
  termWrite: (id, data) => ipcRenderer.send('term:write', id, data),
  termResize: (id, cols, rows) => ipcRenderer.send('term:resize', id, cols, rows),
  termKill: inv('term:kill') as OrbitApi['termKill'],
  saveImage: inv('clipboard:saveImage') as OrbitApi['saveImage'],
  termForeground: inv('term:foreground') as OrbitApi['termForeground'],
  pathForFile: (file) => webUtils.getPathForFile(file),
  onTermData: (cb) => listen('term:data', cb),
  onTermExit: (cb) => listen('term:exit', cb),

  fsList: inv('fs:list') as OrbitApi['fsList'],
  fsRead: inv('fs:read') as OrbitApi['fsRead'],
  fsWrite: inv('fs:write') as OrbitApi['fsWrite'],
  fsWatch: inv('fs:watch') as OrbitApi['fsWatch'],

  listServers: inv('servers:list') as OrbitApi['listServers'],
  serverSecretFlags: inv('servers:secret') as OrbitApi['serverSecretFlags'],
  saveServer: inv('servers:save') as OrbitApi['saveServer'],
  removeServer: inv('servers:remove') as OrbitApi['removeServer'],
  testServer: inv('servers:test') as OrbitApi['testServer'],
  importSshConfig: inv('servers:importSshConfig') as OrbitApi['importSshConfig'],
  beszelSystems: inv('beszel:systems') as OrbitApi['beszelSystems'],
  beszelSnapshot: inv('beszel:snapshot') as OrbitApi['beszelSnapshot'],

  sftpHome: inv('sftp:home') as OrbitApi['sftpHome'],
  sftpList: inv('sftp:list') as OrbitApi['sftpList'],
  sftpRead: inv('sftp:read') as OrbitApi['sftpRead'],
  sftpWrite: inv('sftp:write') as OrbitApi['sftpWrite'],

  git: {
    status: inv('git:status') as OrbitApi['git']['status'],
    branches: inv('git:branches') as OrbitApi['git']['branches'],
    fileVersions: inv('git:fileVersions') as OrbitApi['git']['fileVersions'],
    commit: inv('git:commit') as OrbitApi['git']['commit'],
    pull: inv('git:pull') as OrbitApi['git']['pull'],
    push: inv('git:push') as OrbitApi['git']['push'],
    checkout: inv('git:checkout') as OrbitApi['git']['checkout'],
    init: inv('git:init') as OrbitApi['git']['init'],
    watch: inv('git:watch') as OrbitApi['git']['watch']
  },

  detachTab: inv('window:detach') as OrbitApi['detachTab'],
  closeDetached: inv('window:closeDetached') as OrbitApi['closeDetached'],
  focusDetached: inv('window:focusDetached') as OrbitApi['focusDetached'],

  updateState: inv('updates:state') as OrbitApi['updateState'],
  checkForUpdates: inv('updates:check') as OrbitApi['checkForUpdates'],
  installUpdate: inv('updates:install') as OrbitApi['installUpdate'],

  getActivity: inv('activity:get') as OrbitApi['getActivity'],
  registerMcpGlobal: inv('mcp:registerGlobal') as OrbitApi['registerMcpGlobal'],

  onEvent: (cb) => listen('orbit:event', cb),
  onCommand: (cb) => listen('orbit:command', cb),
  onFocusTab: (cb) => listen('orbit:focusTab', cb)
}

contextBridge.exposeInMainWorld('orbit', api)
