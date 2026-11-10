import { useShallow } from 'zustand/react/shallow'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { GitChange, GitChangeKind, Space } from '@shared/types'
import { monaco } from '@/lib/monaco'
import { langFor } from '@/lib/util'
import { useStore } from '@/store'
import { Icon } from './Icon'

export const CHANGE_LETTER: Record<GitChangeKind, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  conflict: '!'
}

/** Code review: changed files, a side-by-side diff, and commit (& push). */
export function ChangesView({ space, focused }: { space: Space; focused: boolean }) {
  const st = useStore((s) => s.git[space.root])
  const { notify, refreshGit, openFile } = useStore(useShallow((s) => ({ notify: s.notify, refreshGit: s.refreshGit, openFile: s.openFile })))
  const files = useMemo(() => st?.files ?? [], [st])
  const [selected, setSelected] = useState<string | null>(null)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [sideBySide, setSideBySide] = useState(true)

  // keep a valid selection as files come and go (e.g. an agent edits, a terminal commits)
  useEffect(() => {
    if (!files.some((f) => f.path === selected)) setSelected(files[0]?.path ?? null)
  }, [files, selected])

  const current = files.find((f) => f.path === selected)
  const included = files.filter((f) => !excluded.has(f.path))

  const commit = async (andPush: boolean): Promise<void> => {
    setBusy(true)
    try {
      const paths = included.flatMap((f) => (f.origPath ? [f.path, f.origPath] : [f.path]))
      await window.orbit.git.commit(space.root, message, paths)
      setMessage('')
      setExcluded(new Set())
      if (andPush) await window.orbit.git.push(space.root)
      notify(andPush ? `Committed and pushed ${included.length} file(s)` : `Committed ${included.length} file(s)`)
    } catch (e) {
      notify((e as Error).message.split('\n').slice(-2).join(' '), 'error')
    } finally {
      setBusy(false)
      refreshGit(space.root)
    }
  }

  if (!st) return <div className="pane-message">Loading…</div>
  if (!st.isRepo) return <div className="pane-message">{space.root} is not a git repository.</div>

  const toggleAll = (): void => setExcluded(excluded.size ? new Set() : new Set(files.map((f) => f.path)))

  return (
    <div className="changes">
      <aside className="changes-side">
        <div className="commit-box">
          <textarea
            autoFocus={focused}
            rows={3}
            placeholder={`Commit message (${st.branch})`}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit(false)
            }}
          />
          <div className="commit-actions">
            <button className="btn primary" disabled={busy || !message.trim() || !included.length} onClick={() => commit(false)}>
              {busy ? 'Working…' : `Commit ${included.length || ''}`}
            </button>
            <button className="btn" disabled={busy || !message.trim() || !included.length} onClick={() => commit(true)} title="Commit, then push">
              Commit &amp; Push
            </button>
          </div>
        </div>
        <div className="changes-head">
          <label className="check-row">
            <input type="checkbox" checked={!excluded.size && files.length > 0} onChange={toggleAll} />
            {files.length} changed file{files.length === 1 ? '' : 's'}
          </label>
          <button className="icon-btn" title="Refresh" onClick={() => refreshGit(space.root)}>
            <Icon name="refresh" size={12} />
          </button>
        </div>
        <div className="changes-list">
          {files.length === 0 && <div className="muted small changes-clean">Working tree clean ✓</div>}
          {files.map((f) => (
            <div key={f.path} className={`change-row ${f.path === selected ? 'active' : ''} k-${f.kind}`} onClick={() => setSelected(f.path)} title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}>
              <input
                type="checkbox"
                checked={!excluded.has(f.path)}
                onClick={(e) => e.stopPropagation()}
                onChange={() => {
                  const next = new Set(excluded)
                  if (next.has(f.path)) next.delete(f.path)
                  else next.add(f.path)
                  setExcluded(next)
                }}
              />
              <span className="change-name">{f.path.split('/').pop()}</span>
              <span className="change-dir">{f.path.split('/').slice(0, -1).join('/')}</span>
              <span className={`change-letter k-${f.kind}`}>{CHANGE_LETTER[f.kind]}</span>
            </div>
          ))}
        </div>
      </aside>
      <section className="changes-main">
        {current ? (
          <>
            <div className="diff-head">
              <span className={`change-letter k-${current.kind}`}>{CHANGE_LETTER[current.kind]}</span>
              <span className="diff-path">{current.origPath ? `${current.origPath} → ${current.path}` : current.path}</span>
              <span className="grow" />
              <button className="btn ghost-btn" onClick={() => setSideBySide(!sideBySide)}>{sideBySide ? 'Inline' : 'Side by side'}</button>
              {current.kind !== 'deleted' && (
                <button className="btn ghost-btn" onClick={() => openFile(current.abs)}>
                  <Icon name="edit" size={12} /> Open
                </button>
              )}
            </div>
            <DiffView root={space.root} change={current} sideBySide={sideBySide} />
          </>
        ) : (
          <div className="pane-message">Nothing to review.</div>
        )}
      </section>
    </div>
  )
}

function DiffView({ root, change, sideBySide }: { root: string; change: GitChange; sideBySide: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const [note, setNote] = useState<string | null>(null)
  // re-diff when the file changes on disk (status object identity changes on every refresh)
  const stamp = useStore((s) => s.git[root])

  useEffect(() => {
    const ed = monaco.editor.createDiffEditor(host.current!, {
      theme: 'orbit',
      readOnly: true,
      originalEditable: false,
      automaticLayout: true,
      renderSideBySide: sideBySide,
      // the toggle decides; don't silently fall back to inline in narrower panes
      useInlineViewWhenSpaceIsLimited: false,
      fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", Menlo, monospace',
      fontSize: 12.5,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderOverviewRuler: false,
      hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 4 }
    })
    editor.current = ed
    return () => {
      const m = ed.getModel()
      ed.dispose()
      m?.original.dispose()
      m?.modified.dispose()
    }
  }, [])

  useEffect(() => {
    editor.current?.updateOptions({ renderSideBySide: sideBySide })
  }, [sideBySide])

  useEffect(() => {
    let alive = true
    window.orbit.git.fileVersions(root, change).then(
      ({ original, modified, binary }) => {
        if (!alive || !editor.current) return
        setNote(binary ? 'Binary file — no text diff' : null)
        const lang = langFor(change.path)
        const prev = editor.current.getModel()
        editor.current.setModel({
          original: monaco.editor.createModel(original, lang),
          modified: monaco.editor.createModel(modified, lang)
        })
        prev?.original.dispose()
        prev?.modified.dispose()
      },
      (e) => alive && setNote((e as Error).message)
    )
    return () => {
      alive = false
    }
  }, [root, change.path, change.kind, stamp])

  return (
    <div className="diff-wrap">
      {note && <div className="pane-message">{note}</div>}
      <div className="diff-host" ref={host} style={{ display: note ? 'none' : 'block' }} />
    </div>
  )
}
