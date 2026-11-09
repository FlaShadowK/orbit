import type { BeszelSnapshot, StatPoint, StatRange } from '@shared/types'

/** Which pre-aggregated stats Beszel keeps for each range, and how many points cover it. */
export const RANGE: Record<StatRange, { type: string; points: number }> = {
  '1h': { type: '1m', points: 60 },
  '12h': { type: '10m', points: 72 },
  '24h': { type: '20m', points: 72 },
  '7d': { type: '120m', points: 84 }
}

/** Raw PocketBase records as Beszel (0.12+) stores them. */
export interface RawSystem {
  id: string
  name: string
  host: string
  status: string
  updated: string
  info: {
    cpu?: number
    mp?: number
    dp?: number
    /** uptime, seconds */
    u?: number
    la?: number[]
    /** cpu threads */
    t?: number
    /** total bandwidth bytes/s */
    bb?: number
    dt?: number
  }
}
export interface RawStats {
  cpu?: number
  /** memory GB: total, used, percent */
  m?: number
  mu?: number
  mp?: number
  /** disk GB: total, used, percent */
  d?: number
  du?: number
  dp?: number
  /** bandwidth bytes/s [sent, recv] (newer agents) */
  b?: [number, number]
  /** network MB/s (older agents) */
  ns?: number
  nr?: number
  la?: number[]
  /** temperatures by sensor */
  t?: Record<string, number>
}
export interface RawStatRecord {
  created: string
  stats: RawStats
}
export interface RawContainer {
  n: string
  c: number
  m: number
}

const pbTime = (s: string): number => Date.parse(s.replace(' ', 'T'))
const round = (n: number, d = 2): number => Math.round(n * 10 ** d) / 10 ** d

function bandwidth(s: RawStats): [number, number] {
  if (s.b) return s.b
  return [(s.ns ?? 0) * 1024 * 1024, (s.nr ?? 0) * 1024 * 1024]
}

function maxTemp(t?: Record<string, number>): number | undefined {
  const v = t ? Object.values(t).filter((x) => Number.isFinite(x)) : []
  return v.length ? Math.max(...v) : undefined
}

/** Merge the system record, its recent stats (newest first) and container stats into one snapshot. */
export function toSnapshot(sys: RawSystem, stats: RawStatRecord[], containers: RawContainer[]): BeszelSnapshot {
  const latest = stats[0]?.stats ?? {}
  const [sent, recv] = bandwidth(latest)
  const series: StatPoint[] = [...stats].reverse().map((r) => {
    const [s, rx] = bandwidth(r.stats)
    return {
      t: pbTime(r.created),
      cpu: r.stats.cpu ?? 0,
      mem: r.stats.mp ?? 0,
      disk: r.stats.dp ?? 0,
      net: s + rx,
      load: r.stats.la?.[0] ?? 0,
      temp: maxTemp(r.stats.t)
    }
  })
  return {
    name: sys.name,
    status: sys.status,
    updated: pbTime(sys.updated),
    cpu: round(latest.cpu ?? sys.info.cpu ?? 0),
    cores: sys.info.t,
    memPct: round(latest.mp ?? sys.info.mp ?? 0),
    memUsed: latest.mu ?? 0,
    memTotal: latest.m ?? 0,
    diskPct: round(latest.dp ?? sys.info.dp ?? 0),
    diskUsed: latest.du ?? 0,
    diskTotal: latest.d ?? 0,
    netSent: sent,
    netRecv: recv,
    load: latest.la ?? sys.info.la ?? [],
    uptime: sys.info.u ?? 0,
    temp: maxTemp(latest.t),
    series,
    containers: [...containers].sort((a, b) => b.m - a.m).map((c) => ({ name: c.n, cpu: c.c, mem: c.m }))
  }
}
