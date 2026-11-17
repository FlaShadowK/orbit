import { app } from 'electron'
import { execFile } from 'child_process'
import type { TabUsage, UsageReport } from '@shared/types'

export interface PsRow {
  pid: number
  ppid: number
  /** % of one core */
  cpu: number
  /** resident set size, KB */
  rss: number
}

/** Parse `ps -axo pid=,ppid=,pcpu=,rss=` output. */
export function parsePsUsage(out: string): PsRow[] {
  const rows: PsRow[] = []
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.,]+)\s+(\d+)$/)
    if (m) rows.push({ pid: +m[1], ppid: +m[2], cpu: parseFloat(m[3].replace(',', '.')), rss: +m[4] })
  }
  return rows
}

/** CPU and memory of each root process plus everything it started (the whole tree). */
export function treeTotals(roots: number[], rows: PsRow[]): Map<number, Required<Pick<TabUsage, 'cpu' | 'mem' | 'procs'>>> {
  const children = new Map<number, PsRow[]>()
  const byPid = new Map<number, PsRow>()
  for (const r of rows) {
    byPid.set(r.pid, r)
    const list = children.get(r.ppid)
    if (list) list.push(r)
    else children.set(r.ppid, [r])
  }
  const out = new Map<number, { cpu: number; mem: number; procs: number }>()
  for (const root of roots) {
    const first = byPid.get(root)
    if (!first) continue
    let cpu = 0
    let mem = 0
    let procs = 0
    const seen = new Set<number>()
    const stack = [first]
    while (stack.length) {
      const p = stack.pop()!
      if (seen.has(p.pid)) continue
      seen.add(p.pid)
      cpu += p.cpu
      mem += p.rss * 1024
      procs++
      for (const c of children.get(p.pid) ?? []) stack.push(c)
    }
    out.set(root, { cpu: Math.round(cpu * 10) / 10, mem, procs })
  }
  return out
}

function ps(): Promise<PsRow[]> {
  if (process.platform === 'win32') return Promise.resolve([])
  return new Promise((res) =>
    execFile('ps', ['-axo', 'pid=,ppid=,pcpu=,rss='], { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => res(err ? [] : parsePsUsage(stdout)))
  )
}

export interface SessionSample {
  id: string
  pid?: number
  /** ssh: bytes/s received since the last sample */
  net?: number
}

/** One sample for every live terminal, plus Orbit's own processes. Only runs while someone asks. */
export async function usageReport(sessions: SessionSample[]): Promise<UsageReport> {
  const rows = await ps()
  const totals = treeTotals(sessions.filter((s) => s.pid).map((s) => s.pid!), rows)
  const tabs: Record<string, TabUsage> = {}
  for (const s of sessions) {
    if (s.pid) {
      const t = totals.get(s.pid)
      if (t) tabs[s.id] = t
    } else if (s.net != null) tabs[s.id] = { net: s.net }
  }
  const metrics = app.getAppMetrics()
  const appUsage: TabUsage = {
    cpu: Math.round(metrics.reduce((n, m) => n + m.cpu.percentCPUUsage, 0) * 10) / 10,
    mem: metrics.reduce((n, m) => n + (m.memory.workingSetSize ?? 0) * 1024, 0),
    procs: metrics.length
  }
  return { tabs, app: appUsage }
}
