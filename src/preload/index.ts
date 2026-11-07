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

  sftpHome: inv('sftp:home') as OrbitApi['sftpHome'],
  sftpList: inv('sftp:list') as OrbitApi['sftpList'],
  sftpRead: inv('sftp:read') as OrbitApi['sftpRead'],
  sftpWrite: inv('sftp:write') as OrbitApi['sftpWrite'],

  getActivity: inv('activity:get') as OrbitApi['getActivity'],
  registerMcpGlobal: inv('mcp:registerGlobal') as OrbitApi['registerMcpGlobal'],

  onEvent: (cb) => listen('orbit:event', cb),
  onCommand: (cb) => listen('orbit:command', cb),
  onFocusTab: (cb) => listen('orbit:focusTab', cb)
}

contextBridge.exposeInMainWorld('orbit', api)
