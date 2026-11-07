export interface SshConfigHost {
  name: string
  host: string
  port: number
  username: string
  keyPath?: string
  proxyJump?: string
}

/**
 * Minimal ~/.ssh/config parser for importing servers: concrete Host blocks only.
 * Options from `Host *` blocks (and options before the first Host) are used as
 * fallbacks regardless of position.
 */
export function parseSshConfig(text: string, defaultUser: string): SshConfigHost[] {
  const blocks: { names: string[]; opts: Record<string, string> }[] = []
  const globalOpts: Record<string, string> = {}
  let current: Record<string, string> | null = globalOpts

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const m = line.match(/^(\S+?)(?:\s*=\s*|\s+)(.+)$/)
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = m[2].trim().replace(/^"(.*)"$/, '$1')
    if (key === 'host') {
      const names = value.split(/\s+/)
      if (names.length === 1 && names[0] === '*') current = globalOpts
      else {
        const block = { names, opts: {} }
        blocks.push(block)
        current = block.opts
      }
    } else if (key === 'match') {
      current = null
    } else if (current && !(key in current)) {
      current[key] = value
    }
  }

  const hosts: SshConfigHost[] = []
  for (const block of blocks) {
    for (const name of block.names) {
      if (/[*?!]/.test(name)) continue
      const o = { ...globalOpts, ...block.opts }
      hosts.push({
        name,
        host: o.hostname ?? name,
        port: Number(o.port ?? 22) || 22,
        username: o.user ?? defaultUser,
        keyPath: o.identityfile,
        proxyJump: o.proxyjump
      })
    }
  }
  return hosts
}
