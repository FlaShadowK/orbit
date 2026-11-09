import { describe, expect, it } from 'vitest'
import { toSnapshot, type RawStatRecord, type RawSystem } from './beszelData'

// shapes copied from a real Beszel 0.20 hub
const system: RawSystem = {
  id: '167bypfwbvj127z',
  name: 'vmi3542558',
  host: '/beszel_socket/beszel.sock',
  status: 'up',
  updated: '2026-11-09 13:27:33.319Z',
  info: { t: 6, u: 149736, cpu: 1.82, mp: 14.88, dp: 11.88, la: [0.13, 0.2, 0.26], bb: 258 }
}
const stats: RawStatRecord[] = [
  {
    created: '2026-11-09 13:27:33.318Z',
    stats: { cpu: 1.82, m: 11.18, mu: 1.66, mp: 14.88, d: 192.85, du: 22.91, dp: 11.88, b: [128, 130], la: [0.13, 0.2, 0.26] }
  },
  { created: '2026-11-09 13:26:33.318Z', stats: { cpu: 4, mp: 15, dp: 11.8, b: [1000, 2000], la: [0.5, 0.2, 0.2], t: { cpu: 41, nvme: 38 } } }
]
const containers = [
  { n: 'beszel-agent', c: 0.01, m: 18.9 },
  { n: 'n8n', c: 0.16, m: 501.24 },
  { n: 'pgadmin', c: 0.01, m: 291.46 }
]

describe('toSnapshot', () => {
  it('uses the newest stats for current values', () => {
    const s = toSnapshot(system, stats, containers)
    expect(s).toMatchObject({
      name: 'vmi3542558', status: 'up', cpu: 1.82, cores: 6, memPct: 14.88, memUsed: 1.66, memTotal: 11.18,
      diskPct: 11.88, diskUsed: 22.91, diskTotal: 192.85, netSent: 128, netRecv: 130, uptime: 149736, load: [0.13, 0.2, 0.26]
    })
    expect(s.updated).toBe(Date.parse('2026-11-09T13:27:33.319Z'))
  })

  it('builds an oldest-first series with combined bandwidth and max temperature', () => {
    const { series } = toSnapshot(system, stats, containers)
    expect(series.map((p) => [p.cpu, p.net, p.load, p.temp])).toEqual([
      [4, 3000, 0.5, 41],
      [1.82, 258, 0.13, undefined]
    ])
  })

  it('sorts containers by memory', () => {
    expect(toSnapshot(system, stats, containers).containers.map((c) => c.name)).toEqual(['n8n', 'pgadmin', 'beszel-agent'])
  })

  it('converts the older MB/s network fields', () => {
    const s = toSnapshot(system, [{ created: '2026-11-09 13:27:33Z', stats: { ns: 1, nr: 0.5 } }], [])
    expect([s.netSent, s.netRecv]).toEqual([1048576, 524288])
  })

  it('falls back to the system summary when there are no stats yet', () => {
    const s = toSnapshot(system, [], [])
    expect([s.cpu, s.memPct, s.diskPct, s.series.length]).toEqual([1.82, 14.88, 11.88, 0])
  })
})
