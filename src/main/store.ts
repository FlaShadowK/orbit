import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { Server, ServerInput, ServerSecret, Settings, Space, SpaceGroup } from '@shared/types'

interface Data {
  spaces: Space[]
  activeSpaceId?: string
  /** sidebar folders */
  groups?: SpaceGroup[]
  servers: Server[]
  secrets: Record<string, string>
  settings: Settings
}

const DEFAULT_SETTINGS: Settings = {
  fontSize: 13,
  defaultAgent: 'claude',
  agentCommands: {}
}

class Store {
  private file = ''
  private data: Data = { spaces: [], servers: [], secrets: {}, settings: DEFAULT_SETTINGS }
  private timer: NodeJS.Timeout | null = null
  onServersChanged: ((servers: Server[]) => void) | null = null

  load(): void {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'orbit.json')
    if (existsSync(this.file)) {
      try {
        const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Data>
        this.data = {
          spaces: parsed.spaces ?? [],
          activeSpaceId: parsed.activeSpaceId,
          groups: parsed.groups ?? [],
          servers: parsed.servers ?? [],
          secrets: parsed.secrets ?? {},
          settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) }
        }
      } catch (err) {
        console.error('[orbit] failed to read store, starting fresh', err)
      }
    }
  }

  private save(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 250)
  }

  flush(): void {
    if (!this.file) return
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(this.data, null, 2))
    renameSync(tmp, this.file)
  }

  // ---- spaces
  getSpaces(): { spaces: Space[]; activeSpaceId?: string; groups: SpaceGroup[] } {
    return { spaces: this.data.spaces, activeSpaceId: this.data.activeSpaceId, groups: this.data.groups ?? [] }
  }
  setSpaces(spaces: Space[], activeSpaceId?: string, groups?: SpaceGroup[]): void {
    this.data.spaces = spaces
    this.data.activeSpaceId = activeSpaceId
    if (groups) this.data.groups = groups
    this.save()
  }

  // ---- settings
  getSettings(): Settings {
    return this.data.settings
  }
  setSettings(patch: Partial<Settings>): Settings {
    this.data.settings = { ...this.data.settings, ...patch }
    this.save()
    return this.data.settings
  }

  // ---- servers
  getServers(): Server[] {
    return this.data.servers
  }
  getServer(idOrName: string): Server | undefined {
    const q = idOrName.toLowerCase()
    return (
      this.data.servers.find((s) => s.id === idOrName) ??
      this.data.servers.find((s) => s.name.toLowerCase() === q) ??
      this.data.servers.find((s) => s.host.toLowerCase() === q)
    )
  }
  upsertServer(input: ServerInput): Server {
    const { secret, ...rest } = input
    const id = input.id ?? randomUUID()
    const server: Server = { ...rest, id, tags: rest.tags ?? [] }
    const idx = this.data.servers.findIndex((s) => s.id === id)
    if (idx >= 0) this.data.servers[idx] = server
    else this.data.servers.push(server)
    if (secret) {
      const clean = Object.fromEntries(Object.entries(secret).filter(([, v]) => v)) as ServerSecret
      // merge so leaving a field blank in the form keeps the existing value
      this.setSecret(id, { ...this.getSecret(id), ...clean })
    }
    this.save()
    this.onServersChanged?.(this.data.servers)
    return server
  }
  removeServer(id: string): void {
    this.data.servers = this.data.servers.filter((s) => s.id !== id)
    delete this.data.secrets[id]
    this.save()
    this.onServersChanged?.(this.data.servers)
  }

  getSecret(id: string): ServerSecret {
    const enc = this.data.secrets[id]
    if (!enc) return {}
    try {
      const buf = Buffer.from(enc, 'base64')
      const json = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(buf)
        : buf.toString('utf8')
      return JSON.parse(json) as ServerSecret
    } catch {
      return {}
    }
  }
  private setSecret(id: string, secret: ServerSecret): void {
    const json = JSON.stringify(secret)
    const buf = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(json)
      : Buffer.from(json, 'utf8')
    this.data.secrets[id] = buf.toString('base64')
  }
}

export const store = new Store()
