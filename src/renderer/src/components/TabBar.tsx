import { useEffect, useRef, useState } from 'react'
import type { Space, Tab } from '@shared/types'
import { useStore } from '@/store'
import { Icon } from './Icon'
import { StatusDot } from './StatusDot'
import { disposeModel } from './EditorView'
import { keyLabel } from '@shared/keys'
import { hasTab, leafCount, type DropSide } from '@shared/layout'
import { IS_MAC } from '@/lib/util'
import { TAB_MIME } from './Workspace'

/** True when a drag ended outside this window's bounds (screen coordinates). */
function outsideWindow(e: React.DragEvent): boolean {
  const { screenX: x, screenY: y } = e
  if (x === 0 && y === 0) return false // some platforms report 0,0 for cancelled drags
  return x < window.screenX || y < window.screenY || x > window.screenX + window.outerWidth || y > window.screenY + window.outerHeight
}

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
  const { statuses, activities, dirty, detached, setActiveTab, updateTab, moveTab, splitWith, closePane, showFiles, set } = useStore()
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const [tabMenu, setTabMenu] = useState<{ tab: Tab; x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const multi = leafCount(space.layout) > 1
  const pulsing = useDonePulse(statuses)

  return (
    <div className="tabbar drag">
      <div className="tabs no-drag">
        {space.tabs.map((t, i) => {
          const active = t.id === space.activeTabId
          const shown = !active && hasTab(space.layout, t.id)
          const isDetached = !!detached[t.id]
          return (
            <div
              key={t.id}
              className={`tab ${active ? 'active' : ''} ${shown ? 'shown' : ''} ${isDetached ? 'detached' : ''} ${dropIndex === i ? 'drop-before' : ''} ${pulsing.has(t.id) ? 'pulse-done' : ''} kind-${t.kind}`}
              onMouseDown={(e) => e.button === 1 && closeTabWithCleanup(t)}
              onClick={() => setActiveTab(t.id)}
              onDoubleClick={() => setRenaming(t.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                setTabMenu({ tab: t, x: e.clientX, y: e.clientY })
              }}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(TAB_MIME, t.id)
                e.dataTransfer.effectAllowed = 'move'
                // changing the DOM synchronously in dragstart can cancel the drag in Chromium
                setTimeout(() => set({ draggingTabId: t.id }), 0)
              }}
              onDragEnd={(e) => {
                setDropIndex(null)
                set({ draggingTabId: undefined })
                if (e.dataTransfer.dropEffect === 'none' && outsideWindow(e))
                  useStore.getState().detachTab(t.id, { x: e.screenX, y: e.screenY })
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(TAB_MIME)) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (dropIndex !== i) setDropIndex(i)
              }}
              onDrop={(e) => {
                const id = e.dataTransfer.getData(TAB_MIME)
                setDropIndex(null)
                if (id && id !== t.id) moveTab(id, i)
              }}
              title={isDetached ? `${t.title} (in its own window)` : (t.filePath ?? t.title)}
            >
              <span className="tab-icon"><Icon name={isDetached ? 'window' : TAB_ICON[t.kind]} size={13} /></span>
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
              {t.kind === 'agent' && <StatusDot status={statuses[t.id]} activity={activities[t.id]} />}
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
        {multi && space.activeTabId && (
          <button className="icon-btn" title={`Close pane (${keyLabel('closePane', IS_MAC)})`} onClick={() => closePane(space.activeTabId!)}>
            <Icon name="x" />
          </button>
        )}
        <button className="icon-btn" title={`Split right (${keyLabel('splitRow', IS_MAC)})`} onClick={() => splitWith(undefined, 'right')}>
          <Icon name="split" />
        </button>
        <button className="icon-btn" title={`Split down (${keyLabel('splitColumn', IS_MAC)})`} onClick={() => splitWith(undefined, 'bottom')}>
          <Icon name="split-down" />
        </button>
        <button className={`icon-btn ${showFiles ? 'on' : ''}`} title={`Toggle files (${keyLabel('toggleFiles', IS_MAC)})`} onClick={() => set({ showFiles: !showFiles })}>
          <Icon name="sidebar" />
        </button>
      </div>
      {tabMenu && <TabMenu space={space} {...tabMenu} onClose={() => setTabMenu(null)} onRename={() => setRenaming(tabMenu.tab.id)} />}
    </div>
  )
}

/** Tabs whose agent just finished: they get one green pulse (~1.3s). */
function useDonePulse(statuses: Record<string, string>): Set<string> {
  const prev = useRef(statuses)
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const [pulsing, setPulsing] = useState<Set<string>>(new Set())
  useEffect(() => {
    const finished = Object.keys(statuses).filter((id) => statuses[id] === 'done' && prev.current[id] !== 'done')
    prev.current = statuses
    for (const id of finished) {
      setPulsing((p) => new Set(p).add(id))
      // each pulse ends on its own timer: later status changes (e.g. done → idle) must not cancel it
      clearTimeout(timers.current.get(id))
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id)
          setPulsing((p) => new Set([...p].filter((x) => x !== id)))
        }, 1400)
      )
    }
  }, [statuses])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  return pulsing
}

const SPLITS: { side: Exclude<DropSide, 'center'>; label: string; icon: string }[] = [
  { side: 'right', label: 'Split Right', icon: 'split' },
  { side: 'left', label: 'Split Left', icon: 'split-left' },
  { side: 'bottom', label: 'Split Down', icon: 'split-down' },
  { side: 'top', label: 'Split Up', icon: 'split-up' }
]

/** Right-click menu on a tab. */
function TabMenu({ space, tab, x, y, onClose, onRename }: { space: Space; tab: Tab; x: number; y: number; onClose: () => void; onRename: () => void }) {
  const { detached, splitWith, placeTab, closePane, detachTab } = useStore()
  const isDetached = !!detached[tab.id]
  const target = space.activeTabId
  const multi = leafCount(space.layout) > 1
  const run = (fn: () => void) => () => {
    fn()
    onClose()
  }
  return (
    <>
      <div className="menu-backdrop no-drag" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div className="dropdown no-drag" style={{ left: Math.min(x, window.innerWidth - 230), top: y }}>
        {SPLITS.map((s) => (
          <button
            key={s.side}
            // splitting the focused tab next to itself makes no sense: open a new terminal there instead
            onClick={run(() => (tab.id === target && !isDetached ? splitWith(undefined, s.side) : placeTab(tab.id, target, s.side)))}
          >
            <Icon name={s.icon} /> {s.label}
            {tab.id === target && !isDetached && <span className="muted"> · new terminal</span>}
          </button>
        ))}
        <div className="dropdown-sep" />
        {isDetached ? (
          <button onClick={run(() => placeTab(tab.id, target, 'center'))}>
            <Icon name="dock" /> Move Back to Main Window
          </button>
        ) : (
          <button onClick={run(() => detachTab(tab.id))}>
            <Icon name="window" /> Move to New Window <kbd>{keyLabel('detachTab', IS_MAC)}</kbd>
          </button>
        )}
        {multi && hasTab(space.layout, tab.id) && (
          <button onClick={run(() => closePane(tab.id))}>
            <Icon name="x" /> Close Pane
          </button>
        )}
        <div className="dropdown-sep" />
        <button onClick={run(onRename)}>
          <Icon name="edit" /> Rename
        </button>
        <button className="danger" onClick={run(() => closeTabWithCleanup(tab))}>
          <Icon name="trash" /> Close Tab
        </button>
      </div>
    </>
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
