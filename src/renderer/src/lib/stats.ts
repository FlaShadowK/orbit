import type { BeszelSnapshot, StatMetric, StatPoint, StatWidget, WidgetType } from '@shared/types'
import { uid } from './util'

export function formatBytesRate(bps: number): string {
  if (bps < 1024) return `${Math.round(bps)} B/s`
  if (bps < 1024 ** 2) return `${(bps / 1024).toFixed(bps < 10 * 1024 ? 1 : 0)} KB/s`
  if (bps < 1024 ** 3) return `${(bps / 1024 ** 2).toFixed(1)} MB/s`
  return `${(bps / 1024 ** 3).toFixed(2)} GB/s`
}

export function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${m}m`
  return `${m}m`
}

const gb = (n: number): string => (n >= 100 ? n.toFixed(0) : n.toFixed(1))

export interface MetricDef {
  label: string
  short: string
  color: string
  types: WidgetType[]
  /** 0–100 for percentage metrics (gauges, bars, thresholds) */
  percent?: (s: BeszelSnapshot) => number
  /** main display value */
  value: (s: BeszelSnapshot) => string
  /** secondary line */
  detail?: (s: BeszelSnapshot) => string
  /** series value for sparklines */
  point?: (p: StatPoint) => number | undefined
  formatPoint?: (v: number) => string
  /** hide the metric when the agent doesn't report it */
  available?: (s: BeszelSnapshot) => boolean
}

export const METRICS: Record<StatMetric, MetricDef> = {
  cpu: {
    label: 'CPU usage',
    short: 'CPU',
    color: '#8b9bff',
    types: ['spark', 'gauge', 'bar', 'value'],
    percent: (s) => s.cpu,
    value: (s) => `${s.cpu.toFixed(1)}%`,
    detail: (s) => (s.cores ? `${s.cores} threads` : ''),
    point: (p) => p.cpu,
    formatPoint: (v) => `${v.toFixed(1)}%`
  },
  mem: {
    label: 'Memory',
    short: 'RAM',
    color: '#5eead4',
    types: ['gauge', 'spark', 'bar', 'value'],
    percent: (s) => s.memPct,
    value: (s) => `${s.memPct.toFixed(0)}%`,
    detail: (s) => (s.memTotal ? `${gb(s.memUsed)} / ${gb(s.memTotal)} GB` : ''),
    point: (p) => p.mem,
    formatPoint: (v) => `${v.toFixed(1)}%`
  },
  disk: {
    label: 'Disk usage',
    short: 'Disk',
    color: '#f5c26b',
    types: ['gauge', 'bar', 'spark', 'value'],
    percent: (s) => s.diskPct,
    value: (s) => `${s.diskPct.toFixed(0)}%`,
    detail: (s) => (s.diskTotal ? `${gb(s.diskUsed)} / ${gb(s.diskTotal)} GB` : ''),
    point: (p) => p.disk,
    formatPoint: (v) => `${v.toFixed(1)}%`
  },
  net: {
    label: 'Network',
    short: 'Net',
    color: '#c792ea',
    types: ['spark', 'value'],
    value: (s) => formatBytesRate(s.netSent + s.netRecv),
    detail: (s) => `↑ ${formatBytesRate(s.netSent)}  ↓ ${formatBytesRate(s.netRecv)}`,
    point: (p) => p.net,
    formatPoint: formatBytesRate
  },
  load: {
    label: 'Load average',
    short: 'Load',
    color: '#7aa2ff',
    types: ['spark', 'value'],
    value: (s) => (s.load[0] ?? 0).toFixed(2),
    detail: (s) => (s.load.length >= 3 ? `5m ${s.load[1].toFixed(2)} · 15m ${s.load[2].toFixed(2)}` : ''),
    point: (p) => p.load,
    formatPoint: (v) => v.toFixed(2)
  },
  temp: {
    label: 'Temperature',
    short: 'Temp',
    color: '#ff8fa0',
    types: ['value', 'spark'],
    value: (s) => (s.temp != null ? `${s.temp.toFixed(0)}°C` : '—'),
    detail: () => 'hottest sensor',
    point: (p) => p.temp,
    formatPoint: (v) => `${v.toFixed(0)}°C`,
    available: (s) => s.temp != null
  },
  uptime: {
    label: 'Uptime',
    short: 'Up',
    color: '#7ee787',
    types: ['value'],
    value: (s) => formatUptime(s.uptime),
    detail: (s) => s.name
  },
  containers: {
    label: 'Containers',
    short: 'Docker',
    color: '#67e8f9',
    types: ['list', 'value'],
    value: (s) => String(s.containers.length),
    detail: (s) => (s.containers.length ? `${s.containers.reduce((a, c) => a + c.mem, 0).toFixed(0)} MB total` : 'none running'),
    available: (s) => s.containers.length > 0
  }
}

export const TYPE_LABEL: Record<WidgetType, string> = {
  spark: 'Graph',
  gauge: 'Ring',
  bar: 'Meter',
  value: 'Number',
  list: 'List'
}

/** green → yellow → red for percentage metrics */
export function levelColor(pct: number, base: string): string {
  if (pct >= 90) return '#ff6b81'
  if (pct >= 75) return '#f5c26b'
  return base
}

export function defaultWidgets(): StatWidget[] {
  return [
    { id: uid(), type: 'spark', metric: 'cpu', span: 2 },
    { id: uid(), type: 'gauge', metric: 'mem', span: 1 },
    { id: uid(), type: 'gauge', metric: 'disk', span: 1 },
    { id: uid(), type: 'spark', metric: 'net', span: 2 }
  ]
}
