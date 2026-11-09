import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import { isAbsolute, join } from 'path'
import chokidar, { type FSWatcher } from 'chokidar'
import type { GitChange, GitStatus } from '@shared/types'
import { emit } from './events'
import { shellEnv } from './shellEnv'
import { parsePorcelainV2 } from './gitStatus'

const MAX_DIFF_BYTES = 2 * 1024 * 1024

/** Run git in `cwd`. Never prompts (credentials come from the user's helper/agent or the call fails). */
function git(cwd: string, args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
        env: { ...(shellEnv() as NodeJS.ProcessEnv), GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
      },
      (err, stdout, stderr) => {
        if (err) reject(new Error((stderr || err.message).trim()))
        else resolve(stdout)
      }
    )
  )
}

async function toplevel(cwd: string): Promise<string | null> {
  try {
    return (await git(cwd, ['rev-parse', '--show-toplevel'])).trim()
  } catch {
    return null
  }
}

export async function status(cwd: string): Promise<GitStatus> {
  const root = await toplevel(cwd)
  if (!root) return { isRepo: false, ahead: 0, behind: 0, files: [] }
  const st = parsePorcelainV2(await git(root, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']))
  const files: GitChange[] = st.files.map((f) => ({ ...f, abs: join(root, f.path) }))
  return { isRepo: true, root, branch: st.branch, detached: st.detached, upstream: st.upstream, ahead: st.ahead, behind: st.behind, files }
}

export async function branches(cwd: string): Promise<string[]> {
  const out = await git(cwd, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads'])
  return out.split('\n').filter(Boolean)
}

/** Both sides of a file for the diff view: HEAD version and the working copy. */
export async function fileVersions(cwd: string, change: GitChange): Promise<{ original: string; modified: string; binary: boolean }> {
  const root = (await toplevel(cwd)) ?? cwd
  const readHead = async (): Promise<string> => {
    if (change.kind === 'added' || change.kind === 'untracked') return ''
    try {
      return await git(root, ['show', `HEAD:${change.origPath ?? change.path}`])
    } catch {
      return '' // not in HEAD (e.g. first commit)
    }
  }
  const readDisk = async (): Promise<string> => {
    if (change.kind === 'deleted') return ''
    const st = await fs.stat(change.abs)
    if (st.size > MAX_DIFF_BYTES) throw new Error('File too large to diff')
    return fs.readFile(change.abs, 'utf8')
  }
  const [original, modified] = await Promise.all([readHead(), readDisk()])
  const binary = original.includes('\0') || modified.includes('\0')
  return binary ? { original: '', modified: '', binary } : { original, modified, binary }
}

/** Commit exactly `paths` (pathspec commit: other staged files are left alone). */
export async function commit(cwd: string, message: string, paths: string[]): Promise<string> {
  const root = (await toplevel(cwd)) ?? cwd
  if (!message.trim()) throw new Error('Write a commit message first')
  if (!paths.length) throw new Error('Select at least one file to commit')
  await git(root, ['add', '-A', '--', ...paths])
  return git(root, ['commit', '-m', message, '--', ...paths])
}

export async function pull(cwd: string): Promise<string> {
  return git(cwd, ['pull'], 120_000)
}

export async function push(cwd: string): Promise<string> {
  const st = await status(cwd)
  // first push of a new branch: create the upstream
  return st.upstream ? git(cwd, ['push'], 120_000) : git(cwd, ['push', '-u', 'origin', 'HEAD'], 120_000)
}

export async function checkout(cwd: string, branch: string, create: boolean): Promise<string> {
  if (!/^[\w./-]+$/.test(branch) || branch.startsWith('-')) throw new Error(`Invalid branch name: ${branch}`)
  return git(cwd, create ? ['checkout', '-b', branch] : ['checkout', branch])
}

export async function init(cwd: string): Promise<string> {
  return git(cwd, ['init'])
}

// ---- watch .git so commits / checkouts / pulls done in terminals show up right away
const watchers = new Map<string, FSWatcher>()

export async function watch(spaceRoot: string): Promise<void> {
  if (watchers.has(spaceRoot)) return
  let gitDir: string
  try {
    gitDir = (await git(spaceRoot, ['rev-parse', '--git-dir'])).trim()
  } catch {
    return
  }
  if (!isAbsolute(gitDir)) gitDir = join(spaceRoot, gitDir)
  let timer: NodeJS.Timeout | undefined
  const w = chokidar.watch(['HEAD', 'index', 'refs', 'FETCH_HEAD', 'ORIG_HEAD', 'MERGE_HEAD'].map((f) => join(gitDir, f)), {
    ignoreInitial: true,
    depth: 4
  })
  w.on('all', () => {
    clearTimeout(timer)
    timer = setTimeout(() => emit({ type: 'git', root: spaceRoot }), 150)
  })
  watchers.set(spaceRoot, w)
}

export function unwatchAll(): void {
  for (const w of watchers.values()) w.close()
  watchers.clear()
}
