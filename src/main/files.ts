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

export function watchRoot(root: string): void {
  if (watchers.has(root)) return
  const w = chokidar.watch(root, {
    ignoreInitial: true,
    ignored: (p: string) => p.split(/[\\/]/).some((seg) => HIDDEN.has(seg)),
    depth: 12,
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 50 }
  })
  w.on('all', (event, path) => emit({ type: 'fs', root, path, event }))
  watchers.set(root, w)
}

export function unwatchRoot(root: string): void {
  watchers.get(root)?.close()
  watchers.delete(root)
}

export function unwatchAll(): void {
  for (const r of [...watchers.keys()]) unwatchRoot(r)
}
