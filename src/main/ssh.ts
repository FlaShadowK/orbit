import { Client, type ClientChannel, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { join, posix, relative, sep } from 'path'
import type { DirEntry, Server } from '@shared/types'
import { store } from './store'
import { shellEnv } from './shellEnv'

const MAX_OUTPUT = 200_000
const MAX_READ = 5 * 1024 * 1024

interface Conn {
  client: Client
  sftp?: Promise<SFTPWrapper>
  /** exec channels open right now, and callers waiting for one */
  execs: number
  queue: (() => void)[]
}

/**
 * sshd allows 10 channels per connection by default (MaxSessions) and every agent's ssh_exec
 * shares one pooled connection per server, so many agents at once would get "open failed".
 * Exec channels queue beyond this, leaving room for interactive SSH tabs and SFTP.
 */
const MAX_EXECS = 6

function acquireExec(conn: Conn): Promise<void> {
  if (conn.execs < MAX_EXECS) {
    conn.execs++
    return Promise.resolve()
  }
  return new Promise((res) => conn.queue.push(res))
}

function releaseExec(conn: Conn): void {
  const next = conn.queue.shift()
  if (next) next()
  else conn.execs--
}

const pool = new Map<string, Promise<Conn>>()

export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p
}

function resolveServer(idOrName: string): Server {
  const server = store.getServer(idOrName)
  if (!server) {
    const names = store.getServers().map((s) => s.name).join(', ') || '(none)'
    throw new Error(`Unknown server "${idOrName}". Known servers: ${names}`)
  }
  return server
}

function buildConfig(server: Server): ConnectConfig {
  const secret = store.getSecret(server.id)
  const cfg: ConnectConfig = {
    host: server.host,
    port: server.port || 22,
    username: server.username,
    readyTimeout: 20_000,
    keepaliveInterval: 15_000
  }
  const sock = shellEnv().SSH_AUTH_SOCK
  if (process.platform === 'win32') cfg.agent = 'pageant'
  else if (sock) cfg.agent = sock

  if (server.auth === 'password') {
    cfg.password = secret.password
    cfg.tryKeyboard = true
  } else if (server.auth === 'key') {
    if (secret.privateKey) cfg.privateKey = secret.privateKey
    else if (server.keyPath) cfg.privateKey = readFileSync(expandHome(server.keyPath))
    if (secret.passphrase) cfg.passphrase = secret.passphrase
  } else {
    // agent: also try default key files so it "just works" like the ssh CLI
    for (const name of ['id_ed25519', 'id_ecdsa', 'id_rsa']) {
      const p = join(homedir(), '.ssh', name)
      if (existsSync(p)) {
        const key = readFileSync(p)
        if (!key.toString('utf8').includes('ENCRYPTED')) {
          cfg.privateKey = key
          break
        }
      }
    }
  }
  return cfg
}

async function openClient(server: Server): Promise<Client> {
  const cfg = buildConfig(server)
  if (server.jumpServerId) {
    const jump = await connect(server.jumpServerId)
    cfg.sock = await new Promise<ClientChannel>((res, rej) =>
      jump.client.forwardOut('127.0.0.1', 0, cfg.host!, cfg.port!, (err, ch) =>
        err ? rej(err) : res(ch)
      )
    )
  }
  return new Promise((resolve, reject) => {
    const client = new Client()
    client
      .on('ready', () => resolve(client))
      .on('error', reject)
      .on('keyboard-interactive', (_n, _i, _l, prompts, finish) =>
        finish(prompts.map(() => cfg.password ?? ''))
      )
      .connect(cfg)
  })
}

export function connect(idOrName: string): Promise<Conn> {
  const server = resolveServer(idOrName)
  let p = pool.get(server.id)
  if (!p) {
    p = openClient(server).then((client) => {
      const drop = (): void => {
        pool.delete(server.id)
      }
      client.on('close', drop).on('end', drop).on('error', drop)
      return { client, execs: 0, queue: [] }
    })
    p.catch(() => pool.delete(server.id))
    pool.set(server.id, p)
  }
  return p
}

export function disconnect(serverId: string): void {
  pool.get(serverId)?.then((c) => c.client.end()).catch(() => {})
  pool.delete(serverId)
}

export async function testConnection(serverId: string): Promise<string> {
  disconnect(serverId)
  const r = await exec(serverId, 'uname -a', undefined, 15_000)
  return r.stdout.trim() || r.stderr.trim()
}

export interface ExecResult {
  stdout: string
  stderr: string
  code: number | null
  timedOut: boolean
}

