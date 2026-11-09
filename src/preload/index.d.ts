import type {
  ActivityEntry, AgentInfo, AgentStatus, DirEntry, MainEvent, OrbitInfo, Server, ServerInput,
  SessionSpec, Settings, Space, UpdateState, GitChange, GitStatus
} from '../shared/types'

export interface OrbitApi {
  info(): Promise<OrbitInfo>
  getSpaces(): Promise<{ spaces: Space[]; activeSpaceId?: string }>
  setSpaces(spaces: Space[], activeSpaceId?: string): Promise<void>
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  pickFolder(): Promise<string | null>
  pickFile(): Promise<string | null>
  reveal(path: string): Promise<void>
  openExternal(url: string): Promise<void>

  listAgents(): Promise<AgentInfo[]>
  getStatuses(): Promise<Record<string, AgentStatus>>
  setTabTitle(tabId: string, title: string): Promise<void>

  termStart(spec: SessionSpec): Promise<{ replay?: string }>
  termWrite(id: string, data: string): void
  termResize(id: string, cols: number, rows: number): void
  termKill(id: string): Promise<void>
  saveImage(bytes: Uint8Array, mime: string): Promise<string>
  /** foreground process per terminal (null = idle at the prompt) */
  termForeground(ids: string[]): Promise<Record<string, string | null>>
  pathForFile(file: File): string
  onTermData(cb: (id: string, data: string) => void): () => void
  onTermExit(cb: (id: string, code: number | null) => void): () => void

  fsList(dir: string): Promise<DirEntry[]>
  fsRead(path: string): Promise<string>
  fsWrite(path: string, content: string): Promise<void>
  fsWatch(root: string): Promise<void>

  listServers(): Promise<Server[]>
  serverSecretFlags(id: string): Promise<{ password: boolean; privateKey: boolean; passphrase: boolean }>
  saveServer(input: ServerInput): Promise<Server>
  removeServer(id: string): Promise<void>
  testServer(id: string): Promise<string>
  importSshConfig(): Promise<number>

  sftpHome(serverId: string): Promise<string>
  sftpList(serverId: string, path: string): Promise<DirEntry[]>
  sftpRead(serverId: string, path: string): Promise<string>
  sftpWrite(serverId: string, path: string, content: string): Promise<void>

  git: {
    status(cwd: string): Promise<GitStatus>
    branches(cwd: string): Promise<string[]>
    fileVersions(cwd: string, change: GitChange): Promise<{ original: string; modified: string; binary: boolean }>
    commit(cwd: string, message: string, paths: string[]): Promise<string>
    pull(cwd: string): Promise<string>
    push(cwd: string): Promise<string>
    checkout(cwd: string, branch: string, create: boolean): Promise<string>
    init(cwd: string): Promise<string>
    watch(cwd: string): Promise<void>
  }

  /** open a tab in its own window (optionally where it was dropped, in screen coordinates) */
  detachTab(req: { tabId: string; spaceId: string; title: string; at?: { x: number; y: number } }): Promise<void>
  closeDetached(tabId: string): Promise<void>
  focusDetached(tabId: string): Promise<void>

  updateState(): Promise<UpdateState>
  checkForUpdates(): Promise<void>
  installUpdate(): Promise<void>

  getActivity(): Promise<ActivityEntry[]>
  registerMcpGlobal(): Promise<string>

  onEvent(cb: (e: MainEvent) => void): () => void
  onCommand(cb: (cmd: string) => void): () => void
  onFocusTab(cb: (tabId: string) => void): () => void
}

declare global {
  interface Window {
    orbit: OrbitApi
  }
}
