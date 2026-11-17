export const IS_MAC = navigator.platform.toLowerCase().includes('mac')

export const uid = (): string => crypto.randomUUID()

/** FTP servers have files but no shell. */
export const isFileOnly = (s: { protocol?: string }): boolean => s.protocol === 'ftp' || s.protocol === 'ftps'

export const basename = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

export const SPACE_COLORS = ['#8b9bff', '#5eead4', '#f0abfc', '#fbbf24', '#fb7185', '#60a5fa', '#a3e635', '#fdba74']

export function langFor(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const name = basename(path).toLowerCase()
  if (name === 'dockerfile') return 'dockerfile'
  if (name === 'makefile') return 'makefile'
  if (name.startsWith('.env')) return 'ini'
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    json: 'json', md: 'markdown', css: 'css', scss: 'scss', less: 'less', html: 'html', vue: 'html',
    php: 'php', py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
    swift: 'swift', c: 'c', h: 'c', cpp: 'cpp', cs: 'csharp', sh: 'shell', bash: 'shell', zsh: 'shell',
    yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', conf: 'ini', xml: 'xml', svg: 'xml', sql: 'sql',
    graphql: 'graphql', dart: 'dart', lua: 'lua', r: 'r', tf: 'hcl', prisma: 'graphql'
  }
  return map[ext]
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  return `${Math.round(s / 3600)}h`
}

/** IPC errors arrive wrapped ("Error invoking remote method 'x': Error: …"): keep the message. */
export function cleanError(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

const IS_WIN = navigator.platform.toLowerCase().startsWith('win')
/** "Reveal in Finder" in each platform's words. */
export const REVEAL_LABEL = IS_MAC ? 'Reveal in Finder' : IS_WIN ? 'Show in Explorer' : 'Open Containing Folder'

export function fmtBytes(n?: number): string {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export function fmtDate(ms?: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? { hour: '2-digit', minute: '2-digit' } : { year: 'numeric' }) })
}

/** Download server files into a local folder the user picks. */
export async function downloadToPicked(serverId: string, sources: { path: string; dir?: boolean; size?: number }[]): Promise<void> {
  const target = await window.orbit.pickFolder()
  if (target) await window.orbit.startTransfer({ serverId, direction: 'down', sources, target })
}
