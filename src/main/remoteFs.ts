import { createHash } from 'crypto'
import { app } from 'electron'
import { mkdirSync, promises as fs } from 'fs'
import { join, posix } from 'path'
import { Readable, Writable } from 'stream'
import type { SFTPWrapper } from 'ssh2'
import type { DirEntry, Server } from '@shared/types'
import { store } from './store'
import * as ssh from './ssh'
import type { Client } from 'basic-ftp'
import { ftpHome, ftpPath, toEntry, withFtp } from './ftp'

const MAX_TEXT = 5 * 1024 * 1024

/** Files on a server, over SFTP or FTP. All paths are absolute POSIX paths. */
export interface RemoteFs {
  home(): Promise<string>
  list(path: string): Promise<DirEntry[]>
  readText(path: string): Promise<string>
  writeText(path: string, content: string): Promise<void>
  mkdir(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  remove(path: string, dir: boolean): Promise<void>
  /** copy one file; `onBytes` gets the running total */
  upload(local: string, remote: string, onBytes: (n: number) => void): Promise<void>
  download(remote: string, local: string, onBytes: (n: number) => void): Promise<void>
}

export function serverFor(idOrName: string): Server {
  const s = store.getServer(idOrName)
  if (!s) throw new Error(`Unknown server "${idOrName}"`)
  return s
}

export const isFtp = (s: Server): boolean => s.protocol === 'ftp' || s.protocol === 'ftps'

const sortEntries = (list: DirEntry[]): DirEntry[] =>
  list.filter((e) => e.name !== '.' && e.name !== '..').sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))

const cb = <T = void>(fn: (done: (err: Error | null | undefined, v?: T) => void) => void): Promise<T> =>
  new Promise((res, rej) => fn((err, v) => (err ? rej(err) : res(v as T))))

function sftpFs(server: Server): RemoteFs {
  const s = (): Promise<SFTPWrapper> => ssh.sftp(server.id)
  const removeTree = async (sf: SFTPWrapper, path: string): Promise<void> => {
    const list = await cb<{ filename: string; attrs: { mode: number } }[]>((d) => sf.readdir(path, d))
    for (const e of list) {
      if (e.filename === '.' || e.filename === '..') continue
      const p = posix.join(path, e.filename)
      if ((e.attrs.mode & 0o170000) === 0o040000) await removeTree(sf, p)
      else await cb((d) => sf.unlink(p, d))
    }
    await cb((d) => sf.rmdir(path, d))
  }
  return {
    home: () => ssh.remoteHome(server.id),
    list: async (path) => sortEntries(await ssh.sftpList(server.id, path)),
    readText: (path) => ssh.sftpRead(server.id, path),
    writeText: (path, content) => ssh.sftpWrite(server.id, path, content),
    mkdir: async (path) => ssh.sftpMkdirp(await s(), path),
    rename: async (from, to) => {
      const sf = await s()
      await cb((d) => sf.rename(from, to, d))
    },
    remove: async (path, dir) => {
      const sf = await s()
      if (dir) await removeTree(sf, path)
      else await cb((d) => sf.unlink(path, d))
    },
    upload: async (local, remote, onBytes) => {
      const sf = await s()
      await cb((d) => sf.fastPut(local, remote, { step: (total) => onBytes(total) }, d))
    },
    download: async (remote, local, onBytes) => {
      const sf = await s()
      await cb((d) => sf.fastGet(remote, local, { step: (total) => onBytes(total) }, d))
    }
  }
}

function ftpFs(server: Server): RemoteFs {
  const ftp = <T>(fn: (c: Client) => Promise<T>): Promise<T> => withFtp(server, fn)
  const abs = (p: string): string => ftpPath(server.id, p)
  return {
    home: () => ftp(async () => ftpHome(server.id)),
    list: (path) =>
      ftp(async (c) => {
        const dir = abs(path)
        return sortEntries((await c.list(dir)).map((f) => toEntry(dir, f)))
      }),
    readText: (path) =>
      ftp(async (c) => {
        const chunks: Buffer[] = []
        let size = 0
        const sink = new Writable({
          write(chunk: Buffer, _enc, done) {
            size += chunk.length
            if (size > MAX_TEXT) return done(new Error(`File too large (over ${MAX_TEXT / 1024 / 1024} MB)`))
            chunks.push(chunk)
            done()
          }
        })
        await c.downloadTo(sink, abs(path))
        return Buffer.concat(chunks).toString('utf8')
      }),
    writeText: (path, content) =>
      ftp(async (c) => {
        await c.ensureDir(posix.dirname(abs(path)))
        await c.uploadFrom(Readable.from(Buffer.from(content, 'utf8')), abs(path))
      }),
    mkdir: (path) => ftp((c) => c.ensureDir(abs(path))),
    rename: (from, to) => ftp(async (c) => void (await c.rename(abs(from), abs(to)))),
    remove: (path, dir) => ftp(async (c) => void (dir ? await c.removeDir(abs(path)) : await c.remove(abs(path)))),
    upload: (local, remote, onBytes) =>
      ftp(async (c) => {
        c.trackProgress((info) => onBytes(info.bytes))
        try {
          await c.uploadFrom(local, abs(remote))
        } finally {
          c.trackProgress()
        }
      }),
    download: (remote, local, onBytes) =>
      ftp(async (c) => {
        c.trackProgress((info) => onBytes(info.bytes))
        try {
          await c.downloadTo(local, abs(remote))
        } finally {
          c.trackProgress()
        }
      })
  }
}

export function remoteFs(idOrName: string): RemoteFs {
  const server = serverFor(idOrName)
  return isFtp(server) ? ftpFs(server) : sftpFs(server)
}

const MAX_CACHE = 512 * 1024 * 1024

/**
 * A local copy of a remote file, for previews (images, PDF, video) and "open with default app".
 * Reused while the remote size and date are unchanged.
 */
export async function cacheRemoteFile(serverId: string, path: string, size?: number, mtime?: number): Promise<string> {
  if (size != null && size > MAX_CACHE) throw new Error('File is too large to preview')
  const key = createHash('sha1').update(`${serverId}:${path}`).digest('hex').slice(0, 16)
  const dir = join(app.getPath('temp'), 'orbit-remote', key)
  mkdirSync(dir, { recursive: true })
  const local = join(dir, posix.basename(path))
  const stamp = join(dir, '.stamp')
  const want = `${size ?? '?'}:${mtime ?? '?'}`
  if (size != null && mtime != null) {
    const have = await fs.readFile(stamp, 'utf8').catch(() => '')
    if (have === want) return local
  }
  await remoteFs(serverId).download(path, local, () => {})
  await fs.writeFile(stamp, want)
  return local
}
