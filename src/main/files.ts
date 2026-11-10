import { promises as fs } from 'fs'
import { join } from 'path'
import chokidar, { type FSWatcher } from 'chokidar'
import type { DirEntry } from '@shared/types'
import { emit } from './events'

const HIDDEN = new Set(['.git', 'node_modules', '.DS_Store', '.next', '.idea', '.turbo', '.cache'])
const MAX_READ = 10 * 1024 * 1024

export async function listDir(dir: string): Promise<DirEntry[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  return entries
    .filter((e) => e.name !== '.DS_Store')
    .map((e) => ({ name: e.name, path: join(dir, e.name), dir: e.isDirectory() }))
    .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
}

export async function readFile(path: string): Promise<string> {
  const st = await fs.stat(path)
  if (st.size > MAX_READ) throw new Error(`File too large to edit (${Math.round(st.size / 1024)} KB)`)
  const buf = await fs.readFile(path)
  if (buf.subarray(0, 8000).includes(0)) throw new Error('Binary file — cannot open in editor')
  return buf.toString('utf8')
}

export async function writeFile(path: string, content: string): Promise<void> {
  await fs.writeFile(path, content, 'utf8')
}

const watchers = new Map<string, FSWatcher>()

// Agents can touch hundreds of files a second (builds, generated code, test output). Each
// change is queued and sent as one event per root every FS_FLUSH_MS, last event per path.
const FS_FLUSH_MS = 200
const MAX_CHANGES = 1000
const queued = new Map<string, Map<string, string>>()
let fsTimer: NodeJS.Timeout | null = null

function queueChange(root: string, path: string, event: string): void {
  let q = queued.get(root)
  if (!q) queued.set(root, (q = new Map()))
  q.delete(path) // keep insertion order = order of last change
  if (q.size < MAX_CHANGES) q.set(path, event)
  fsTimer ??= setTimeout(flushChanges, FS_FLUSH_MS)
}

function flushChanges(): void {
  fsTimer = null
  for (const [root, q] of queued) emit({ type: 'fs', root, changes: [...q].map(([path, event]) => ({ path, event })) })
  queued.clear()
}

export function watchRoot(root: string): void {
  if (watchers.has(root)) return
  const w = chokidar.watch(root, {
    ignoreInitial: true,
    ignored: (p: string) => p.split(/[\\/]/).some((seg) => HIDDEN.has(seg)),
    depth: 12,
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 50 }
  })
  w.on('all', (event, path) => queueChange(root, path, event))
  watchers.set(root, w)
}

export function unwatchRoot(root: string): void {
  watchers.get(root)?.close()
  watchers.delete(root)
}

export function unwatchAll(): void {
  for (const r of [...watchers.keys()]) unwatchRoot(r)
}
