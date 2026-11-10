import { execFile } from 'child_process'
import type { AgentBase } from '@shared/types'

const AGENT_BINS: Record<string, AgentBase> = { claude: 'claude', codex: 'codex', gemini: 'gemini', opencode: 'opencode' }
/** npm package paths, for agents started as `node …/cli.js` */
const AGENT_PACKAGES: [RegExp, AgentBase][] = [
  [/@anthropic-ai[\\/]claude-code[\\/]/, 'claude'],
  [/@openai[\\/]codex[\\/]/, 'codex'],
  [/@google[\\/]gemini-cli[\\/]/, 'gemini'],
  [/[\\/]opencode-ai[\\/]/, 'opencode']
]
const RUNTIMES = new Set(['node', 'bun', 'deno', 'npx', 'bunx'])

const base = (p: string): string => (p.split(/[\\/]/).pop() ?? p).replace(/\.(exe|cmd|js|mjs)$/i, '')

/**
 * Which agent CLI a process command line is, if any. Only the program (or the script a
 * runtime like node runs) counts, so `vim claude.md` or `grep claude` don't match.
 */
export function detectAgent(args: string): AgentBase | null {
  const tokens = args.trim().split(/\s+/)
  const prog = base(tokens[0] ?? '').replace(/^-/, '')
  if (AGENT_BINS[prog]) return AGENT_BINS[prog]
  // Claude's native installer runs versioned binaries: ~/.local/share/claude/versions/2.0.14
  if (/[\\/]claude[\\/]versions[\\/]/.test(tokens[0] ?? '')) return 'claude'
  if (RUNTIMES.has(prog)) {
    const script = tokens.slice(1).find((t) => !t.startsWith('-'))
    if (!script) return null
    if (AGENT_BINS[base(script)]) return AGENT_BINS[base(script)]
    for (const [re, agent] of AGENT_PACKAGES) if (re.test(script)) return agent
  }
  return null
}

export interface Proc {
  pid: number
  ppid: number
  args: string
}

export function parsePs(out: string): Proc[] {
  const procs: Proc[] = []
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/)
    if (m) procs.push({ pid: +m[1], ppid: +m[2], args: m[3] })
  }
  return procs
}

/** The agent running anywhere under `rootPid` (breadth-first, so the outermost one wins). */
export function agentUnder(rootPid: number, procs: Proc[]): AgentBase | null {
  const children = new Map<number, Proc[]>()
  for (const p of procs) {
    const list = children.get(p.ppid)
    if (list) list.push(p)
    else children.set(p.ppid, [p])
  }
  const queue = [...(children.get(rootPid) ?? [])]
  const seen = new Set<number>()
  while (queue.length) {
    const p = queue.shift()!
    if (seen.has(p.pid)) continue
    seen.add(p.pid)
    const agent = detectAgent(p.args)
    if (agent) return agent
    queue.push(...(children.get(p.pid) ?? []))
  }
  return null
}

/** One `ps` snapshot of every process (macOS and Linux). */
export function listProcesses(): Promise<Proc[]> {
  return new Promise((resolve) => {
    execFile('ps', ['-A', '-o', 'pid=,ppid=,args='], { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? [] : parsePs(stdout)))
  })
}
