import { useShallow } from 'zustand/react/shallow'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DirEntry, Server, Space, Tab, TransferState } from '@shared/types'
import { useStore } from '@/store'
import { cleanError, fmtBytes, fmtDate, IS_MAC, isFileOnly, REVEAL_LABEL } from '@/lib/util'
import { Icon } from './Icon'
import { ContextMenu, type MenuAt, type MenuItem } from './ContextMenu'
import { openExternally } from './FileViewer'

type Side = 'local' | 'remote'

/** drag payloads: which pane the files come from */
const MIME: Record<Side, string> = { local: 'application/x-orbit-local-files', remote: 'application/x-orbit-remote-files' }

interface DragItem {
  path: string
  dir: boolean
  size?: number
}
interface DragPayload {
  serverId: string
  items: DragItem[]
}

/** File operations of one pane: this computer, or the server. */
interface PaneFs {
  side: Side
  list(dir: string): Promise<DirEntry[]>
  home(): Promise<string>
  mkdir(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  remove(e: DirEntry): Promise<void>
  join(dir: string, name: string): string
  parent(dir: string): string
}

const localSep = (p: string): string => (p.includes('\\') && !p.includes('/') ? '\\' : '/')

function localFs(home: string): PaneFs {
  return {
    side: 'local',
    list: (dir) => window.orbit.fsList(dir, true),
    home: async () => home,
    mkdir: (p) => window.orbit.fsMkdir(p),
    rename: (a, b) => window.orbit.fsRename(a, b),
    remove: (e) => window.orbit.trash(e.path),
    join: (dir, name) => (/[\\/]$/.test(dir) ? dir + name : dir + localSep(dir) + name),
    parent: (dir) => {
      const trimmed = dir.replace(/[\\/]+$/, '')
      const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
      if (i < 0) return dir
      const up = trimmed.slice(0, i)
      return up === '' ? '/' : /^[A-Za-z]:$/.test(up) ? up + '\\' : up
    }
  }
}

function remoteFs(serverId: string): PaneFs {
  return {
    side: 'remote',
    list: (dir) => window.orbit.sftpList(serverId, dir),
    home: () => window.orbit.sftpHome(serverId),
    mkdir: (p) => window.orbit.sftpMkdir(serverId, p),
    rename: (a, b) => window.orbit.sftpRename(serverId, a, b),
    remove: (e) => window.orbit.sftpRemove(serverId, e.path, e.dir),
    join: (dir, name) => (dir.endsWith('/') ? dir + name : `${dir}/${name}`),
    parent: (dir) => (dir === '/' ? '/' : dir.replace(/\/[^/]+\/?$/, '') || '/')
  }
}

export function SftpView({ tab, space }: { tab: Tab; space: Space }) {
  const { updateTab, servers, home, transfers } = useStore(
    useShallow((s) => ({ updateTab: s.updateTab, servers: s.servers, home: s.info?.home ?? '/', transfers: s.transfers }))
  )
  const server = servers.find((s) => s.id === tab.serverId)
  const [localCwd, setLocalCwd] = useState(tab.localCwd ?? space.root)
  const [remoteCwd, setRemoteCwd] = useState<string | null>(tab.cwd ?? null)
  const [refresh, setRefresh] = useState<Record<Side, number>>({ local: 0, remote: 0 })
  const local = useMemo(() => localFs(home), [home])
  const remote = useMemo(() => remoteFs(tab.serverId ?? ''), [tab.serverId])
  const [homeError, setHomeError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (remoteCwd || !tab.serverId) return
    setHomeError(null)
    window.orbit.sftpHome(tab.serverId).then(
      (h) => setRemoteCwd(server?.defaultDir || h),
      (e) => setHomeError(cleanError(e))
    )
  }, [remoteCwd, tab.serverId, server?.defaultDir, attempt])

  useEffect(() => {
    if (remoteCwd && remoteCwd !== tab.cwd) updateTab(tab.id, { cwd: remoteCwd })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteCwd])
  useEffect(() => {
    if (localCwd !== tab.localCwd) updateTab(tab.id, { localCwd })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localCwd])

