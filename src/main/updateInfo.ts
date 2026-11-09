export interface UpdateFile {
  url: string
  sha512: string
  size?: number
}
export interface UpdateInfo {
  version: string
  files: UpdateFile[]
}

/**
 * Parse electron-builder's latest-mac.yml. The format is fixed and flat, so a tiny
 * line parser avoids pulling in a YAML library:
 *
 *   version: 0.1.1
 *   files:
 *     - url: Orbit-0.1.1-mac-arm64.zip
 *       sha512: <base64>
 *       size: 123
 */
export function parseLatestYml(text: string): UpdateInfo {
  const unquote = (v: string): string => v.trim().replace(/^['"]|['"]$/g, '')
  let version = ''
  const files: UpdateFile[] = []
  let inFiles = false
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue
    const top = raw.match(/^(\w+):\s*(.*)$/)
    if (top) {
      inFiles = top[1] === 'files'
      if (top[1] === 'version') version = unquote(top[2])
      continue
    }
    if (!inFiles) continue
    const item = raw.match(/^\s*(-\s+)?(\w+):\s*(.*)$/)
    if (!item) continue
    const [, dash, key, value] = item
    if (dash) files.push({ url: '', sha512: '' })
    const f = files[files.length - 1]
    if (!f) continue
    if (key === 'url') f.url = unquote(value)
    else if (key === 'sha512') f.sha512 = unquote(value)
    else if (key === 'size') f.size = Number(value)
  }
  if (!version) throw new Error('latest-mac.yml has no version')
  return { version, files: files.filter((f) => f.url && f.sha512) }
}

/** Compare x.y.z versions (a leading "v" and pre-release suffixes are tolerated). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] => v.replace(/^v/, '').split(/[-+]/)[0].split('.').map((n) => Number(n) || 0)
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return Math.sign(d)
  }
  return 0
}
