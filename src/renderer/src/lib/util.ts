export const uid = (): string => crypto.randomUUID()

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
