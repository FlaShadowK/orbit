import type { LayoutNode } from './layout'

export type TabKind = 'agent' | 'terminal' | 'ssh' | 'editor' | 'sftp' | 'changes'

export type AgentStatus = 'idle' | 'working' | 'waiting' | 'done' | 'exited'

/** While working: printing output (fast orbit), thinking (slow), or extended thinking (slowest, red) */
export type AgentActivity = 'streaming' | 'thinking' | 'deep'

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
  /** the focused tab (always shown in `layout` when there is one) */
  activeTabId?: string
  /** visible panes; tabs not in the tree are hidden */
  layout?: LayoutNode
  /** @deprecated pre-0.2 single split, migrated to `layout` on load */
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
  /** live stats from a Beszel hub (password lives in ServerSecret.beszelPassword) */
  beszel?: BeszelConfig
}

// ---------- Beszel monitoring ----------
export type StatMetric = 'cpu' | 'mem' | 'disk' | 'net' | 'load' | 'uptime' | 'containers' | 'temp'
/** value = big number, gauge = ring, spark = line chart, bar = meter, list = top containers */
export type WidgetType = 'value' | 'gauge' | 'spark' | 'bar' | 'list'
export type StatRange = '1h' | '12h' | '24h' | '7d'

export interface StatWidget {
  id: string
  type: WidgetType
  metric: StatMetric
  /** columns in the 2-column tile grid */
  span: 1 | 2
}

export interface BeszelConfig {
  /** hub URL, e.g. https://beszel.example.com */
  url: string
  email: string
  systemId?: string
  systemName?: string
  widgets?: StatWidget[]
  range?: StatRange
}

export interface BeszelSystemRef {
  id: string
  name: string
  host: string
  status: string
}

export interface StatPoint {
  t: number
  cpu: number
  mem: number
  disk: number
  /** bytes/s sent + received */
  net: number
  load: number
  temp?: number
}

export interface BeszelSnapshot {
  name: string
  status: string
  /** when the hub last heard from the agent (ms) */
  updated: number
  cpu: number
  cores?: number
  memPct: number
  memUsed: number
  memTotal: number
  diskPct: number
  diskUsed: number
  diskTotal: number
  /** bytes/s */
  netSent: number
  netRecv: number
  load: number[]
  /** seconds */
  uptime: number
  temp?: number
  series: StatPoint[]
  containers: { name: string; cpu: number; mem: number }[]
}

/** secrets never leave main process except into the edit form */
export interface ServerSecret {
  password?: string
  privateKey?: string
  passphrase?: string
  beszelPassword?: string
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
  /** check GitHub releases on startup and every few hours (default on) */
  autoUpdate?: boolean
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

export type GitChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict'

export interface GitChange {
  /** relative to the repository root */
  path: string
  /** absolute path on disk */
  abs: string
  origPath?: string
  kind: GitChangeKind
  staged: boolean
  unstaged: boolean
}

export interface GitStatus {
  isRepo: boolean
  /** repository root (may be above the space folder) */
  root?: string
  branch?: string
  detached?: boolean
  upstream?: string
  ahead: number
  behind: number
  files: GitChange[]
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
  | { type: 'agentActivity'; tabId: string; activity: AgentActivity }
  | { type: 'activity'; entry: ActivityEntry }
  | { type: 'fs'; root: string; path: string; event: string }
  | { type: 'openTab'; spaceId?: string; tab: Tab }
  | { type: 'servers'; servers: Server[] }
  /** something under .git changed (commit, checkout, fetch…), possibly from a terminal */
  | { type: 'git'; root: string }
  | { type: 'detached'; tabId: string; detached: boolean }
  | { type: 'update'; state: UpdateState }

export type UpdateState =
  | { status: 'idle' | 'checking' | 'none'; version?: string; error?: string }
  | { status: 'available' | 'downloading'; version: string; percent?: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; error: string; version?: string }
