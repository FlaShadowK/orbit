export type TabKind = 'agent' | 'terminal' | 'ssh' | 'editor' | 'sftp'

export type AgentStatus = 'idle' | 'working' | 'waiting' | 'done' | 'exited'

export interface Tab {
  id: string
  kind: TabKind
  title: string
  /** agent id (claude, codex, gemini, custom) */
  agent?: string
  /** claude session id used for --session-id / --resume */
  agentSessionId?: string
  /** true once the agent received at least one prompt (safe to resume) */
  agentStarted?: boolean
  serverId?: string
  /** editor: local absolute path, or remote path when serverId is set */
  filePath?: string
  /** sftp browser cwd */
  cwd?: string
}

export interface Space {
  id: string
  name: string
  root: string
  color: string
  tabs: Tab[]
  activeTabId?: string
  split?: { tabId: string; direction: 'row' | 'column' }
}

export type AuthMethod = 'agent' | 'key' | 'password'

export interface Server {
  id: string
  name: string
  host: string
  port: number
  username: string
  auth: AuthMethod
  /** path to private key on disk (auth = key) */
  keyPath?: string
  jumpServerId?: string
  tags: string[]
  color: string
  /** default directory for agent commands / sftp */
  defaultDir?: string
  notes?: string
}

/** secrets never leave main process except into the edit form */
export interface ServerSecret {
  password?: string
  privateKey?: string
  passphrase?: string
}

export interface ServerInput extends Omit<Server, 'id'> {
  id?: string
  secret?: ServerSecret
}

export interface Settings {
  shell?: string
  fontSize: number
  agentCommands: Record<string, string>
  defaultAgent: string
  mcpToken?: string
}

export interface ActivityEntry {
  id: string
  at: number
  tool: string
  server?: string
  summary: string
  ok: boolean
  durationMs: number
  output?: string
}

export interface AgentInfo {
  id: string
  label: string
  command: string
  available: boolean
}

export interface SessionSpec {
  id: string
  kind: 'pty' | 'ssh'
  /** pty */
  cwd?: string
  tabKind?: TabKind
  agent?: string
  agentSessionId?: string
  resume?: boolean
  spaceId?: string
  /** ssh */
  serverId?: string
  cols: number
  rows: number
}

export interface DirEntry {
  name: string
  path: string
  dir: boolean
  size?: number
}

export interface OrbitInfo {
  mcpUrl: string
  mcpToken: string
  platform: string
  home: string
  version: string
}

export type MainEvent =
  | { type: 'status'; tabId: string; status: AgentStatus }
  | { type: 'agentStarted'; tabId: string }
  | { type: 'activity'; entry: ActivityEntry }
  | { type: 'fs'; root: string; path: string; event: string }
  | { type: 'openTab'; spaceId?: string; tab: Tab }
  | { type: 'servers'; servers: Server[] }
