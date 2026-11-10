import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { DirEntry, GitChangeKind, Space } from '@shared/types'
import { useStore } from '@/store'
import { Icon } from './Icon'
import { GitPanel } from './GitPanel'
import { CHANGE_LETTER } from './ChangesView'

/** git state for the tree: kind per changed file, and folders that contain changes */
interface TreeGit {
  files: Map<string, GitChangeKind>
  dirs: Set<string>
}
const GitCtx = createContext<TreeGit>({ files: new Map(), dirs: new Set() })

function useTreeGit(root: string): TreeGit {
  const st = useStore((s) => s.git[root])
  return useMemo(() => {
    const files = new Map<string, GitChangeKind>()
    const dirs = new Set<string>()
    for (const f of st?.files ?? []) {
      files.set(f.abs, f.kind)
      const sep = f.abs.includes('\\') ? '\\' : '/'
      let d = f.abs.slice(0, f.abs.lastIndexOf(sep))
      while (d.length >= root.length && !dirs.has(d)) {
        dirs.add(d)
        d = d.slice(0, d.lastIndexOf(sep))
      }
    }
    return { files, dirs }
  }, [st, root])
}

/** Simple lazy tree; directories reload on fs events touching them. */
export function FileTree({ space }: { space: Space }) {
  const [version, setVersion] = useState(0)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    const unsub = window.orbit.onEvent((e) => {
      if (e.type === 'fs' && e.root === space.root && e.changes.some((c) => c.event === 'add' || c.event === 'unlink' || c.event === 'addDir' || c.event === 'unlinkDir')) {
        setVersion((v) => v + 1)
      }
    })
    return unsub
  }, [space.root])

  const treeGit = useTreeGit(space.root)
  return (
    <GitCtx.Provider value={treeGit}>
    <div className="filetree">
      <div className="panel-header">
        <span className="panel-title" title={space.root}>{space.name}</span>
        <button className="icon-btn" title="Reveal in Finder" onClick={() => window.orbit.reveal(space.root)}>
          <Icon name="folder" />
        </button>
        <button className="icon-btn" title="Refresh" onClick={() => setVersion((v) => v + 1)}>
          <Icon name="refresh" />
        </button>
      </div>
      <input className="tree-filter" placeholder="Filter open folders…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="tree-scroll">
        <Dir path={space.root} depth={0} version={version} filter={filter.toLowerCase()} initiallyOpen />
      </div>
      <GitPanel space={space} />
    </div>
    </GitCtx.Provider>
  )
}

function Dir({ path, depth, version, filter, initiallyOpen }: { path: string; depth: number; version: number; filter: string; initiallyOpen?: boolean }) {
  const [entries, setEntries] = useState<DirEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    window.orbit.fsList(path).then(setEntries, (e) => setError((e as Error).message))
  }, [path])

  useEffect(() => {
    if (initiallyOpen) load()
  }, [load, version, initiallyOpen])

  if (error) return <div className="tree-error" style={{ paddingLeft: 12 + depth * 12 }}>{error}</div>
  if (!entries) return null
  return (
    <>
      {entries
        .filter((e) => !filter || e.dir || e.name.toLowerCase().includes(filter))
        .map((e) => (e.dir ? <DirNode key={e.path} entry={e} depth={depth} version={version} filter={filter} /> : <FileNode key={e.path} entry={e} depth={depth} />))}
    </>
  )
}

function DirNode({ entry, depth, version, filter }: { entry: DirEntry; depth: number; version: number; filter: string }) {
  const [open, setOpen] = useState(false)
  const dim = entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'vendor'
  const changed = useContext(GitCtx).dirs.has(entry.path)
  return (
    <>
      <div className={`tree-row ${dim ? 'dim' : ''} ${changed ? 'has-changes' : ''}`} style={{ paddingLeft: 8 + depth * 12 }} onClick={() => setOpen(!open)}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        <span className="tree-name">{entry.name}</span>
        {changed && <span className="tree-dirdot" />}
      </div>
      {open && <Dir path={entry.path} depth={depth + 1} version={version} filter={filter} initiallyOpen />}
    </>
  )
}

function FileNode({ entry, depth }: { entry: DirEntry; depth: number }) {
  const openFile = useStore((s) => s.openFile)
  const activePath = useStore((s) => {
    const sp = s.spaces.find((x) => x.id === s.activeSpaceId)
    return sp?.tabs.find((t) => t.id === sp.activeTabId)?.filePath
  })
  const kind = useContext(GitCtx).files.get(entry.path)
  return (
    <div
      className={`tree-row file ${activePath === entry.path ? 'active' : ''} ${entry.name.startsWith('.') ? 'dim' : ''} ${kind ? `git-${kind}` : ''}`}
      style={{ paddingLeft: 20 + depth * 12 }}
      onClick={() => openFile(entry.path)}
      title={entry.path}
    >
      <span className="file-dot" data-ext={entry.name.split('.').pop()} />
      <span className="tree-name">{entry.name}</span>
      {kind && <span className={`tree-git k-${kind}`}>{CHANGE_LETTER[kind]}</span>}
    </div>
  )
}
