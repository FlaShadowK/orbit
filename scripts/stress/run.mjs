#!/usr/bin/env node
// Stress test: N fake agents streaming at once in one Orbit space, measured from outside.
//
//   npm run build && node scripts/stress/run.mjs --agents 30 --duration 30
//
// Seeds a throwaway profile (ORBIT_USER_DATA) with one space holding N agent terminals plus a
// "probe" terminal, launches Electron with ORBIT_PERF=1 and a CDP port, starts the fake agent
// in every terminal, then measures for --duration seconds:
//   - keystroke echo latency in the focused probe terminal (raw `cat`: renderer → main → pty → back)
//   - main-process event-loop delay, IPC messages/s, per-process CPU and memory (ORBIT_PERF lines)
//   - renderer main-thread busy % and JS heap (CDP Performance.getMetrics)
import { spawn, execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, appendFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const FAKE = join(ROOT, 'scripts/stress/claude.mjs')
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : def
}
const N = +arg('agents', 20)
const DURATION = +arg('duration', 30)
const WARMUP = +arg('warmup', 10)
const VISIBLE = Math.min(+arg('visible', 4), N + 1)
const LABEL = arg('label', 'run')
const OUT = arg('out')
const INTENSITY = arg('intensity', '1')
const CYCLE = process.argv.includes('--cycle')
const PORT = 9300 + Math.floor(Math.random() * 500)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- profile + project
const tmp = mkdtempSync(join(tmpdir(), 'orbit-stress-'))
const userData = join(tmp, 'userData')
const project = join(tmp, 'project')
mkdirSync(userData, { recursive: true })
mkdirSync(project, { recursive: true })
writeFileSync(join(project, 'README.md'), '# stress\n')
execFileSync('git', ['init', '-q'], { cwd: project })
execFileSync('git', ['-c', 'user.email=s@s', '-c', 'user.name=s', 'commit', '-qm', 'init', '--allow-empty'], { cwd: project })

const probe = { id: 'probe', kind: 'terminal', title: 'probe' }
const agents = Array.from({ length: N }, (_, i) => ({ id: `agent${i}`, kind: 'terminal', title: `agent ${i}` }))
const tabs = [probe, ...agents]
let nid = 0
const leaf = (tabId) => ({ type: 'leaf', id: `l${nid++}`, tabId })
const grid = (ids) => {
  if (ids.length === 1) return leaf(ids[0])
  const mid = Math.ceil(ids.length / 2)
  return { type: 'split', id: `s${nid++}`, dir: nid % 2 ? 'row' : 'column', ratio: 0.5, a: grid(ids.slice(0, mid)), b: grid(ids.slice(mid)) }
}
const space = {
  id: 'stress', name: 'stress', root: project, color: '#7c8cff', tabs,
  activeTabId: 'probe', layout: grid(tabs.slice(0, VISIBLE).map((t) => t.id))
}
writeFileSync(
  join(userData, 'orbit.json'),
  JSON.stringify({ spaces: [space], activeSpaceId: 'stress', servers: [], secrets: {}, settings: { fontSize: 13, defaultAgent: 'claude', agentCommands: {}, autoUpdate: false } })
)

// ---- launch
const perf = []
const electron = spawn(join(ROOT, 'node_modules/.bin/electron'), [
  '.',
  `--remote-debugging-port=${PORT}`,
  // measure the same whether or not the window is covered by others
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows'
], {
  cwd: ROOT,
  env: { ...process.env, ORBIT_USER_DATA: userData, ORBIT_PERF: '1', FAKE_INTENSITY: INTENSITY },
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe']
})
let buf = ''
electron.stdout.on('data', (d) => {
  buf += d
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const l = buf.slice(0, i)
    buf = buf.slice(i + 1)
    if (l.startsWith('[orbit-perf] ')) perf.push(JSON.parse(l.slice(13)))
  }
})
electron.stderr.on('data', () => {})
const cleanup = () => {
  try { process.kill(-electron.pid, 'SIGKILL') } catch {}
  try { execFileSync('pkill', ['-f', FAKE]) } catch {}
  try { rmSync(tmp, { recursive: true, force: true }) } catch {}
}
process.on('SIGINT', () => { cleanup(); process.exit(130) })

