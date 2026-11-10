import { app } from 'electron'
import { monitorEventLoopDelay } from 'perf_hooks'

/**
 * Opt-in performance telemetry for stress runs (ORBIT_PERF=1). Prints one JSON line per
 * second to stdout: main event-loop delay, IPC traffic and per-process CPU / memory.
 * Costs nothing when the variable is unset.
 */
export const PERF = !!process.env.ORBIT_PERF

const counters = { ipcMsgs: 0, ipcBytes: 0, ptyChunks: 0, ptyBytes: 0 }

export function countIpc(bytes: number): void {
  if (!PERF) return
  counters.ipcMsgs++
  counters.ipcBytes += bytes
}

export function countPty(bytes: number): void {
  if (!PERF) return
  counters.ptyChunks++
  counters.ptyBytes += bytes
}

export function startPerf(): void {
  if (!PERF) return
  const RES = 5
  const h = monitorEventLoopDelay({ resolution: RES })
  // the histogram includes its own sampling interval; report only the excess
  const ms = (ns: number): number => Math.max(0, +(ns / 1e6 - RES).toFixed(2))
  h.enable()
  setInterval(() => {
    const procs = app.getAppMetrics().map((m) => ({
      type: m.type,
      cpu: Math.round(m.cpu.percentCPUUsage * 10) / 10,
      mem: Math.round((m.memory.workingSetSize ?? 0) / 1024)
    }))
    const line = {
      t: Date.now(),
      lagP50: ms(h.percentile(50)),
      lagP99: ms(h.percentile(99)),
      lagMax: ms(h.max),
      ...counters,
      procs
    }
    process.stdout.write(`[orbit-perf] ${JSON.stringify(line)}\n`)
    h.reset()
    counters.ipcMsgs = counters.ipcBytes = counters.ptyChunks = counters.ptyBytes = 0
  }, 1000).unref()
}