export async function exec(
  idOrName: string,
  command: string,
  cwd?: string,
  timeoutMs = 120_000
): Promise<ExecResult> {
  const server = resolveServer(idOrName)
  const dir = cwd ?? server.defaultDir
  const full = dir ? `cd ${shQuote(dir)} && ${command}` : command
  const conn = await connect(server.id)
  await acquireExec(conn)
  return new Promise<ExecResult>((resolve, reject) => {
    conn.client.exec(full, (err, stream) => {
      if (err) return reject(err)
      let stdout = ''
      let stderr = ''
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        stream.signal('KILL')
        stream.close()
      }, timeoutMs)
      stream.on('data', (d: Buffer) => {
        if (stdout.length < MAX_OUTPUT) stdout += d.toString('utf8')
      })
      stream.stderr.on('data', (d: Buffer) => {
        if (stderr.length < MAX_OUTPUT) stderr += d.toString('utf8')
      })
      let exitCode: number | null = null
      stream.on('exit', (code: number | null) => {
        exitCode = code
      })
      stream.on('close', (code?: number | null) => {
        clearTimeout(timer)
        resolve({ stdout, stderr, code: exitCode ?? code ?? null, timedOut })
      })
    })
  }).finally(() => releaseExec(conn))
}

export async function sftp(idOrName: string): Promise<SFTPWrapper> {
  const conn = await connect(idOrName)
  if (!conn.sftp) {
    conn.sftp = new Promise((res, rej) => conn.client.sftp((err, s) => (err ? rej(err) : res(s))))
    conn.sftp.then((s) => s.on('close', () => (conn.sftp = undefined))).catch(() => (conn.sftp = undefined))
  }
  return conn.sftp
}

export async function remoteHome(idOrName: string): Promise<string> {
  const s = await sftp(idOrName)
  return new Promise((res, rej) => s.realpath('.', (err, p) => (err ? rej(err) : res(p))))
}

export async function sftpList(idOrName: string, path: string): Promise<DirEntry[]> {
  const s = await sftp(idOrName)
  return new Promise((res, rej) =>
    s.readdir(path, (err, list) => {
      if (err) return rej(err)
      res(
        list
          .map((e) => ({
            name: e.filename,
            path: posix.join(path, e.filename),
            dir: (e.attrs.mode & 0o170000) === 0o040000,
            size: e.attrs.size
          }))
          .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
      )
    })
  )
}

export async function sftpRead(idOrName: string, path: string): Promise<string> {
  const s = await sftp(idOrName)
  const st = await new Promise<{ size: number }>((res, rej) => s.stat(path, (e, a) => (e ? rej(e) : res(a))))
  if (st.size > MAX_READ) throw new Error(`File too large (${st.size} bytes)`)
  return new Promise((res, rej) => {
    const chunks: Buffer[] = []
    s.createReadStream(path)
      .on('data', (c: Buffer) => chunks.push(c))
      .on('error', rej)
      .on('end', () => res(Buffer.concat(chunks).toString('utf8')))
  })
}

export async function sftpWrite(idOrName: string, path: string, content: string): Promise<void> {
  const s = await sftp(idOrName)
  await sftpMkdirp(s, posix.dirname(path))
  return new Promise((res, rej) => s.writeFile(path, content, (err) => (err ? rej(err) : res())))
}

async function sftpMkdirp(s: SFTPWrapper, dir: string): Promise<void> {
  if (!dir || dir === '/' || dir === '.') return
  const exists = await new Promise<boolean>((res) => s.stat(dir, (err) => res(!err)))
  if (exists) return
  await sftpMkdirp(s, posix.dirname(dir))
  await new Promise<void>((res, rej) => s.mkdir(dir, (err) => (err ? rej(err) : res())))
}

const SKIP = new Set(['node_modules', '.git', '.DS_Store', 'dist', '.next', 'vendor'])

/** Upload a local file or directory (recursive, skipping node_modules/.git/etc). */
export async function upload(
  idOrName: string,
  localPath: string,
  remotePath: string,
  includeAll = false
): Promise<number> {
  const s = await sftp(idOrName)
  const src = expandHome(localPath)
  const files: string[] = []
  const walk = (p: string): void => {
    const st = statSync(p)
    if (st.isDirectory()) {
      for (const name of readdirSync(p)) if (includeAll || !SKIP.has(name)) walk(join(p, name))
    } else files.push(p)
  }
  walk(src)
  const isDir = statSync(src).isDirectory()
  for (const f of files) {
    const rel = isDir ? relative(src, f).split(sep).join('/') : ''
    const dest = isDir ? posix.join(remotePath, rel) : remotePath
    await sftpMkdirp(s, posix.dirname(dest))
    await new Promise<void>((res, rej) => s.fastPut(f, dest, (err) => (err ? rej(err) : res())))
  }
  return files.length
}

/** Interactive shell for SSH tabs. */
export async function openShell(
  serverId: string,
  cols: number,
  rows: number
): Promise<ClientChannel> {
  const { client } = await connect(serverId)
  const server = resolveServer(serverId)
  return new Promise((res, rej) =>
    client.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
      if (err) return rej(err)
      if (server.defaultDir) stream.write(`cd ${shQuote(server.defaultDir)}\n`)
      res(stream)
    })
  )
}
