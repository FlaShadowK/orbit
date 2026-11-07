import { useEffect, useState } from 'react'
import type { Space, Tab } from '@shared/types'
import { selectActiveSpace, useStore } from './store'
import { Sidebar, createSpaceFromPicker } from './components/Sidebar'
import { TabBar, closeTabWithCleanup } from './components/TabBar'
import { TerminalView } from './components/TerminalView'
import { EditorView, reloadIfClean, saveTab } from './components/EditorView'
import { SftpView } from './components/SftpView'
import { FileTree } from './components/FileTree'
import { ServerModal } from './components/ServerModal'
import { Palette } from './components/Palette'
import { ActivityPanel } from './components/ActivityPanel'
import { SettingsModal } from './components/SettingsModal'
import { Icon } from './components/Icon'

const isSession = (t: Tab): boolean => t.kind === 'agent' || t.kind === 'terminal' || t.kind === 'ssh'

let focusedTabId: string | undefined

function currentEditorTab(space?: Space): Tab | undefined {
  if (!space) return
  const ids = [focusedTabId, space.activeTabId, space.split?.tabId]
  for (const id of ids) {
    const t = space.tabs.find((x) => x.id === id && x.kind === 'editor')
    if (t) return t
  }
}

function useMainEvents(): void {
  useEffect(() => {
    const st = useStore.getState
    const offEvent = window.orbit.onEvent((e) => {
      switch (e.type) {
        case 'status':
          st().set({ statuses: { ...st().statuses, [e.tabId]: e.status } })
          break
        case 'agentStarted':
          st().updateTab(e.tabId, { agentStarted: true })
          break
        case 'activity':
          st().set({ activity: [...st().activity.slice(-499), e.entry] })
          break
        case 'fs':
          if (e.event === 'change') reloadIfClean(e.path)
          break
        case 'openTab':
          st().addTab(e.tab, e.spaceId, { background: false })
          break
        case 'servers':
          st().set({ servers: e.servers })
          break
      }
    })
    const offFocus = window.orbit.onFocusTab((id) => st().setActiveTab(id))
    const offCmd = window.orbit.onCommand((cmd) => {
      const s = st()
      const space = selectActiveSpace(s)
      switch (cmd) {
        case 'newSpace':
          createSpaceFromPicker()
          break
        case 'newAgent':
          s.newAgent()
          break
        case 'newTerminal':
          s.newTerminal()
          break
        case 'palette':
          s.set({ paletteOpen: !s.paletteOpen })
          break
        case 'toggleFiles':
          s.set({ showFiles: !s.showFiles })
          break
        case 'toggleActivity':
          s.set({ showActivity: !s.showActivity })
          break
        case 'splitRow':
        case 'splitColumn':
          s.splitWith(undefined, cmd === 'splitRow' ? 'row' : 'column')
          break
        case 'closeTab': {
          const id = focusedTabId && space?.tabs.some((t) => t.id === focusedTabId) ? focusedTabId : space?.activeTabId
          const tab = space?.tabs.find((t) => t.id === id)
          if (tab) closeTabWithCleanup(tab)
          break
        }
        case 'save': {
          const tab = currentEditorTab(space)
          if (tab)
            saveTab(tab).then(
              () => s.notify(`Saved ${tab.title}`),
              (err) => s.notify(`Save failed: ${(err as Error).message}`, 'error')
            )
          break
        }
      }
    })
    const onKey = (e: KeyboardEvent): void => {
      const s = st()
      const space = selectActiveSpace(s)
      if (e.metaKey && !e.shiftKey && /^[1-9]$/.test(e.key) && space) {
        const t = space.tabs[Number(e.key) - 1]
        if (t) s.setActiveTab(t.id)
        e.preventDefault()
      } else if (e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
        const sp = s.spaces[Number(e.key) - 1]
        if (sp) s.setActiveSpace(sp.id)
        e.preventDefault()
      } else if (e.metaKey && e.shiftKey && (e.key === '[' || e.key === ']' || e.key === '{' || e.key === '}') && space) {
        const i = space.tabs.findIndex((t) => t.id === space.activeTabId)
        const d = e.key === '[' || e.key === '{' ? -1 : 1
        const t = space.tabs[(i + d + space.tabs.length) % space.tabs.length]
        if (t) s.setActiveTab(t.id)
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      offEvent()
      offFocus()
      offCmd()
      window.removeEventListener('keydown', onKey, true)
    }
  }, [])
}

function Pane({ tab, space, visible, area, focused }: { tab: Tab; space: Space; visible: boolean; area?: string; focused: boolean }) {
  const keepMounted = isSession(tab)
  if (!visible && !keepMounted) return null
  return (
    <div
      className={`pane ${focused ? 'focused' : ''}`}
      style={{ display: visible ? 'flex' : 'none', gridArea: area }}
      onMouseDown={() => {
        focusedTabId = tab.id
      }}
    >
      {isSession(tab) && <TerminalView tab={tab} space={space} visible={visible} focused={focused} />}
      {tab.kind === 'editor' && <EditorView tab={tab} focused={focused} />}
      {tab.kind === 'sftp' && <SftpView tab={tab} />}
    </div>
  )
}

function Welcome({ space }: { space?: Space }) {
  const { agents, newAgent, newTerminal, servers, openSsh, set } = useStore()
  if (!space)
    return (
      <div className="welcome">
        <div className="welcome-orb" />
        <h1>Orbit</h1>
        <p>Agents, terminals, editor and servers — in one place.</p>
        <button className="btn primary big" onClick={createSpaceFromPicker}>Open a project folder</button>
        <p className="muted small">Each folder becomes a space with its own agents and terminals.</p>
      </div>
    )
  return (
    <div className="welcome">
      <h2>{space.name}</h2>
      <p className="muted small">{space.root}</p>
      <div className="welcome-grid">
        {agents.filter((a) => a.available).map((a) => (
          <button key={a.id} className="welcome-card" onClick={() => newAgent(a.id)}>
            <Icon name="agent" size={20} />
            <span>{a.label}</span>
            <small>agent tab with Orbit MCP</small>
          </button>
        ))}
        <button className="welcome-card" onClick={newTerminal}>
          <Icon name="terminal" size={20} />
          <span>Terminal</span>
          <small>shell in project root</small>
        </button>
        {servers.slice(0, 4).map((s) => (
          <button key={s.id} className="welcome-card" onClick={() => openSsh(s)}>
            <Icon name="server" size={20} />
            <span>{s.name}</span>
            <small>{s.username}@{s.host}</small>
          </button>
        ))}
        {servers.length === 0 && (
          <button className="welcome-card" onClick={() => set({ serverModal: { mode: 'new' } })}>
            <Icon name="plus" size={20} />
            <span>Add server</span>
            <small>SSH + agent access</small>
          </button>
        )}
      </div>
      <p className="muted small">⌘T agent · ⌘⇧T terminal · ⌘K commands · ⌘D split · ⌘B files</p>
    </div>
  )
}

function Workspace({ space, active }: { space: Space; active: boolean }) {
  const [focus, setFocus] = useState<string | undefined>(space.activeTabId)
  useEffect(() => setFocus(space.activeTabId), [space.activeTabId])
  useEffect(() => {
    const onFocus = (e: Event): void => setFocus((e as CustomEvent).detail)
    window.addEventListener('orbit:focus', onFocus)
    return () => window.removeEventListener('orbit:focus', onFocus)
  }, [])
  const split = space.split && space.tabs.some((t) => t.id === space.split!.tabId) && space.split.tabId !== space.activeTabId ? space.split : undefined
  return (
    <div className={`panes ${split ? 'split-' + split.direction : ''}`} style={{ display: active ? 'grid' : 'none' }}>
      {space.tabs.length === 0 && <Welcome space={space} />}
      {space.tabs.map((t) => {
        const primary = t.id === space.activeTabId
        const secondary = t.id === split?.tabId
        return (
          <Pane
            key={t.id}
            tab={t}
            space={space}
            visible={active && (primary || secondary)}
            area={primary ? 'a' : secondary ? 'b' : undefined}
            focused={active && focus === t.id}
          />
        )
      })}
    </div>
  )
}

export function App() {
  const state = useStore()
  const space = selectActiveSpace(state)
  useMainEvents()
  useEffect(() => {
    state.init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // clear "done" badge once the user looks at the tab
  useEffect(() => {
    const id = space?.activeTabId
    if (id && state.statuses[id] === 'done') state.set({ statuses: { ...state.statuses, [id]: 'idle' } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space?.activeTabId, state.statuses])

  if (!state.ready) return <div className="boot" />

  return (
    <div className={`app platform-${state.info?.platform}`}>
      <Sidebar />
      <main className="main">
        {space ? <TabBar space={space} /> : <div className="tabbar drag" />}
        <div className="body">
          <div className="workspaces">
            {state.spaces.map((s) => (
              <Workspace key={s.id} space={s} active={s.id === space?.id} />
            ))}
            {!space && <Welcome />}
          </div>
          {space && state.showFiles && <FileTree key={space.id} space={space} />}
        </div>
        <ActivityPanel />
      </main>
      <ServerModal />
      <SettingsModal />
      <Palette />
      {state.toast && <div className={`toast ${state.toast.kind}`}>{state.toast.text}</div>}
    </div>
  )
}
