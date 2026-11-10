import * as pty from 'node-pty'
import type { ClientChannel } from 'ssh2'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { basename } from 'path'
import type { AgentBase, SessionSpec } from '@shared/types'
import { agentLaunch, listAgents } from './agents'
import { defaultShell, shellEnv } from './shellEnv'
import { openShell } from './ssh'
import { clearStatus, emit, getStatus, send, sendTermBatch, setActivity, setStatus } from './events'
import { ActivityTracker, StatusGuesser, stripAnsi } from './agentActivity'
import { agentUnder, indexProcs, listProcesses } from './agentDetect'
import { store } from './store'
import { countPty } from './perf'
import { Scrollback } from './scrollback'
import { OutputBatcher } from './outputBatch'

const SCROLLBACK = 256 * 1024

interface Session {
  /** foreground process name if it's not the shell itself (e.g. "npm", "git"), else null */
  foreground?(): string | null
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  buffer: Scrollback
  /** started from an agent button (an agent tab) */
  agent: boolean
  /** local shell pid, for finding agents started inside it */
  pid?: number
  /** the agent CLI currently running in this terminal, however it was started */
  running?: AgentBase | null
  /** status comes from Claude Code hooks Orbit injected, so output isn't used to guess it */
  hooked?: boolean
  /** guesses status from output for agents without hooks */
  guesser?: StatusGuesser
  /** agents only: classifies output while working, polled to report activity changes */
  tracker?: ActivityTracker
}

const sessions = new Map<string, Session>()
const SHELLS = new Set(['zsh', 'bash', 'sh', 'fish', 'dash', 'ksh', 'tcsh', 'csh', 'nu', 'pwsh', 'powershell', 'login'])

/** What each terminal is running right now (null = idle at a prompt). Used to lock branch switching. */
export function foregroundProcesses(ids: string[]): Record<string, string | null> {
  return Object.fromEntries(ids.map((id) => [id, sessions.get(id)?.foreground?.() ?? null]))
}

/** all terminal output goes to the renderer in coalesced batches */
const output = new OutputBatcher(sendTermBatch)

function onData(id: string, data: string): void {
  countPty(data.length)
  const s = sessions.get(id)
  if (s) {
    s.buffer.push(data)
    if (s.tracker || s.guesser) {
      const text = stripAnsi(data)
      s.tracker?.feedText(text)
      s.guesser?.feedText(text)
    }
  }
  output.push(id, data)
}

function onExit(id: string, code: number | null): void {
  const s = sessions.get(id)
  if (s?.agent) setStatus(id, 'exited')
  else if (s?.running) clearStatus(id)
  sessions.delete(id)
  // the last output must reach the renderer before the exit notice
  output.flush()
  send('term:exit', id, code)
}

