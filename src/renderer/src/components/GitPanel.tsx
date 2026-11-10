import { useEffect, useState } from 'react'
import type { Space } from '@shared/types'
import { isAgentTab, useStore } from '@/store'
import { Icon } from './Icon'

/**
 * Why switching branches would be unsafe right now: an agent working in this space,
 * or a terminal running something (dev server, build, git…). Polled while the panel is shown.
 */
export function useBranchLock(space: Space): string | null {
  const statuses = useStore((s) => s.statuses)
  const running = useStore((s) => s.running)
  const [busy, setBusy] = useState<string | null>(null)

  const agent = space.tabs.find((t) => isAgentTab(t, running) && statuses[t.id] === 'working')
  const terminals = space.tabs.filter((t) => t.kind === 'terminal' || t.kind === 'agent')

  useEffect(() => {
    let alive = true
    const ids = terminals.map((t) => t.id)
    const check = (): void => {
      window.orbit.termForeground?.(ids).then((fg) => {
        if (!alive) return
        const t = terminals.find((x) => x.kind === 'terminal' && fg[x.id])
        setBusy(t ? `${fg[t.id]} is running in "${t.title}"` : null)
      })
    }
    check()
    const timer = setInterval(check, 2000)
    return () => {
      alive = false
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminals.map((t) => t.id).join(',')])

  if (agent) return `${agent.title} is working on this branch`
  return busy
}

export function GitPanel({ space }: { space: Space }) {
  const st = useStore((s) => s.git[space.root])
  const { openChanges, notify, refreshGit } = useStore()
  const lock = useBranchLock(space)
  const [running, setRunning] = useState<'pull' | 'push' | null>(null)

  if (!st) return null
  if (!st.isRepo)
    return (
      <div className="git-panel">
        <div className="git-empty">
          <span className="muted small">Not a git repository</span>
          <button className="btn small-btn" onClick={() => window.orbit.git.init(space.root).then(() => refreshGit(space.root))}>
            Initialize
          </button>
        </div>
      </div>
    )

  const run = async (op: 'pull' | 'push'): Promise<void> => {
    setRunning(op)
    try {
      const out = await window.orbit.git[op](space.root)
      notify(op === 'pull' ? (/Already up to date/i.test(out) ? 'Already up to date' : 'Pulled latest changes') : 'Pushed')
    } catch (e) {
      notify(`${op === 'pull' ? 'Pull' : 'Push'} failed: ${(e as Error).message.split('\n').slice(-2).join(' ')}`, 'error')
    } finally {
      setRunning(null)
      refreshGit(space.root)
    }
  }

  const changes = st.files.length
  return (
    <div className="git-panel">
      <BranchPicker space={space} lock={lock} />
      <div className="git-actions">
        <button className={`git-btn review ${changes ? 'has' : ''}`} onClick={openChanges} title="Review changes">
          <Icon name="diff" size={13} />
          <span>Review</span>
          {changes > 0 && <span className="git-count">{changes}</span>}
        </button>
        <button className="git-btn" onClick={() => run('pull')} disabled={!!running} title={st.upstream ? `Pull from ${st.upstream}` : 'Pull'}>
          <Icon name={running === 'pull' ? 'refresh' : 'arrow-down'} size={13} />
          <span>Pull</span>
          {st.behind > 0 && <span className="git-count">{st.behind}</span>}
        </button>
        <button className="git-btn" onClick={openChanges} disabled={!changes} title="Commit changes">
          <Icon name="commit" size={13} />
          <span>Commit</span>
        </button>
        <button className="git-btn" onClick={() => run('push')} disabled={!!running} title={st.upstream ? `Push to ${st.upstream}` : 'Push and create the branch on origin'}>
          <Icon name={running === 'push' ? 'refresh' : 'arrow-up'} size={13} />
          <span>Push</span>
          {st.ahead > 0 && <span className="git-count">{st.ahead}</span>}
        </button>
      </div>
    </div>
  )
}

function BranchPicker({ space, lock }: { space: Space; lock: string | null }) {
  const st = useStore((s) => s.git[space.root])
  const { notify, refreshGit } = useStore()
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<string[]>([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (open) window.orbit.git.branches(space.root).then(setList, () => setList([]))
  }, [open, space.root])
  useEffect(() => {
    if (lock) setOpen(false)
  }, [lock])

  const switchTo = async (branch: string, create: boolean): Promise<void> => {
    setOpen(false)
    setQuery('')
    try {
      await window.orbit.git.checkout(space.root, branch, create)
      notify(create ? `Created branch ${branch}` : `Switched to ${branch}`)
    } catch (e) {
      notify((e as Error).message.split('\n')[0], 'error')
    } finally {
      refreshGit(space.root)
    }
  }

  const q = query.trim()
  const shown = list.filter((b) => b.toLowerCase().includes(q.toLowerCase()))
  const canCreate = q && !list.includes(q) && /^[\w./-]+$/.test(q)

  return (
    <div className="branch-picker">
      <button
        className={`branch-btn ${lock ? 'locked' : ''}`}
        disabled={!!lock}
        title={lock ? `Can't switch branches: ${lock}` : 'Switch branch'}
        onClick={() => setOpen(!open)}
      >
        <Icon name="branch" size={13} />
        <span className="branch-name">{st?.detached ? 'detached HEAD' : st?.branch}</span>
        {lock ? <Icon name="lock" size={12} /> : <Icon name="chevron-down" size={12} />}
      </button>
      {lock && <div className="branch-lock">{lock}</div>}
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="branch-menu">
            <input
              autoFocus
              placeholder="Find or create a branch…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false)
                if (e.key === 'Enter' && q) {
                  if (list.includes(q)) switchTo(q, false)
                  else if (canCreate) switchTo(q, true)
                }
              }}
            />
            <div className="branch-list">
              {canCreate && (
                <button onClick={() => switchTo(q, true)}>
                  <Icon name="plus" size={12} /> Create <b>{q}</b>
                </button>
              )}
              {shown.map((b) => (
                <button key={b} className={b === st?.branch ? 'current' : ''} onClick={() => b !== st?.branch && switchTo(b, false)}>
                  <Icon name={b === st?.branch ? 'check' : 'branch'} size={12} /> {b}
                </button>
              ))}
              {!shown.length && !canCreate && <div className="muted small branch-none">No branches match</div>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