  // a finished copy into a folder that's on screen: show the new files
  const seen = useRef(new Set<string>())
  useEffect(() => {
    for (const t of Object.values(transfers)) {
      if (t.serverId !== tab.serverId || t.status === 'running' || t.status === 'scanning' || seen.current.has(t.id)) continue
      seen.current.add(t.id)
      const side: Side = t.direction === 'up' ? 'remote' : 'local'
      setRefresh((r) => ({ ...r, [side]: r[side] + 1 }))
    }
  }, [transfers, tab.serverId])

  const bump = useCallback((side: Side) => setRefresh((r) => ({ ...r, [side]: r[side] + 1 })), [])

  if (!server) return <div className="pane-message error">Server was removed.</div>
  const hideLocal = !!tab.hideLocal
  const proto = isFileOnly(server) ? server.protocol!.toUpperCase() : 'SFTP'

  /** copy dragged files into `target` on the other side, asking before replacing anything */
  const transfer = async (direction: 'up' | 'down', items: DragItem[], target: string, existing?: DirEntry[]): Promise<void> => {
    if (!items.length) return
    const names = new Set((existing ?? (await (direction === 'up' ? remote : local).list(target).catch(() => []))).map((e) => e.name))
    const clash = items.map((i) => i.path.split(/[\\/]/).pop()!).filter((n) => names.has(n))
    if (clash.length && !confirm(`Replace ${clash.length} existing item${clash.length === 1 ? '' : 's'} in ${target}?\n\n${clash.slice(0, 8).join('\n')}${clash.length > 8 ? '\n…' : ''}`)) return
    try {
      await window.orbit.startTransfer({ serverId: server.id, direction, sources: items, target })
    } catch (e) {
      useStore.getState().notify(cleanError(e), 'error')
    }
  }

  const mine = Object.values(transfers).filter((t) => t.serverId === server.id)

  return (
    <div className="sftp">
      <div className="sftp-top">
        <button
          className={`ghost-btn sftp-toggle ${hideLocal ? '' : 'on'}`}
          title={hideLocal ? 'Show this computer next to the server' : 'Hide this computer'}
          onClick={() => updateTab(tab.id, { hideLocal: !hideLocal })}
        >
          <Icon name="laptop" size={13} /> This computer
        </button>
        <span className="grow" />
        <span className="sftp-proto">{proto}</span>
        <span className="muted small">{server.username}@{server.host}</span>
      </div>
      <div className={`sftp-panes ${hideLocal ? 'single' : ''}`}>
        {!hideLocal && (
          <FilePane
            fs={local}
            title="This computer"
            icon="laptop"
            cwd={localCwd}
            setCwd={setLocalCwd}
            refresh={refresh.local}
            server={server}
            onRefresh={() => bump('local')}
            accepts={(types) => types.includes(MIME.remote)}
            onDropItems={(e, target, entries) => {
              const raw = e.dataTransfer.getData(MIME.remote)
              if (!raw) return
              const p = JSON.parse(raw) as DragPayload
              if (p.serverId !== server.id) return useStore.getState().notify('Drop files from this server here', 'error')
              transfer('down', p.items, target, entries)
            }}
            sendLabel="Upload to server"
            onSend={(items) => remoteCwd && transfer('up', items, remoteCwd)}
          />
        )}
        {remoteCwd ? (
          <FilePane
            fs={remote}
            title={server.name}
            icon="server"
            color={server.color}
            cwd={remoteCwd}
            setCwd={setRemoteCwd}
            refresh={refresh.remote}
            server={server}
            onRefresh={() => bump('remote')}
            accepts={(types) => types.includes(MIME.local) || types.includes('Files')}
            onDropItems={(e, target, entries) => {
              const raw = e.dataTransfer.getData(MIME.local)
              const items: DragItem[] = raw
                ? (JSON.parse(raw) as DragPayload).items
                : [...e.dataTransfer.files].map((f) => ({ path: window.orbit.pathForFile(f), dir: false })).filter((i) => i.path)
              transfer('up', items, target, entries)
            }}
            sendLabel="Download to this computer"
            onSend={(items) => transfer('down', items, localCwd)}
          />
        ) : (
          <div className="file-pane">
            {homeError ? (
              <div className="remote-error">
                <Icon name="server" size={22} />
                <div className="file-fallback-name">Couldn't open {server.name}</div>
                <p className="muted">{homeError}</p>
                <div className="file-fallback-actions">
                  <button className="btn primary small-btn" onClick={() => setAttempt((a) => a + 1)}>
                    <Icon name="refresh" size={12} /> Retry
                  </button>
                  <button className="btn small-btn" onClick={() => useStore.getState().set({ serverModal: { mode: 'edit', server } })}>
                    Edit server
                  </button>
                </div>
              </div>
            ) : (
              <div className="pane-message">Connecting to {server.host}…</div>
            )}
          </div>
        )}
      </div>
      {mine.length > 0 && <TransferBar transfers={mine} />}
    </div>
  )
}

