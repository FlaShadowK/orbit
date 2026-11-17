import { Client, type FileInfo } from 'basic-ftp'
import { posix } from 'path'
import type { Server } from '@shared/types'
import { store } from './store'

/**
 * FTP allows one command at a time per connection, so each server gets one pooled client and
 * every operation on it runs in turn. A dropped connection is reopened on the next call.
 */
const clients = new Map<string, Client>()
const queues = new Map<string, Promise<unknown>>()
/** the folder each login lands in (operations like ensureDir move the working folder away from it) */
const homes = new Map<string, string>()

async function open(server: Server): Promise<Client> {
  const existing = clients.get(server.id)
  if (existing && !existing.closed) return existing
  const client = new Client(30_000)
  const secret = store.getSecret(server.id)
  await client.access({
    host: server.host,
    port: server.port || 21,
    user: server.username,
    password: secret.password ?? '',
    secure: server.protocol === 'ftps'
  })
  homes.set(server.id, await client.pwd())
  clients.set(server.id, client)
  return client
}

/** Absolute path on the server; relative paths ("." too) are taken from the login folder. */
export function ftpPath(serverId: string, path: string): string {
  return path.startsWith('/') ? path : posix.join(homes.get(serverId) ?? '/', path)
}

export function ftpHome(serverId: string): string {
  return homes.get(serverId) ?? '/'
}

/** Run `fn` with this server's client once earlier operations have finished. */
export function withFtp<T>(server: Server, fn: (c: Client) => Promise<T>): Promise<T> {
  const prev = queues.get(server.id) ?? Promise.resolve()
  const run = prev.then(async () => {
    let client = await open(server)
    try {
      return await fn(client)
    } catch (err) {
      // the server hung up between calls: reconnect once and retry
      if (!client.closed) throw err
      clients.delete(server.id)
      client = await open(server)
      return fn(client)
    }
  })
  queues.set(server.id, run.catch(() => {}))
  return run
}

export function closeFtp(serverId: string): void {
  clients.get(serverId)?.close()
  clients.delete(serverId)
}

export function toEntry(dir: string, f: FileInfo): { name: string; path: string; dir: boolean; size?: number; mtime?: number } {
  return {
    name: f.name,
    path: posix.join(dir, f.name),
    dir: f.isDirectory,
    size: f.isDirectory ? undefined : f.size,
    mtime: f.modifiedAt?.getTime()
  }
}
