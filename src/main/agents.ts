import { app } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AgentBase, AgentInfo } from '@shared/types'
import { store } from './store'
import { which } from './shellEnv'
import { mcpEndpoint } from './mcp'

interface AgentDef {
  id: string
  label: string
  command: string
  base: AgentBase
  alias?: boolean
}

const BUILTIN: AgentDef[] = [
  { id: 'claude', label: 'Claude Code', command: 'claude', base: 'claude' },
  { id: 'codex', label: 'Codex', command: 'codex', base: 'codex' },
  { id: 'gemini', label: 'Gemini CLI', command: 'gemini', base: 'gemini' },
  { id: 'opencode', label: 'opencode', command: 'opencode', base: 'opencode' }
]

const isBase = (id: string): id is AgentBase => BUILTIN.some((b) => b.id === id)

export function listAgents(): AgentInfo[] {
  const { agentCommands: custom, agentAliases = [] } = store.getSettings()
  const defs: AgentDef[] = [
    ...BUILTIN.map((a) => ({ ...a, command: custom[a.id] ?? a.command })),
    ...Object.entries(custom)
      .filter(([id]) => !isBase(id))
      .map(([id, command]): AgentDef => ({ id, label: id, command, base: 'other' })),
    ...agentAliases.map((a): AgentDef => ({ ...a, alias: true }))
  ]
  return defs.map((d) => ({
    ...d,
    // shell aliases and functions can't be found on PATH, so user aliases always count as available
    available: !!d.alias || !!which(d.command.split(/\s+/)[0])
  }))
}

export const ORBIT_PROMPT = `You are running inside Orbit, an agentic development & devops workspace.
Orbit exposes an MCP server named "orbit" that gives you direct access to every SSH server the user saved in the app:
- list_servers: see available servers (name, host, user, tags, default dir)
- ssh_exec: run shell commands on a server (use for docker, systemd, nginx, git pull, logs, etc.)
- sftp_list / sftp_read / sftp_write: browse, read and write remote files
- upload: copy a local file or directory to a server (skips node_modules/.git by default)
- open_terminal: open a visible SSH tab for the user on a server
When asked to deploy, prefer reproducible setups (git + docker compose or systemd), verify with health checks, and report exactly what you changed on each server.`

function hookCommand(tabId: string, state: string): string {
  const { url, token } = mcpEndpoint()
  const nul = process.platform === 'win32' ? 'NUL' : '/dev/null'
  const curl = process.platform === 'win32' ? 'curl.exe' : 'curl'
  return `${curl} -s -m 2 -o ${nul} -X POST -H "Authorization: Bearer ${token}" ${url.replace(/\/mcp$/, '')}/hook/${tabId}/${state}`
}

export interface LaunchSpec {
  file: string
  args: string[]
  env: Record<string, string>
  /** not a program on PATH (a shell alias or function): needs an interactive shell to resolve */
  interactive: boolean
  /** the user's command line as typed (kept unquoted so aliases and VAR=x prefixes work) */
  command: string
}

/** Build the command line for an agent tab, injecting Orbit's MCP server + status hooks. */
export function agentLaunch(
  agentId: string,
  tabId: string,
  spaceId: string | undefined,
  sessionId: string | undefined,
  resume: boolean
): LaunchSpec {
  const agent = listAgents().find((a) => a.id === agentId)
  const commandLine = agent?.command ?? agentId
  const kind: AgentBase = agent?.base ?? (isBase(agentId) ? agentId : 'other')
  const [file, ...baseArgs] = commandLine.trim().split(/\s+/)
  const interactive = !which(file)
  const { url, token } = mcpEndpoint()
  const env: Record<string, string> = { ORBIT_MCP_URL: url, ORBIT_MCP_TOKEN: token }
  const dir = join(app.getPath('userData'), 'agents', tabId)
  mkdirSync(dir, { recursive: true })
  const headers = { Authorization: `Bearer ${token}`, 'X-Orbit-Space': spaceId ?? '', 'X-Orbit-Tab': tabId }

  if (kind === 'claude') {
    const mcpFile = join(dir, 'mcp.json')
    writeFileSync(mcpFile, JSON.stringify({ mcpServers: { orbit: { type: 'http', url, headers } } }, null, 2))
    const settingsFile = join(dir, 'settings.json')
    const hook = (state: string): unknown => [{ hooks: [{ type: 'command', command: hookCommand(tabId, state) }] }]
    writeFileSync(
      settingsFile,
      JSON.stringify(
        {
          hooks: {
            UserPromptSubmit: hook('started'),
            PreToolUse: hook('working'),
            Stop: hook('done'),
            Notification: hook('waiting')
          }
        },
        null,
        2
      )
    )
    const args = [...baseArgs, '--mcp-config', mcpFile, '--settings', settingsFile, '--append-system-prompt', ORBIT_PROMPT]
    if (sessionId) args.push(resume ? '--resume' : '--session-id', sessionId)
    return { file, args, env, interactive, command: commandLine.trim() }
  }

  if (kind === 'codex') {
    env.ORBIT_SPACE_ID = spaceId ?? ''
    const args = [
      ...baseArgs,
      '-c', `mcp_servers.orbit.url="${url}"`,
      '-c', `mcp_servers.orbit.bearer_token_env_var="ORBIT_MCP_TOKEN"`
    ]
    return { file, args, env, interactive, command: commandLine.trim() }
  }

  return { file, args: baseArgs, env, interactive, command: commandLine.trim() }
}