function FilePane({ fs, title, icon, color, cwd, setCwd, refresh, server, onRefresh, accepts, onDropItems, sendLabel, onSend }: {
  fs: PaneFs
  title: string
  icon: string
  color?: string
  cwd: string
  setCwd: (p: string) => void
  refresh: number
  server: Server
  onRefresh: () => void
  accepts: (types: readonly string[]) => boolean
  onDropItems: (e: React.DragEvent, target: string, existing?: DirEntry[]) => void
  sendLabel: string
  onSend: (items: DragItem[]) => void
}) {
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [pathInput, setPathInput] = useState(cwd)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ at: MenuAt; items: MenuItem[] } | null>(null)
  /** drop target while dragging: a folder row's path, or '' for the folder on screen */
  const [dropAt, setDropAt] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(true)
  const remote = fs.side === 'remote'
  const notify = useStore((s) => s.notify)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    fs.list(cwd)
      .then(setEntries, (e) => setError(cleanError(e)))
      .finally(() => setLoading(false))
  }, [fs, cwd])

  useEffect(() => {
    setPathInput(cwd)
    setSelected(new Set())
    setAnchor(null)
    load()
  }, [cwd, refresh, load])

  const visible = showHidden ? entries : entries.filter((e) => !e.name.startsWith('.'))
  const run = (p: Promise<unknown>): void => {
    p.then(onRefresh, (e) => notify(cleanError(e), 'error'))
  }

  const open = (e: DirEntry): void => {
    if (e.dir) setCwd(e.path)
    else useStore.getState().openFile(e.path, remote ? server.id : undefined)
  }

  const pick = (ev: React.MouseEvent, e: DirEntry): void => {
    const next = new Set(IS_MAC ? (ev.metaKey ? selected : []) : ev.ctrlKey ? selected : [])
    if (ev.shiftKey && anchor) {
      const a = visible.findIndex((x) => x.path === anchor)
      const b = visible.findIndex((x) => x.path === e.path)
      for (const x of visible.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x.path)
    } else if ((IS_MAC ? ev.metaKey : ev.ctrlKey) && selected.has(e.path)) next.delete(e.path)
    else next.add(e.path)
    setSelected(next)
    if (!ev.shiftKey) setAnchor(e.path)
  }

  /** the rows an action applies to: the selection when the clicked row is in it, else that row */
  const targetsFor = (e: DirEntry): DirEntry[] => (selected.has(e.path) ? visible.filter((x) => selected.has(x.path)) : [e])
  const asItems = (list: DirEntry[]): DragItem[] => list.map((x) => ({ path: x.path, dir: x.dir, size: x.size }))

  const newFolder = async (): Promise<void> => {
    let name = 'untitled folder'
    for (let i = 2; entries.some((e) => e.name === name); i++) name = `untitled folder ${i}`
    const path = fs.join(cwd, name)
    try {
      await fs.mkdir(path)
      setEntries((list) => [{ name, path, dir: true }, ...list])
      setRenaming(path)
    } catch (e) {
      notify(cleanError(e), 'error')
    }
  }

  const remove = (list: DirEntry[]): void => {
    const what = list.length === 1 ? `"${list[0].name}"` : `${list.length} items`
    const msg = remote ? `Delete ${what} from ${server.name}? This can't be undone.` : `Move ${what} to the ${IS_MAC ? 'Trash' : 'Recycle Bin'}?`
    if (!confirm(msg)) return
    run(Promise.all(list.map((e) => fs.remove(e))))
  }

  const rowMenu = (e: DirEntry): MenuItem[] => {
    const list = targetsFor(e)
    const many = list.length > 1
    return [
      ...(!many ? [{ label: e.dir ? 'Open Folder' : 'Open', icon: e.dir ? 'folder' : 'file', onClick: () => open(e) } as MenuItem] : []),
      ...(!many && !e.dir ? [{ label: 'Open with Default App', icon: 'window', onClick: () => openExternally(e.path, remote ? server.id : undefined) } as MenuItem] : []),
      ...(!remote && !many ? [{ label: REVEAL_LABEL, icon: 'folder', onClick: () => window.orbit.reveal(e.path) } as MenuItem] : []),
      { label: many ? `${sendLabel} (${list.length})` : sendLabel, icon: remote ? 'download' : 'upload', onClick: () => onSend(asItems(list)) },
      'sep',
      ...(!many ? [{ label: 'Rename', icon: 'edit', onClick: () => setRenaming(e.path) } as MenuItem] : []),
      { label: 'Copy Path', icon: 'copy', onClick: () => navigator.clipboard.writeText(list.map((x) => x.path).join('\n')).then(() => notify('Copied path')) },
      'sep',
      { label: remote ? 'Delete' : `Move to ${IS_MAC ? 'Trash' : 'Recycle Bin'}`, icon: 'trash', danger: true, onClick: () => remove(list) }
    ]
  }

  const bgMenu = (): MenuItem[] => [
    { label: 'New Folder', icon: 'folder-plus', onClick: newFolder },
    { label: 'Refresh', icon: 'refresh', onClick: load },
    { label: showHidden ? 'Hide Hidden Files' : 'Show Hidden Files', icon: 'search', onClick: () => setShowHidden(!showHidden) },
    ...(!remote ? [{ label: IS_MAC ? 'Open in Finder' : 'Open in File Manager', icon: 'folder', onClick: () => openExternally(cwd) } as MenuItem] : []),
    { label: 'Copy Path', icon: 'copy', onClick: () => navigator.clipboard.writeText(cwd).then(() => notify('Copied path')) }
  ]

  return (
    <div
      className={`file-pane ${dropAt === '' ? 'drop' : ''}`}
      onDragOver={(e) => {
        if (!accepts(e.dataTransfer.types)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        const row = (e.target as HTMLElement).closest<HTMLElement>('[data-dir]')
        const at = row?.dataset.dir ?? ''
        if (at !== dropAt) setDropAt(at)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null)
      }}
      onDrop={(e) => {
        if (!accepts(e.dataTransfer.types)) return
        e.preventDefault()
        const at = dropAt
        setDropAt(null)
        onDropItems(e, at || cwd, at ? undefined : entries)
      }}
    >
      <div className="pane-head" style={color ? { ['--srv' as string]: color } : undefined}>
        <Icon name={icon} size={13} />
        <span className="pane-title">{title}</span>
        <span className="grow" />
        <button className="icon-btn" title="Up" onClick={() => setCwd(fs.parent(cwd))}><Icon name="up" /></button>
        <button className="icon-btn" title="Home" onClick={() => fs.home().then(setCwd, (e) => notify(cleanError(e), 'error'))}>
          <Icon name="folder" />
        </button>
        <button className="icon-btn" title="New folder" onClick={newFolder}><Icon name="folder-plus" /></button>
        <button className="icon-btn" title="Refresh" onClick={load}><Icon name="refresh" /></button>
      </div>
      <input
        className="path-input"
        value={pathInput}
        spellCheck={false}
        onChange={(e) => setPathInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setCwd(pathInput.trim() || cwd)
          if (e.key === 'Escape') setPathInput(cwd)
        }}
      />
      <div className="file-cols">
        <span>Name</span>
        <span>Size</span>
        <span>Modified</span>
      </div>
      <div
        className="file-list"
        tabIndex={0}
        onClick={(e) => e.target === e.currentTarget && setSelected(new Set())}
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget) return
          e.preventDefault()
          setMenu({ at: { x: e.clientX, y: e.clientY }, items: bgMenu() })
        }}
        onKeyDown={(e) => {
          if (renaming) return
          const sel = visible.filter((x) => selected.has(x.path))
          if (e.key === 'Enter' && sel.length === 1) open(sel[0])
          if (e.key === 'Backspace' && (IS_MAC ? e.metaKey : false) && sel.length) remove(sel)
          if (e.key === 'Delete' && sel.length) remove(sel)
          if ((IS_MAC ? e.metaKey : e.ctrlKey) && e.key === 'a') {
            e.preventDefault()
            setSelected(new Set(visible.map((x) => x.path)))
          }
          if (e.key === 'ArrowUp' && (IS_MAC ? e.metaKey : e.altKey)) setCwd(fs.parent(cwd))
        }}
      >
        {error && <div className="pane-message error">{error}</div>}
        {loading && !entries.length && !error && <div className="pane-message">Loading…</div>}
        {!loading && !error && visible.length === 0 && <div className="pane-message muted">Empty folder · drop files here</div>}
        {visible.map((e) => (
          <div
            key={e.path}
            className={`file-row ${selected.has(e.path) ? 'sel' : ''} ${e.name.startsWith('.') ? 'dim' : ''} ${dropAt === e.path ? 'drop' : ''}`}
            data-dir={e.dir ? e.path : undefined}
            draggable={renaming !== e.path}
            onDragStart={(ev) => {
              const list = targetsFor(e)
              if (!selected.has(e.path)) setSelected(new Set([e.path]))
              const payload: DragPayload = { serverId: server.id, items: asItems(list) }
              ev.dataTransfer.setData(MIME[fs.side], JSON.stringify(payload))
              ev.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={(ev) => pick(ev, e)}
            onDoubleClick={() => open(e)}
            onContextMenu={(ev) => {
              ev.preventDefault()
              if (!selected.has(e.path)) setSelected(new Set([e.path]))
              setMenu({ at: { x: ev.clientX, y: ev.clientY }, items: rowMenu(e) })
            }}
            title={e.path}
          >
            <span className="file-name">
              <Icon name={e.dir ? 'folder' : 'file'} size={13} />
              {renaming === e.path ? (
                <input
                  autoFocus
                  className="inline-input"
                  defaultValue={e.name}
                  onClick={(ev) => ev.stopPropagation()}
                  onFocus={(ev) => {
                    // select the name without its extension, like Finder
                    const dot = e.dir ? -1 : e.name.lastIndexOf('.')
                    ev.currentTarget.setSelectionRange(0, dot > 0 ? dot : e.name.length)
                  }}
                  onBlur={(ev) => {
                    const name = ev.target.value.trim()
                    setRenaming(null)
                    if (name && name !== e.name && !/[\\/]/.test(name)) run(fs.rename(e.path, fs.join(cwd, name)))
                  }}
                  onKeyDown={(ev) => {
                    ev.stopPropagation()
                    if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur()
                    if (ev.key === 'Escape') setRenaming(null)
                  }}
                />
              ) : (
                <span className="file-label">{e.name}</span>
              )}
            </span>
            <span className="file-size">{e.dir ? '' : fmtBytes(e.size)}</span>
            <span className="file-date">{fmtDate(e.mtime)}</span>
          </div>
        ))}
      </div>
      {menu && <ContextMenu at={menu.at} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  )
}

function TransferBar({ transfers }: { transfers: TransferState[] }) {
  return (
    <div className="transfer-bar">
      {transfers.map((t) => {
        const pct = t.total ? Math.min(100, (t.bytes / t.total) * 100) : t.status === 'done' ? 100 : 0
        const verb = t.direction === 'up' ? 'Uploading' : 'Downloading'
        return (
          <div key={t.id} className={`transfer st-${t.status}`}>
            <Icon name={t.direction === 'up' ? 'upload' : 'download'} size={13} />
            <div className="transfer-main">
              <div className="transfer-line">
                <span className="transfer-label">
                  {t.status === 'done' ? (t.direction === 'up' ? 'Uploaded' : 'Downloaded') : t.status === 'error' ? 'Failed' : t.status === 'cancelled' ? 'Cancelled' : t.status === 'scanning' ? 'Preparing' : verb}{' '}
                  {t.label}
                </span>
                <span className="muted transfer-detail">
                  {t.status === 'error'
                    ? t.error
                    : t.status === 'scanning'
                      ? 'counting files…'
                      : `${fmtBytes(t.bytes)} of ${fmtBytes(t.total)}${t.files > 1 ? ` · ${t.filesDone}/${t.files} files` : ''}${t.current && t.files > 1 && t.status === 'running' ? ` · ${t.current}` : ''}`}
                </span>
              </div>
              <div className="transfer-track">
                <i style={{ width: `${pct}%` }} />
              </div>
            </div>
            {(t.status === 'running' || t.status === 'scanning') && (
              <button className="icon-btn" title="Cancel" onClick={() => window.orbit.cancelTransfer(t.id)}>
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
