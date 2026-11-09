import * as pty from 'node-pty'
import type { ClientChannel } from 'ssh2'
import { existsSync } from 'fs'
import { homedir } from 'os'
import type { SessionSpec } from '@shared/types'
import { agentLaunch } from './agents'
import { defaultShell, shellEnv } from './shellEnv'
import { openShell } from './ssh'
import { send, setStatus } from './events'
import { store } from './store'

const SCROLLBACK = 256 * 1024

interface Session {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  buffer: string
  agent: boolean
  idleTimer?: NodeJS.Timeout
}

const sessions = new Map<string, Session>()

function onData(id: string, data: string): void {
  const s = sessions.get(id)
  if (s) {
    s.buffer += data
    if (s.buffer.length > SCROLLBACK) s.buffer = s.buffer.slice(-SCROLLBACK)
  }
  send('term:data', id, data)
}

function onExit(id: string, code: number | null): void {
  const s = sessions.get(id)
  if (s?.agent) setStatus(id, 'exited')
  sessions.delete(id)
  send('term:exit', id, code)
}

/** Start a session; if one already exists for this id (renderer reload), replay its buffer. */
export async function startSession(spec: SessionSpec): Promise<{ replay?: string }> {
  const existing = sessions.get(spec.id)
  if (existing) {
    existing.resize(spec.cols, spec.rows)
    return { replay: existing.buffer }
  }
  if (spec.kind === 'ssh') {
    let stream: ClientChannel
    try {
      stream = await openShell(spec.serverId!, spec.cols, spec.rows)
    } catch (err) {
      const msg = `\r\n\x1b[31mSSH connection failed: ${(err as Error).message}\x1b[0m\r\n`
      send('term:data', spec.id, msg)
      send('term:exit', spec.id, 1)
      return {}
    }
    const session: Session = {
      buffer: '',
      agent: false,
      write: (d) => stream.write(d),
      resize: (cols, rows) => stream.setWindow(rows, cols, 0, 0),
      kill: () => stream.close()
    }
    sessions.set(spec.id, session)
    stream.on('data', (d: Buffer) => onData(spec.id, d.toString('utf8')))
    stream.stderr.on('data', (d: Buffer) => onData(spec.id, d.toString('utf8')))
    stream.on('close', () => onExit(spec.id, 0))
    return {}
  }

  const env = { ...shellEnv() } as Record<string, string>
  env.ORBIT_TAB_ID = spec.id
  if (spec.spaceId) env.ORBIT_SPACE_ID = spec.spaceId
  const cwd = spec.cwd && existsSync(spec.cwd) ? spec.cwd : homedir()
  const shell = store.getSettings().shell || defaultShell()
  let file = shell
  let args: string[] = process.platform === 'win32' ? ['-NoLogo'] : ['-l']
  const isAgent = spec.tabKind === 'agent' && !!spec.agent
  if (isAgent) {
    const launch = agentLaunch(spec.agent!, spec.id, spec.spaceId, spec.agentSessionId, !!spec.resume)
    Object.assign(env, launch.env)
    // run through the login shell so user aliases/PATH apply, and drop back to a shell if the agent exits
    if (process.platform === 'win32') {
      // PowerShell resolves .cmd/.ps1 shims (npm-installed CLIs) and keeps a shell after exit
      const pq = (x: string): string => `'${x.replace(/'/g, "''")}'`
      file = shell
      args = ['-NoLogo', '-NoExit', '-Command', `& ${[launch.file, ...launch.args].map(pq).join(' ')}`]
    } else {
      const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`
      const cmd = [launch.file, ...launch.args].map(q).join(' ')
      args = ['-lc', `${cmd}; echo; echo "\x1b[2m[agent exited — shell]\x1b[0m"; exec ${q(shell)} -l`]
    }
  }

  const proc = pty.spawn(file, args, { name: 'xterm-256color', cols: spec.cols, rows: spec.rows, cwd, env })
  const session: Session = {
    buffer: '',
    agent: isAgent,
    write: (d) => proc.write(d),
    resize: (cols, rows) => {
      try {
        proc.resize(Math.max(cols, 2), Math.max(rows, 1))
      } catch {
        /* process gone */
      }
    },
    kill: () => proc.kill()
  }
  sessions.set(spec.id, session)
  if (isAgent) setStatus(spec.id, 'idle')
  proc.onData((d) => {
    onData(spec.id, d)
    // generic activity heuristic for agents without status hooks
    if (isAgent && spec.agent !== 'claude') {
      setStatus(spec.id, 'working')
      clearTimeout(session.idleTimer)
      session.idleTimer = setTimeout(() => setStatus(spec.id, 'waiting'), 2500)
    }
  })
  proc.onExit(({ exitCode }) => onExit(spec.id, exitCode))
  return {}
}

export function writeSession(id: string, data: string): void {
  sessions.get(id)?.write(data)
}
export function resizeSession(id: string, cols: number, rows: number): void {
  sessions.get(id)?.resize(cols, rows)
}
export function killSession(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  clearTimeout(s.idleTimer)
  s.kill()
  sessions.delete(id)
}
export function killAll(): void {
  for (const id of [...sessions.keys()]) killSession(id)
}
export function hasSession(id: string): boolean {
  return sessions.has(id)
}
