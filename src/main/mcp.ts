import { createServer, type IncomingMessage, type Server as HttpServer } from 'http'
import { randomUUID } from 'crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { store } from './store'
import * as ssh from './ssh'
import { emit, logActivity, setStatus } from './events'

const PREFERRED_PORT = 47821
let port = 0
let token = ''
let http: HttpServer | null = null

export function mcpEndpoint(): { url: string; token: string } {
  return { url: `http://127.0.0.1:${port}/mcp`, token }
}

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], isError })

async function logged(
  tool: string,
  server: string | undefined,
  summary: string,
  fn: () => Promise<{ text: string; ok: boolean }>
): Promise<ToolResult> {
  const start = Date.now()
  try {
    const r = await fn()
    logActivity({
      id: randomUUID(), at: start, tool, server, summary, ok: r.ok,
      durationMs: Date.now() - start, output: r.text.slice(0, 4000)
    })
    return text(r.text, !r.ok)
  } catch (err) {
    const msg = (err as Error).message
    logActivity({ id: randomUUID(), at: start, tool, server, summary, ok: false, durationMs: Date.now() - start, output: msg })
    return text(`Error: ${msg}`, true)
  }
}

function buildServer(ctx: { spaceId?: string }): McpServer {
  const mcp = new McpServer({ name: 'orbit', version: '0.1.0' })

  mcp.registerTool(
    'list_servers',
    {
      description: 'List SSH servers saved in Orbit (no secrets). Use the name with the other tools.',
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    async () => {
      const servers = store.getServers().map((s) => ({
        name: s.name, host: s.host, port: s.port, user: s.username, tags: s.tags,
        defaultDir: s.defaultDir, notes: s.notes,
        via: s.jumpServerId ? store.getServer(s.jumpServerId)?.name : undefined
      }))
      return text(servers.length ? JSON.stringify(servers, null, 2) : 'No servers saved in Orbit yet. Ask the user to add one in the Servers panel.')
    }
  )

  mcp.registerTool(
    'ssh_exec',
    {
      description:
        'Run a shell command on a saved server over SSH and return stdout, stderr and exit code. Non-interactive (no TTY): pass -y flags, avoid pagers/editors.',
      inputSchema: {
        server: z.string().describe('Server name (from list_servers)'),
        command: z.string().describe('Shell command to run'),
        cwd: z.string().optional().describe('Working directory (defaults to server default dir or home)'),
        timeout_seconds: z.number().int().min(1).max(3600).optional().describe('Default 120')
      }
    },
    async ({ server, command, cwd, timeout_seconds }) =>
      logged('ssh_exec', server, command, async () => {
        const r = await ssh.exec(server, command, cwd, (timeout_seconds ?? 120) * 1000)
        const parts = [`exit code: ${r.code ?? 'none'}${r.timedOut ? ' (timed out)' : ''}`]
        if (r.stdout) parts.push(`stdout:\n${r.stdout}`)
        if (r.stderr) parts.push(`stderr:\n${r.stderr}`)
        return { text: parts.join('\n\n'), ok: r.code === 0 && !r.timedOut }
      })
  )

  mcp.registerTool(
    'sftp_list',
    {
      description: 'List a directory on a server.',
      inputSchema: { server: z.string(), path: z.string().describe('Absolute or home-relative path; "." for home') },
      annotations: { readOnlyHint: true }
    },
    async ({ server, path }) =>
      logged('sftp_list', server, path, async () => {
        const entries = await ssh.sftpList(server, path)
        return { ok: true, text: entries.map((e) => `${e.dir ? 'd' : '-'} ${e.dir ? '' : String(e.size ?? 0).padStart(10)} ${e.name}`).join('\n') || '(empty)' }
      })
  )

  mcp.registerTool(
    'sftp_read',
    {
      description: 'Read a text file from a server (max 5MB).',
      inputSchema: { server: z.string(), path: z.string() },
      annotations: { readOnlyHint: true }
    },
    async ({ server, path }) => logged('sftp_read', server, path, async () => ({ ok: true, text: await ssh.sftpRead(server, path) }))
  )

  mcp.registerTool(
    'sftp_write',
    {
      description: 'Write (create or overwrite) a text file on a server. Parent directories are created.',
      inputSchema: { server: z.string(), path: z.string(), content: z.string() }
    },
    async ({ server, path, content }) =>
      logged('sftp_write', server, `${path} (${content.length} chars)`, async () => {
        await ssh.sftpWrite(server, path, content)
        return { ok: true, text: `Wrote ${content.length} chars to ${path}` }
      })
  )

  mcp.registerTool(
    'upload',
    {
      description:
        'Upload a local file or directory to a server via SFTP. Directories are copied recursively, skipping node_modules, .git, dist, .next, vendor unless include_all is true.',
      inputSchema: {
        server: z.string(),
        local_path: z.string(),
        remote_path: z.string().describe('Destination path (file path, or directory for a directory upload)'),
        include_all: z.boolean().optional()
      }
    },
    async ({ server, local_path, remote_path, include_all }) =>
      logged('upload', server, `${local_path} → ${remote_path}`, async () => {
        const n = await ssh.upload(server, local_path, remote_path, include_all)
        return { ok: true, text: `Uploaded ${n} file(s) to ${remote_path}` }
      })
  )

  mcp.registerTool(
    'open_terminal',
    {
      description: 'Open a visible interactive SSH terminal tab in Orbit for the user, e.g. to show logs or let them take over.',
      inputSchema: { server: z.string() }
    },
    async ({ server }) => {
      const s = store.getServer(server)
      if (!s) return text(`Unknown server "${server}"`, true)
      emit({ type: 'openTab', spaceId: ctx.spaceId, tab: { id: randomUUID(), kind: 'ssh', title: s.name, serverId: s.id } })
      return text(`Opened a terminal tab for ${s.name}.`)
    }
  )

  mcp.registerTool(
    'list_spaces',
    {
      description: 'List Orbit spaces (projects) with their local root folders.',
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    async () => {
      const { spaces } = store.getSpaces()
      return text(
        JSON.stringify(
          spaces.map((s) => ({ name: s.name, root: s.root, current: s.id === ctx.spaceId })),
          null,
          2
        )
      )
    }
  )

  return mcp
}

function authorized(req: IncomingMessage): boolean {
  return req.headers.authorization === `Bearer ${token}`
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : undefined
}

export async function startMcp(): Promise<void> {
  const settings = store.getSettings()
  token = settings.mcpToken ?? randomUUID().replace(/-/g, '')
  if (!settings.mcpToken) store.setSettings({ mcpToken: token })

  http = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (!authorized(req)) {
        res.writeHead(401).end('unauthorized')
        return
      }
      const hook = url.pathname.match(/^\/hook\/([^/]+)\/(\w+)$/)
      if (hook && req.method === 'POST') {
        const [, tabId, state] = hook
        if (state === 'started') {
          setStatus(tabId, 'working')
          emit({ type: 'agentStarted', tabId })
        } else if (state === 'working' || state === 'waiting' || state === 'done') setStatus(tabId, state)
        res.writeHead(204).end()
        return
      }
      if (url.pathname === '/mcp') {
        if (req.method !== 'POST') {
          res.writeHead(405, { Allow: 'POST' }).end()
          return
        }
        const body = await readBody(req)
        const spaceId = (req.headers['x-orbit-space'] as string | undefined) || undefined
        const server = buildServer({ spaceId })
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
        res.on('close', () => {
          transport.close().catch(() => {})
          server.close().catch(() => {})
        })
        await server.connect(transport)
        await transport.handleRequest(req, res, body)
        return
      }
      res.writeHead(404).end()
    } catch (err) {
      console.error('[orbit] mcp error', err)
      if (!res.headersSent) res.writeHead(500).end(String(err))
    }
  })

  port = await new Promise<number>((resolve, reject) => {
    const tryListen = (p: number): void => {
      http!.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && p !== 0) tryListen(0)
        else reject(err)
      })
      http!.listen(p, '127.0.0.1', () => {
        const addr = http!.address()
        resolve(typeof addr === 'object' && addr ? addr.port : p)
      })
    }
    tryListen(PREFERRED_PORT)
  })
  console.log(`[orbit] MCP server on http://127.0.0.1:${port}/mcp`)
}

export function stopMcp(): void {
  http?.close()
}
