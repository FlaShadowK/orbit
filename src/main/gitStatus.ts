import type { GitChange, GitChangeKind } from '@shared/types'

export interface ParsedStatus {
  branch: string
  detached: boolean
  upstream?: string
  ahead: number
  behind: number
  files: Omit<GitChange, 'abs'>[]
}

function kindOf(xy: string): GitChangeKind {
  if (xy.includes('R')) return 'renamed'
  if (xy.includes('A')) return 'added'
  if (xy.includes('D')) return 'deleted'
  return 'modified'
}

/**
 * Parse `git status --porcelain=v2 --branch -z`.
 * Paths are relative to the repository root.
 */
export function parsePorcelainV2(out: string): ParsedStatus {
  const st: ParsedStatus = { branch: '', detached: false, ahead: 0, behind: 0, files: [] }
  const fields = out.split('\0')
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]
    if (!f) continue
    if (f.startsWith('# branch.head ')) {
      const head = f.slice(14)
      st.detached = head === '(detached)'
      st.branch = st.detached ? 'HEAD' : head
    } else if (f.startsWith('# branch.upstream ')) st.upstream = f.slice(18)
    else if (f.startsWith('# branch.ab ')) {
      const m = f.match(/\+(\d+) -(\d+)/)
      if (m) [st.ahead, st.behind] = [Number(m[1]), Number(m[2])]
    } else if (f.startsWith('1 ') || f.startsWith('2 ')) {
      const parts = f.split(' ')
      const xy = parts[1]
      // ordinary: 8 fields before the path; renamed/copied: 9 (score) and the original path follows as its own field
      const path = parts.slice(f[0] === '1' ? 8 : 9).join(' ')
      const origPath = f[0] === '2' ? fields[++i] : undefined
      st.files.push({ path, origPath, kind: kindOf(xy), staged: xy[0] !== '.', unstaged: xy[1] !== '.' })
    } else if (f.startsWith('u ')) {
      st.files.push({ path: f.split(' ').slice(10).join(' '), kind: 'conflict', staged: false, unstaged: true })
    } else if (f.startsWith('? ')) {
      st.files.push({ path: f.slice(2), kind: 'untracked', staged: false, unstaged: true })
    }
  }
  return st
}
