import { useShallow } from 'zustand/react/shallow'
import { useEffect, useState } from 'react'
import type { DirEntry, Tab } from '@shared/types'
import { useStore } from '@/store'
import { Icon } from './Icon'

function fmtSize(n?: number): string {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}

export function SftpView({ tab }: { tab: Tab }) {
  const { updateTab, openFile, servers } = useStore(useShallow((s) => ({ updateTab: s.updateTab, openFile: s.openFile, servers: s.servers })))
  const server = servers.find((s) => s.id === tab.serverId)
  const [cwd, setCwd] = useState<string | null>(tab.cwd ?? null)
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [pathInput, setPathInput] = useState('')
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    if (cwd || !tab.serverId) return
    window.orbit.sftpHome(tab.serverId).then(
      (home) => setCwd(server?.defaultDir || home),
      (e) => setError((e as Error).message)
    )
  }, [cwd, tab.serverId, server?.defaultDir])

  useEffect(() => {
    if (!cwd || !tab.serverId) return
    setLoading(true)
    setError(null)
    setPathInput(cwd)
    window.orbit
      .sftpList(tab.serverId, cwd)
      .then(setEntries, (e) => setError((e as Error).message))
      .finally(() => setLoading(false))
    updateTab(tab.id, { cwd })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, tab.serverId, refresh])

  const up = (): void => {
    if (!cwd || cwd === '/') return
    setCwd(cwd.replace(/\/[^/]+\/?$/, '') || '/')
  }

  if (!server) return <div className="pane-message error">Server was removed.</div>

  return (
    <div className="sftp">
      <div className="sftp-bar">
        <button className="icon-btn" title="Up" onClick={up}><Icon name="up" /></button>
        <button className="icon-btn" title="Refresh" onClick={() => setRefresh((r) => r + 1)}><Icon name="refresh" /></button>
        <input
          className="path-input"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && setCwd(pathInput)}
        />
        <span className="muted">{server.username}@{server.host}</span>
      </div>
      {error && <div className="pane-message error">{error}</div>}
      <div className="sftp-list">
        {loading && <div className="pane-message">Loading…</div>}
        {!loading &&
          entries.map((e) => (
            <div
              key={e.path}
              className={`sftp-row ${e.name.startsWith('.') ? 'dim' : ''}`}
              onDoubleClick={() => (e.dir ? setCwd(e.path) : openFile(e.path, server.id))}
            >
              <Icon name={e.dir ? 'folder' : 'file'} />
              <span className="sftp-name">{e.name}</span>
              <span className="sftp-size">{e.dir ? '' : fmtSize(e.size)}</span>
            </div>
          ))}
      </div>
    </div>
  )
}