// ---- CDP
async function target() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
      if (page) return page.webSocketDebuggerUrl
    } catch {}
    await sleep(200)
  }
  throw new Error('no renderer target')
}
const ws = new WebSocket(await target())
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let msgId = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
})
const cdp = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++msgId
    const timer = setTimeout(() => rej(new Error(`CDP ${method} timed out`)), 60_000)
    pending.set(id, (m) => {
      clearTimeout(timer)
      m.error ? rej(new Error(m.error.message)) : res(m.result)
    })
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expr) => {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(`page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
  return r.result.value
}
const metrics = async () => Object.fromEntries((await cdp('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))

await cdp('Runtime.enable')
await cdp('Performance.enable')
for (let i = 0; i < 150; i++) {
  if ((await evaluate(`document.querySelectorAll('.terminal-host').length`)) >= tabs.length) break
  await sleep(200)
}
console.error(`[stress] ${LABEL}: ${N} agents, ${VISIBLE} visible panes, CDP port ${PORT} — shells starting`)
// type into each shell only once its prompt is up (zsh drops typeahead during startup)
const ready = (id) => `window.orbit.termStart({ id: '${id}', kind: 'pty', cols: 80, rows: 24 }).then((r) => (r.replay || '').length)`
const waitPrompt = async (id) => {
  for (let i = 0; i < 300; i++) {
    if ((await evaluate(ready(id))) > 0) return
    await sleep(100)
  }
  throw new Error(`no prompt in ${id}`)
}
await Promise.all(tabs.map((t) => waitPrompt(t.id)))
console.error('[stress] all prompts up')
await sleep(1500)
await evaluate(`(() => {
  window.orbit.termWrite('probe', 'stty raw -echo && cat\\r');
  ${JSON.stringify(agents.map((a) => a.id))}.forEach((id) => window.orbit.termWrite(id, 'clear; node ${FAKE}\\r'))
})()`)
console.error(`[stress] agents launched, warming up ${WARMUP}s`)
await sleep(WARMUP * 1000)

if (CYCLE) {
  console.error('[stress] visiting every tab')
  for (let i = 0; i < tabs.length; i++) {
    await evaluate(`document.querySelectorAll('.tabs .tab')[${i}]?.click()`)
    await sleep(150)
  }
  await evaluate(`document.querySelectorAll('.tabs .tab')[0]?.click()`)
  await sleep(1000)
}

// ---- measure
await evaluate(`(() => {
  const R = (window.__stress = { lat: [], longTasks: 0, longTaskMs: 0, frames: 0, maxFrameGap: 0 })
  const q = []
  R.bytes = {}
  window.orbit.onTermData((id, data) => {
    R.bytes[id] = (R.bytes[id] || 0) + data.length
    if (id !== 'probe') return
    for (const ch of data) if (q.length && q[0].ch === ch) R.lat.push(performance.now() - q.shift().t)
  })
  let i = 0
  R.timer = setInterval(() => {
    const ch = 'abcdefghijklmnopqrstuvwxyz'[i++ % 26]
    q.push({ ch, t: performance.now() })
    if (q.length > 40) q.shift()
    window.orbit.termWrite('probe', ch)
  }, 100)
  new PerformanceObserver((l) => { for (const e of l.getEntries()) { R.longTasks++; R.longTaskMs += e.duration } }).observe({ type: 'longtask' })
  let last = performance.now()
  const raf = () => { const n = performance.now(); R.maxFrameGap = Math.max(R.maxFrameGap, n - last); last = n; R.frames++; if (!R.stop) requestAnimationFrame(raf) }
  requestAnimationFrame(raf)
  R.webglLost = 0
  const orig = HTMLCanvasElement.prototype.getContext
  // count only contexts Chromium took away, not ones Orbit released on purpose
  document.addEventListener('webglcontextlost', (e) => { if (!e.target?.dataset?.orbitReleased) R.webglLost++ }, true)
  if (${CYCLE}) {
    // keep flipping between agent tabs in the focused pane while measuring (probe stays visible)
    let k = 1
    R.cycler = setInterval(() => {
      const tabs = document.querySelectorAll('.tabs .tab')
      k = (k % (tabs.length - 1)) + 1
      tabs[k]?.click()
    }, 1000)
  }
})()`)
const m0 = await metrics()
const t0 = Date.now()
// %CPU and RSS of Orbit's own processes (Electron main, renderer, GPU…; shells and agents are
// in their own sessions so they don't count)
const psSamples = []
const psTimer = setInterval(() => {
  try {
    const rows = execFileSync('ps', ['-A', '-o', 'pgid=,pcpu=,rss=']).toString().trim().split('\n')
    let cpu = 0, rss = 0
    for (const r of rows) {
      const [g, c, m] = r.trim().split(/\s+/).map(Number)
      if (g === electron.pid) { cpu += c; rss += m }
    }
    psSamples.push({ cpu, rss })
  } catch {}
}, 1000)
await sleep(DURATION * 1000)
clearInterval(psTimer)
const m1 = await metrics()
const t1 = Date.now()
const replay = process.env.STRESS_DEBUG ? await evaluate(`window.orbit.termStart({ id: 'agent0', kind: 'pty', cols: 80, rows: 24 }).then((r) => (r.replay || '').slice(-600))`) : undefined
const r = await evaluate(`(() => { const R = window.__stress; R.stop = true; clearInterval(R.timer); clearInterval(R.cycler); return {
  lat: R.lat, longTasks: R.longTasks, longTaskMs: R.longTaskMs, frames: R.frames, maxFrameGap: R.maxFrameGap,
  dots: document.querySelectorAll('.tab .status-dot').length, webgl: document.querySelectorAll('.xterm-screen canvas').length, domRows: document.querySelectorAll('.xterm-rows').length, webglLost: R.webglLost, visibleDom: [...document.querySelectorAll('.pane')].filter((p) => p.style.display !== 'none' && p.querySelector('.xterm-rows')).length, visiblePanes: [...document.querySelectorAll('.pane')].filter((p) => p.style.display !== 'none').length, bytes: R.bytes
} })()`)
ws.close()
cleanup()

// ---- report
const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : NaN)
const win = perf.filter((p) => p.t >= t0 && p.t <= t1)
const avg = (f) => win.reduce((s, p) => s + f(p), 0) / (win.length || 1)
const byType = (p, type, k) => p.procs.filter((x) => x.type === type).reduce((s, x) => s + x[k], 0)
const secs = (t1 - t0) / 1000
const result = {
  label: LABEL,
  agents: N,
  visible: VISIBLE,
  echoP50: +pct(r.lat, 50).toFixed(1),
  echoP95: +pct(r.lat, 95).toFixed(1),
  echoP99: +pct(r.lat, 99).toFixed(1),
  echoMax: +Math.max(...r.lat).toFixed(1),
  echoSamples: r.lat.length,
  mainLagP99: +avg((p) => p.lagP99).toFixed(1),
  mainLagMax: +Math.max(0, ...win.map((p) => p.lagMax)).toFixed(1),
  ipcPerSec: Math.round(avg((p) => p.ipcMsgs)),
  ipcKBps: Math.round(avg((p) => p.ipcBytes) / 1024),
  ptyChunksPerSec: Math.round(avg((p) => p.ptyChunks)),
  ptyKBps: Math.round(avg((p) => p.ptyBytes) / 1024),
  cpuMain: +avg((p) => byType(p, 'Browser', 'cpu')).toFixed(1),
  cpuRenderer: +avg((p) => byType(p, 'Tab', 'cpu')).toFixed(1),
  cpuGpu: +avg((p) => byType(p, 'GPU', 'cpu')).toFixed(1),
  memMB: Math.round(avg((p) => p.procs.reduce((s, x) => s + x.mem, 0))),
  orbitCpuPct: Math.round(psSamples.reduce((s, x) => s + x.cpu, 0) / (psSamples.length || 1)),
  orbitRssMB: Math.round(Math.max(0, ...psSamples.map((x) => x.rss)) / 1024),
  rendererBusyPct: Math.round(((m1.TaskDuration - m0.TaskDuration) / secs) * 100),
  rendererHeapMB: Math.round(m1.JSHeapUsedSize / 1048576),
  longTaskMsPerSec: Math.round(r.longTaskMs / secs),
  fps: Math.round(r.frames / secs),
  maxFrameGapMs: Math.round(r.maxFrameGap),
  statusDots: r.dots,
  webglCanvases: r.webgl,
  domRenderers: r.domRows,
  webglLost: r.webglLost,
  visiblePanes: r.visiblePanes,
  visibleOnDomRenderer: r.visibleDom
}
if (process.env.STRESS_DEBUG) console.error(JSON.stringify({ bytes: r.bytes, lastPerf: win.at(-1), replay }))
console.log(JSON.stringify(result))
if (OUT) appendFileSync(OUT, JSON.stringify(result) + '\n')
process.exit(0)
