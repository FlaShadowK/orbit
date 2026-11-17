import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getAppMetrics: () => [] } }))

const { parsePsUsage, treeTotals } = await import('./usage')

describe('parsePsUsage', () => {
  it('reads pid, ppid, cpu and rss columns', () => {
    const rows = parsePsUsage('    1     0   0.0  12000\n  501     1  12.5  2048\n  garbage line\n  502   501   3,5   1024\n')
    expect(rows).toEqual([
      { pid: 1, ppid: 0, cpu: 0, rss: 12000 },
      { pid: 501, ppid: 1, cpu: 12.5, rss: 2048 },
      { pid: 502, ppid: 501, cpu: 3.5, rss: 1024 }
    ])
  })
})

describe('treeTotals', () => {
  const rows = [
    { pid: 10, ppid: 1, cpu: 1, rss: 100 },
    { pid: 11, ppid: 10, cpu: 20, rss: 1000 },
    { pid: 12, ppid: 11, cpu: 5.55, rss: 50 },
    { pid: 20, ppid: 1, cpu: 2, rss: 10 }
  ]

  it('sums a process and all of its descendants', () => {
    const t = treeTotals([10], rows).get(10)!
    expect(t.cpu).toBeCloseTo(26.6, 1)
    expect(t.mem).toBe((100 + 1000 + 50) * 1024)
    expect(t.procs).toBe(3)
  })

  it('keeps separate trees apart and skips pids that are gone', () => {
    const totals = treeTotals([10, 20, 99], rows)
    expect(totals.get(20)).toEqual({ cpu: 2, mem: 10 * 1024, procs: 1 })
    expect(totals.has(99)).toBe(false)
  })
})
