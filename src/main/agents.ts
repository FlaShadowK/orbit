import { app } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AgentInfo } from '@shared/types'
import { store } from './store'
import { which } from './shellEnv'
import { mcpEndpoint } from './mcp'

interface AgentDef {
  id: string
  label: string
  command: string
}

const BUILTIN: AgentDef[] = [
  { id: 'claude', label: 'Claude Code', command: 'claude' },
  { id: 'codex', label: 'Codex', command: 'codex' },
  { id: 'gemini', label: 'Gemini CLI', command: 'gemini' },
  { id: 'opencode', label: 'opencode', command: 'opencode' }
]

export function listAgents(): AgentInfo[] {
  const custom = store.getSettings().agentCommands
  const defs: AgentDef[] = [
    ...BUILTIN.map((a) => ({ ...a, command: custom[a.id] ?? a.command })),
    ...Object.entries(custom)
      .filter(([id]) => !BUILTIN.some((b) => b.id === id))
      .map(([id, command]) => ({ id, label: id, command }))
  ]
  return defs.map((d) => ({ ...d, available: !!which(d.command.split(/\s+/)[0]) }))
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
  const [file, ...baseArgs] = commandLine.split(/\s+/)
  const { url, token } = mcpEndpoint()
  const env: Record<string, string> = { ORBIT_MCP_URL: url, ORBIT_MCP_TOKEN: token }
  const dir = join(app.getPath('userData'), 'agents', tabId)
  mkdirSync(dir, { recursive: true })
  const headers = { Authorization: `Bearer ${token}`, 'X-Orbit-Space': spaceId ?? '', 'X-Orbit-Tab': tabId }

  if (agentId === 'claude') {
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
    return { file, args, env }
  }

  if (agentId === 'codex') {
    env.ORBIT_SPACE_ID = spaceId ?? ''
    const args = [
      ...baseArgs,
      '-c', `mcp_servers.orbit.url="${url}"`,
      '-c', `mcp_servers.orbit.bearer_token_env_var="ORBIT_MCP_TOKEN"`
    ]
    return { file, args, env }
  }

  return { file, args: baseArgs, env }
}
