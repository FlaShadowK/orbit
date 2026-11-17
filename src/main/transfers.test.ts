import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, copyFileSync, readdirSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join, posix } from 'path'
import type { TransferState } from '@shared/types'

// The "server" is a second temp folder. Remote paths stay POSIX (/site/index.html) like on a
// real server, and are mapped onto that folder, so the test behaves the same on Windows.
const events: TransferState[] = []
let remote = ''
const disk = (p: string): string => join(remote, ...p.split('/').filter(Boolean))
vi.mock('./events', () => ({ emit: (e: { transfer: TransferState }) => events.push(e.transfer) }))
vi.mock('./ftp', () => ({ closeFtp: vi.fn() }))
vi.mock('./remoteFs', () => ({
  serverFor: (id: string) => ({ id, name: id, protocol: 'ssh' }),
  isFtp: () => false,
  remoteFs: () => ({
    list: async (dir: string) =>
      readdirSync(disk(dir)).map((name) => {
        const st = statSync(join(disk(dir), name))
        return { name, path: posix.join(dir, name), dir: st.isDirectory(), size: st.isDirectory() ? undefined : st.size }
      }),
    mkdir: async (p: string) => void mkdirSync(disk(p), { recursive: true }),
    upload: async (local: string, to: string, onBytes: (n: number) => void) => {
      copyFileSync(local, disk(to))
      onBytes(statSync(local).size)
    },
    download: async (from: string, local: string, onBytes: (n: number) => void) => {
      copyFileSync(disk(from), local)
      onBytes(statSync(disk(from)).size)
    }
  })
}))

const { startTransfer } = await import('./transfers')

let local: string

beforeEach(() => {
  events.length = 0
  local = mkdtempSync(join(tmpdir(), 'orbit-local-'))
  remote = mkdtempSync(join(tmpdir(), 'orbit-remote-'))
})
afterEach(() => {
  rmSync(local, { recursive: true, force: true })
  rmSync(remote, { recursive: true, force: true })
})

async function finished(id: string): Promise<TransferState> {
  for (let i = 0; i < 200; i++) {
    const last = events.filter((e) => e.id === id).at(-1)
    if (last && ['done', 'error', 'cancelled'].includes(last.status)) return last
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error('transfer did not finish')
}

describe('startTransfer', () => {
  it('uploads a folder tree, skipping .DS_Store, and reports totals', async () => {
    mkdirSync(join(local, 'site', 'assets', 'empty'), { recursive: true })
    writeFileSync(join(local, 'site', 'index.html'), '<h1>hi</h1>')
    writeFileSync(join(local, 'site', 'assets', 'app.js'), 'console.log(1)')
    writeFileSync(join(local, 'site', '.DS_Store'), 'junk')

    const id = startTransfer({ serverId: 's', direction: 'up', sources: [{ path: join(local, 'site') }], target: '/' })
    const end = await finished(id)

    expect(end.status).toBe('done')
    expect(end.files).toBe(2)
    expect(end.filesDone).toBe(2)
    expect(end.bytes).toBe(end.total)
    expect(end.total).toBe('<h1>hi</h1>'.length + 'console.log(1)'.length)
    expect(readFileSync(join(remote, 'site', 'assets', 'app.js'), 'utf8')).toBe('console.log(1)')
    // empty folders come along too, junk files don't
    expect(existsSync(join(remote, 'site', 'assets', 'empty'))).toBe(true)
    expect(existsSync(join(remote, 'site', '.DS_Store'))).toBe(false)
    expect(events[0].status).toBe('scanning')
  })

  it('downloads single files and folders into the target', async () => {
    mkdirSync(join(remote, 'logs'))
    writeFileSync(join(remote, 'logs', 'a.log'), 'aaa')
    writeFileSync(join(remote, 'photo.png'), 'png!')

    const id = startTransfer({
      serverId: 's',
      direction: 'down',
      sources: [{ path: '/logs', dir: true }, { path: '/photo.png', size: 4 }],
      target: local
    })
    const end = await finished(id)

    expect(end.status).toBe('done')
    expect(end.label).toBe('2 items')
    expect(readFileSync(join(local, 'logs', 'a.log'), 'utf8')).toBe('aaa')
    expect(readFileSync(join(local, 'photo.png'), 'utf8')).toBe('png!')
  })

  it('reports an error when a source is missing', async () => {
    const id = startTransfer({ serverId: 's', direction: 'up', sources: [{ path: join(local, 'nope.txt') }], target: '/' })
    const end = await finished(id)
    expect(end.status).toBe('error')
    expect(end.error).toMatch(/ENOENT/)
  })
})
