import { useState } from 'react'
import type { Space, Tab } from '@shared/types'
import { useStore } from '@/store'
import { Icon } from './Icon'
import { StatusDot } from './StatusDot'
import { disposeModel } from './EditorView'
import { keyLabel } from '@shared/keys'
import { IS_MAC } from '@/lib/util'

export function closeTabWithCleanup(tab: Tab): void {
  const before = useStore.getState().spaces.some((s) => s.tabs.some((t) => t.id === tab.id))
  useStore.getState().closeTab(tab.id)
  const after = useStore.getState().spaces.some((s) => s.tabs.some((t) => t.id === tab.id))
  if (before && !after && tab.kind === 'editor') disposeModel(tab)
}

export const TAB_ICON: Record<Tab['kind'], string> = {
  agent: 'agent',
  terminal: 'terminal',
  ssh: 'server',
  editor: 'file',
  sftp: 'files'
}

export function TabBar({ space }: { space: Space }) {
  const { statuses, dirty, setActiveTab, updateTab, moveTab, splitWith, unsplit, showFiles, set } = useStore()
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)

  return (
    <div className="tabbar drag">
      <div className="tabs no-drag">
        {space.tabs.map((t, i) => {
          const active = t.id === space.activeTabId
          const inSplit = t.id === space.split?.tabId
          return (
            <div
              key={t.id}
              className={`tab ${active ? 'active' : ''} ${inSplit ? 'split' : ''} kind-${t.kind}`}
              onMouseDown={(e) => e.button === 1 && closeTabWithCleanup(t)}
              onClick={() => setActiveTab(t.id)}
              onDoubleClick={() => setRenaming(t.id)}
              draggable
              onDragStart={() => setDragId(t.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragId && dragId !== t.id) moveTab(dragId, i)
                setDragId(null)
              }}
              title={t.filePath ?? t.title}
            >
              <span className="tab-icon"><Icon name={TAB_ICON[t.kind]} size={13} /></span>
              {renaming === t.id ? (
                <input
                  autoFocus
                  className="inline-input"
                  defaultValue={t.title}
                  onBlur={(e) => {
                    updateTab(t.id, { title: e.target.value || t.title })
                    setRenaming(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                />
              ) : (
                <span className="tab-title">{t.title}</span>
              )}
              {t.kind === 'agent' && <StatusDot status={statuses[t.id]} />}
              {dirty[t.id] && <span className="dirty-dot" title="Unsaved changes" />}
              <button
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation()
                  closeTabWithCleanup(t)
                }}
              >
                <Icon name="x" size={11} />
              </button>
            </div>
          )
        })}
        <div className="newtab-wrap">
          <button
            className="icon-btn newtab"
            title="New tab"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setMenuAt(menuAt ? null : { x: r.left, y: r.bottom })
            }}
          >
            <Icon name="plus" />
          </button>
          {menuAt && <NewTabMenu at={menuAt} onClose={() => setMenuAt(null)} />}
        </div>
      </div>
      <div className="tabbar-actions no-drag">
        {space.split ? (
          <button className="icon-btn" title="Close split" onClick={unsplit}><Icon name="x" /></button>
        ) : (
          <button className="icon-btn" title={`Split right (${keyLabel('splitRow', IS_MAC)})`} onClick={() => splitWith(undefined, 'row')}><Icon name="split" /></button>
        )}
        <button className={`icon-btn ${showFiles ? 'on' : ''}`} title={`Toggle files (${keyLabel('toggleFiles', IS_MAC)})`} onClick={() => set({ showFiles: !showFiles })}>
          <Icon name="sidebar" />
        </button>
      </div>
    </div>
  )
}

export function NewTabMenu({ at, onClose }: { at: { x: number; y: number }; onClose: () => void }) {
  const { agents, servers, newAgent, newTerminal, openSsh, set } = useStore()
  return (
    <>
      <div className="menu-backdrop" onClick={onClose} />
      <div className="dropdown" style={{ left: Math.min(at.x, window.innerWidth - 240), top: at.y }}>
        <div className="dropdown-label">Agents</div>
        {agents.map((a) => (
          <button
            key={a.id}
            disabled={!a.available}
            onClick={() => {
              newAgent(a.id)
              onClose()
            }}
            title={a.available ? a.command : `${a.command} not found in PATH`}
          >
            <Icon name="agent" /> {a.label}
            {!a.available && <span className="muted"> · not installed</span>}
          </button>
        ))}
        <div className="dropdown-sep" />
        <button
          onClick={() => {
            newTerminal()
            onClose()
          }}
        >
          <Icon name="terminal" /> Terminal
        </button>
        {servers.length > 0 && <div className="dropdown-label">SSH</div>}
        {servers.map((s) => (
          <button
            key={s.id}
            onClick={() => {
              openSsh(s)
              onClose()
            }}
          >
            <Icon name="server" /> {s.name}
          </button>
        ))}
        <div className="dropdown-sep" />
        <button
          onClick={() => {
            set({ serverModal: { mode: 'new' } })
            onClose()
          }}
        >
          <Icon name="plus" /> Add server…
        </button>
      </div>
    </>
  )
}
