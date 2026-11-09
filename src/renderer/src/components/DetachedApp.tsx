import { useEffect } from 'react'
import { disablePersistence, useStore } from '@/store'
import { Icon } from './Icon'
import { StatusDot } from './StatusDot'
import { TAB_ICON } from './TabBar'
import { PaneContent } from './Workspace'
import { saveTab } from './EditorView'

/** `#detached=<tabId>&space=<spaceId>` → this window shows a single tab moved out of the main window. */
export function detachedTarget(): { tabId: string; spaceId: string } | null {
  const params = new URLSearchParams(location.hash.slice(1))
  const tabId = params.get('detached')
  const spaceId = params.get('space')
  return tabId && spaceId ? { tabId, spaceId } : null
}

export function DetachedApp({ tabId, spaceId }: { tabId: string; spaceId: string }) {
  const ready = useStore((s) => s.ready)
  const space = useStore((s) => s.spaces.find((x) => x.id === spaceId))
  const status = useStore((s) => s.statuses[tabId])
  const platform = useStore((s) => s.info?.platform)
  const tab = space?.tabs.find((t) => t.id === tabId)

  useEffect(() => {
    // the main window owns the saved layout; this window only reads it
    disablePersistence()
    const st = useStore.getState
    st().init()
    const offEvent = window.orbit.onEvent((e) => {
      if (e.type === 'status') st().set({ statuses: { ...st().statuses, [e.tabId]: e.status } })
      if (e.type === 'servers') st().set({ servers: e.servers })
    })
    const offCmd = window.orbit.onCommand((cmd) => {
      const t = st().spaces.find((x) => x.id === spaceId)?.tabs.find((x) => x.id === tabId)
      if (cmd === 'closeTab' || cmd === 'detachTab') window.close() // docks it back
      if (cmd === 'save' && t?.kind === 'editor')
        saveTab(t).then(
          () => st().notify(`Saved ${t.title}`),
          (err) => st().notify(`Save failed: ${(err as Error).message}`, 'error')
        )
    })
    return () => {
      offEvent()
      offCmd()
    }
  }, [tabId, spaceId])

  useEffect(() => {
    if (tab) document.title = `${tab.title} — ${space?.name ?? 'Orbit'}`
  }, [tab, space?.name])

  const toast = useStore((s) => s.toast)
  if (!ready) return <div className="boot" />
  if (!space || !tab) return <div className="pane-message">This tab is no longer open.</div>

  return (
    <div className={`detached-app platform-${platform}`}>
      <div className="detached-bar drag">
        <span className="tab-icon"><Icon name={TAB_ICON[tab.kind]} size={13} /></span>
        <span className="detached-title">{tab.title}</span>
        <span className="muted small">· {space.name}</span>
        {tab.kind === 'agent' && <StatusDot status={status} />}
        <button className="btn ghost small no-drag dock-btn" title="Move back to the main window" onClick={() => window.close()}>
          <Icon name="dock" size={13} /> Dock
        </button>
      </div>
      <div className="detached-body">
        <div className="pane focused" style={{ position: 'absolute', inset: 0 }}>
          <PaneContent tab={tab} space={space} visible focused />
        </div>
      </div>
      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </div>
  )
}
