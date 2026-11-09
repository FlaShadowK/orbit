import { describe, expect, it } from 'vitest'
import { parsePorcelainV2 } from './gitStatus'

const z = (...f: string[]): string => f.join('\0') + '\0'

describe('parsePorcelainV2', () => {
  it('reads branch, upstream and ahead/behind', () => {
    const st = parsePorcelainV2(z('# branch.oid abc', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -1'))
    expect(st).toMatchObject({ branch: 'main', detached: false, upstream: 'origin/main', ahead: 2, behind: 1, files: [] })
  })

  it('classifies changed, staged, untracked, renamed and conflicted files', () => {
    const st = parsePorcelainV2(
      z(
        '# branch.head feature/x',
        '1 .M N... 100644 100644 100644 aaa bbb src/app.ts',
        '1 A. N... 000000 100644 100644 000 ccc src/new file.ts',
        '1 .D N... 100644 100644 000000 ddd ddd old.txt',
        '2 R. N... 100644 100644 100644 eee eee R100 src/renamed.ts',
        'src/original.ts',
        'u UU N... 100644 100644 100644 100644 f1 f2 f3 conflict.ts',
        '? notes.md'
      )
    )
    expect(st.files).toEqual([
      { path: 'src/app.ts', kind: 'modified', staged: false, unstaged: true, origPath: undefined },
      { path: 'src/new file.ts', kind: 'added', staged: true, unstaged: false, origPath: undefined },
      { path: 'old.txt', kind: 'deleted', staged: false, unstaged: true, origPath: undefined },
      { path: 'src/renamed.ts', origPath: 'src/original.ts', kind: 'renamed', staged: true, unstaged: false },
      { path: 'conflict.ts', kind: 'conflict', staged: false, unstaged: true },
      { path: 'notes.md', kind: 'untracked', staged: false, unstaged: true }
    ])
  })

  it('handles a detached HEAD', () => {
    expect(parsePorcelainV2(z('# branch.head (detached)'))).toMatchObject({ branch: 'HEAD', detached: true })
  })
})