/** Start a session; if one already exists for this id (renderer reload), replay its buffer. */
export async function startSession(spec: SessionSpec): Promise<{ replay?: string }> {
  const existing = sessions.get(spec.id)
  if (existing) {
    existing.resize(spec.cols, spec.rows)
    // queued output is already in the scrollback: sending it too would print it twice
    output.discard(spec.id)
    return { replay: existing.buffer.toString() }
  }
  if (spec.kind === 'ssh') {
    let stream: ClientChannel
    try {
      stream = await openShell(spec.serverId!, spec.cols, spec.rows)
    } catch (err) {
      const msg = `\r\n\x1b[31mSSH connection failed: ${(err as Error).message}\x1b[0m\r\n`
      sendTermBatch([[spec.id, msg]])
      send('term:exit', spec.id, 1)
      return {}
    }
    const session: Session = {
      buffer: new Scrollback(SCROLLBACK),
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
      // the user's command stays unquoted so shell aliases (claude-work) and VAR=x prefixes work
      const extra = launch.args.slice(launch.command.split(/\s+/).length - 1)
      const cmd = [launch.command, ...extra.map(q)].join(' ')
      args = [launch.interactive ? '-ilc' : '-lc', `${cmd}; echo; echo "\x1b[2m[agent exited — shell]\x1b[0m"; exec ${q(shell)} -l`]
    }
  }

  const proc = pty.spawn(file, args, { name: 'xterm-256color', cols: spec.cols, rows: spec.rows, cwd, env })
  const session: Session = {
    buffer: new Scrollback(SCROLLBACK),
    agent: isAgent,
    pid: proc.pid,
    foreground: () => {
      if (process.platform === 'win32') return null // node-pty can't see the foreground process on Windows
      const name = basename(proc.process || '').replace(/^-/, '')
      return !name || SHELLS.has(name) ? null : name
    },
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
  if (isAgent) {
    // `running` is filled in by the process scan once the CLI is up
    session.hooked = listAgents().find((a) => a.id === spec.agent)?.base === 'claude'
    startTracking(spec.id, session)
  }
  proc.onData((d) => onData(spec.id, d))
  proc.onExit(({ exitCode }) => onExit(spec.id, exitCode))
  ensureScanner()
  return {}
}

// ---- status + activity for terminals with an agent in them: one ticker for all of them
const TRACK_MS = 250
let tracker: NodeJS.Timeout | undefined

function trackTick(): void {
  const now = Date.now()
  let any = false
  for (const [id, s] of sessions) {
    if (!s.tracker) continue
    any = true
    if (!s.hooked) {
      const guess = s.guesser!.current(now)
      if (guess) setStatus(id, guess)
    }
    if (getStatus(id) === 'working') setActivity(id, s.tracker.current(now))
  }
  if (!any) {
    clearInterval(tracker)
    tracker = undefined
  }
}

/** Status + activity reporting for a terminal that has an agent running in it. */
function startTracking(id: string, s: Session): void {
  setStatus(id, 'idle')
  s.tracker = new ActivityTracker()
  s.guesser = new StatusGuesser()
  tracker ??= setInterval(trackTick, TRACK_MS)
}

function stopTracking(id: string, s: Session): void {
  s.tracker = undefined
  s.guesser = undefined
  // hooks belonged to the agent Orbit launched; one typed later in the same tab has none
  s.hooked = false
  if (s.agent) setStatus(id, 'exited')
  else clearStatus(id)
}

// ---- agents started by typing a command (`claude`, an alias…) are found by looking at the process tree
const SCAN_MS = 1500
let scanner: NodeJS.Timeout | undefined
let scanning = false

function ensureScanner(): void {
  if (scanner || process.platform === 'win32') return
  scanner = setInterval(scan, SCAN_MS)
}

async function scan(): Promise<void> {
  const local = [...sessions.entries()].filter(([, s]) => s.pid)
  if (!local.length) {
    clearInterval(scanner)
    scanner = undefined
    return
  }
  if (scanning) return
  scanning = true
  try {
    const list = await listProcesses()
    if (!list.length) return
    const procs = indexProcs(list)
    for (const [id, s] of local) {
      if (sessions.get(id) !== s) continue
      const found = agentUnder(s.pid!, procs)
      if (found === (s.running ?? null)) continue
      const was = s.running
      s.running = found
      emit({ type: 'agentDetected', tabId: id, agent: found })
      if (found && !s.tracker) startTracking(id, s)
      else if (!found && was) stopTracking(id, s)
    }
  } finally {
    scanning = false
  }
}

/** Agents running in each terminal right now (renderer reload). */
export function runningAgents(): Record<string, AgentBase> {
  const out: Record<string, AgentBase> = {}
  for (const [id, s] of sessions) if (s.running) out[id] = s.running
  return out
}

export function writeSession(id: string, data: string): void {
  output.noteInput(id)
  sessions.get(id)?.write(data)
}
export function resizeSession(id: string, cols: number, rows: number): void {
  sessions.get(id)?.resize(cols, rows)
}
export function killSession(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  s.kill()
  sessions.delete(id)
}
export function killAll(): void {
  for (const id of [...sessions.keys()]) killSession(id)
}
export function hasSession(id: string): boolean {
  return sessions.has(id)
}
