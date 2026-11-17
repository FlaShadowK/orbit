import { promises as fs } from 'fs'
import { basename, join, posix, sep } from 'path'
import { randomUUID } from 'crypto'
import type { TransferState } from '@shared/types'
import { emit } from './events'
import { remoteFs, serverFor, isFtp, type RemoteFs } from './remoteFs'
import { closeFtp } from './ftp'

export interface TransferRequest {
  serverId: string
  direction: 'up' | 'down'
  /** local paths (upload) or remote paths (download); `dir`/`size` come from the listing when known */
  sources: { path: string; dir?: boolean; size?: number }[]
  /** destination folder: remote for uploads, local for downloads */
  target: string
}

interface Plan {
  dirs: string[]
  files: { src: string; dst: string; size: number }[]
}

const SKIP = new Set(['.DS_Store', 'Thumbs.db'])
const active = new Map<string, { state: TransferState; cancelled: boolean }>()

async function planUpload(sources: TransferRequest['sources'], target: string): Promise<Plan> {
  const plan: Plan = { dirs: [], files: [] }
  const walk = async (local: string, remote: string): Promise<void> => {
    const st = await fs.stat(local)
    if (st.isDirectory()) {
      plan.dirs.push(remote)
      for (const name of await fs.readdir(local)) if (!SKIP.has(name)) await walk(join(local, name), posix.join(remote, name))
    } else if (st.isFile()) plan.files.push({ src: local, dst: remote, size: st.size })
  }
  for (const s of sources) await walk(s.path, posix.join(target, basename(s.path)))
  return plan
}

async function planDownload(rfs: RemoteFs, sources: TransferRequest['sources'], target: string): Promise<Plan> {
  const plan: Plan = { dirs: [], files: [] }
  const walk = async (remote: string, local: string): Promise<void> => {
    plan.dirs.push(local)
    for (const e of await rfs.list(remote)) {
      if (e.dir) await walk(e.path, join(local, e.name))
      else plan.files.push({ src: e.path, dst: join(local, e.name), size: e.size ?? 0 })
    }
  }
  for (const s of sources) {
    const local = join(target, posix.basename(s.path))
    if (s.dir) await walk(s.path, local)
    else plan.files.push({ src: s.path, dst: local, size: s.size ?? 0 })
  }
  return plan
}

export function startTransfer(req: TransferRequest): string {
  const server = serverFor(req.serverId)
  const id = randomUUID()
  const label = req.sources.length === 1 ? posix.basename(req.sources[0].path.split(sep).join('/')) : `${req.sources.length} items`
  const state: TransferState = {
    id, serverId: server.id, direction: req.direction, label, target: req.target,
    bytes: 0, total: 0, files: 0, filesDone: 0, status: 'scanning'
  }
  const job = { state, cancelled: false }
  active.set(id, job)
  let last = 0
  const publish = (force = false): void => {
    const now = Date.now()
    if (!force && now - last < 120) return
    last = now
    emit({ type: 'transfer', transfer: { ...state } })
  }
  publish(true)
  void (async () => {
    const rfs = remoteFs(server.id)
    try {
      const plan = req.direction === 'up' ? await planUpload(req.sources, req.target) : await planDownload(rfs, req.sources, req.target)
      state.total = plan.files.reduce((n, f) => n + f.size, 0)
      state.files = plan.files.length
      state.status = 'running'
      publish(true)
      for (const d of plan.dirs) {
        if (req.direction === 'up') await rfs.mkdir(d)
        else await fs.mkdir(d, { recursive: true })
      }
      let doneBytes = 0
      for (const f of plan.files) {
        if (job.cancelled) break
        state.current = req.direction === 'up' ? posix.relative(req.target, f.dst) || posix.basename(f.dst) : basename(f.dst)
        const onBytes = (n: number): void => {
          state.bytes = doneBytes + Math.min(n, f.size || n)
          publish()
        }
        // folders were created above; single files land in the (existing) target folder
        if (req.direction === 'up') await rfs.upload(f.src, f.dst, onBytes)
        else await rfs.download(f.src, f.dst, onBytes)
        doneBytes += f.size
        state.bytes = doneBytes
        state.filesDone++
        publish()
      }
      state.current = undefined
      state.status = job.cancelled ? 'cancelled' : 'done'
    } catch (err) {
      state.status = job.cancelled ? 'cancelled' : 'error'
      state.error = (err as Error).message
    } finally {
      active.delete(id)
      publish(true)
    }
  })()
  return id
}

export function cancelTransfer(id: string): void {
  const job = active.get(id)
  if (!job) return
  job.cancelled = true
  // FTP can abort the file in flight by dropping the connection; SFTP stops after the current file
  const server = serverFor(job.state.serverId)
  if (isFtp(server)) closeFtp(server.id)
}
