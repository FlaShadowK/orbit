import { useState } from 'react'
import { spaceStatus, useStore } from '@/store'
import { Icon } from './Icon'
import { StatusDot } from './StatusDot'
import { keyLabel } from '@shared/keys'
import { IS_MAC } from '@/lib/util'

export async function createSpaceFromPicker(): Promise<void> {
  const root = await window.orbit.pickFolder()
  if (root) useStore.getState().addSpace(root)
}

export function Sidebar() {
  const { spaces, activeSpaceId, statuses, servers, setActiveSpace, removeSpace, updateSpace, openSsh, openSftp, set } = useStore()
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<string | null>(null)

  return (
    <aside className="sidebar">
      <div className="sidebar-top drag">
        <div className="brand">
          <span className="brand-mark" />
          Orbit
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <span>Spaces</span>
          <button className="icon-btn" title={`New space (${keyLabel('newSpace', IS_MAC)})`} onClick={createSpaceFromPicker}>
            <Icon name="plus" />
          </button>
        </div>
        {spaces.length === 0 && (
          <button className="empty-cta" onClick={createSpaceFromPicker}>
            Open a project folder
          </button>
        )}
        {spaces.map((s, i) => {
          const st = spaceStatus(s, statuses)
          const agents = s.tabs.filter((t) => t.kind === 'agent').length
          return (
            <div
              key={s.id}
              className={`space-row ${s.id === activeSpaceId ? 'active' : ''}`}
              onClick={() => setActiveSpace(s.id)}
              onDoubleClick={() => setRenaming(s.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu(menu === s.id ? null : s.id)
              }}
              title={s.root}
            >
              <span className="space-swatch" style={{ background: s.color }} />
              {renaming === s.id ? (
                <input
                  autoFocus
                  className="inline-input"
                  defaultValue={s.name}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    updateSpace(s.id, { name: e.target.value || s.name })
                    setRenaming(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                />
              ) : (
                <span className="space-name">{s.name}</span>
              )}
              {st && <StatusDot status={st} />}
              {agents > 0 && <span className="pill">{agents}</span>}
              <span className="kbd-hint">{i < 9 ? (IS_MAC ? `⌃${i + 1}` : `Ctrl+Alt+${i + 1}`) : ''}</span>
              {menu === s.id && (
                <div className="ctx-menu" onClick={(e) => e.stopPropagation()} onMouseLeave={() => setMenu(null)}>
                  <button onClick={() => { setRenaming(s.id); setMenu(null) }}>Rename</button>
                  <button onClick={() => { window.orbit.reveal(s.root); setMenu(null) }}>Reveal in Finder</button>
                  <button
                    className="danger"
                    onClick={() => {
                      setMenu(null)
                      if (confirm(`Close space "${s.name}"? Running agents and terminals in it will be stopped. Files are not touched.`)) removeSpace(s.id)
                    }}
                  >
                    Close space
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="section grow">
        <div className="section-head">
          <span>Servers</span>
          <button className="icon-btn" title="Add server" onClick={() => set({ serverModal: { mode: 'new' } })}>
            <Icon name="plus" />
          </button>
        </div>
        {servers.length === 0 && (
          <div className="empty-hint">
            <button className="empty-cta" onClick={() => set({ serverModal: { mode: 'new' } })}>Add a server</button>
            <button
              className="link-btn"
              onClick={async () => {
                const n = await window.orbit.importSshConfig()
                useStore.getState().notify(n ? `Imported ${n} host(s) from ~/.ssh/config` : 'No new hosts found in ~/.ssh/config')
              }}
            >
              or import ~/.ssh/config
            </button>
          </div>
        )}
        <div className="server-list">
          {servers.map((srv) => (
            <div key={srv.id} className="server-row" onDoubleClick={() => openSsh(srv)} title={`${srv.username}@${srv.host}:${srv.port}`}>
              <span className="server-led" style={{ background: srv.color }} />
              <div className="server-text">
                <span className="server-name">{srv.name}</span>
                <span className="server-host">{srv.username}@{srv.host}</span>
              </div>
              <div className="row-actions">
                <button className="icon-btn" title="Open SSH terminal" onClick={() => openSsh(srv)}><Icon name="terminal" /></button>
                <button className="icon-btn" title="Browse files (SFTP)" onClick={() => openSftp(srv)}><Icon name="files" /></button>
                <button className="icon-btn" title="Edit" onClick={() => set({ serverModal: { mode: 'edit', server: srv } })}><Icon name="edit" /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <UpdatePill />
      <div className="sidebar-foot">
        <button className="icon-btn" title={`Activity log (${keyLabel('toggleActivity', IS_MAC)})`} onClick={() => set({ showActivity: !useStore.getState().showActivity })}>
          <Icon name="activity" />
        </button>
        <button className="icon-btn" title="Settings" onClick={() => set({ settingsOpen: true })}>
          <Icon name="settings" />
        </button>
        <button className="foot-palette" onClick={() => set({ paletteOpen: true })}>
          <Icon name="search" size={12} /> Commands <kbd>{keyLabel('palette', IS_MAC)}</kbd>
        </button>
      </div>
    </aside>
  )
}

/** Shown in the sidebar while an update downloads, and as a restart button once it's ready. */
function UpdatePill() {
  const update = useStore((s) => s.update)
  if (update.status === 'downloading')
    return (
      <div className="update-pill" title={`Downloading Orbit ${update.version}`}>
        <Icon name="refresh" size={12} /> v{update.version}
        <span className="bar"><i style={{ width: `${update.percent ?? 0}%` }} /></span>
      </div>
    )
  if (update.status === 'ready')
    return (
      <button className="update-pill" onClick={() => window.orbit.installUpdate()} title="Restart Orbit to install the update">
        <Icon name="check" size={12} /> Restart to update to v{update.version}
      </button>
    )
  if (update.status === 'available')
    return (
      <button className="update-pill" onClick={() => window.orbit.openExternal('https://github.com/FlaShadowK/orbit/releases/latest')}>
        <Icon name="globe" size={12} /> Orbit {update.version} is available
      </button>
    )
  return null
}
