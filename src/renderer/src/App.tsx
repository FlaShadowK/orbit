import { useEffect } from 'react'
import type { Space, Tab } from '@shared/types'
import { selectActiveSpace, useStore } from './store'
import { Sidebar, createSpaceFromPicker } from './components/Sidebar'
import { TabBar, closeTabWithCleanup } from './components/TabBar'
import { reloadIfClean, saveTab } from './components/EditorView'
import { Workspace } from './components/Workspace'
import { DetachedApp, detachedTarget } from './components/DetachedApp'
import { FileTree } from './components/FileTree'
import { ServerModal } from './components/ServerModal'
import { Palette } from './components/Palette'
import { ActivityPanel } from './components/ActivityPanel'
import { SettingsModal } from './components/SettingsModal'
import { Icon } from './components/Icon'
import { keyLabel, spaceIndexShortcut, tabIndexShortcut } from '@shared/keys'
import { IS_MAC } from './lib/util'

function currentEditorTab(space?: Space): Tab | undefined {
  return space?.tabs.find((t) => t.id === space.activeTabId && t.kind === 'editor')
}

function useMainEvents(): void {
  useEffect(() => {
    const st = useStore.getState
    const offEvent = window.orbit.onEvent((e) => {
      switch (e.type) {
        case 'status':
          st().set({ statuses: { ...st().statuses, [e.tabId]: e.status } })
          break
        case 'agentActivity':
          st().set({ activities: { ...st().activities, [e.tabId]: e.activity } })
          break
        case 'agentStarted':
          st().updateTab(e.tabId, { agentStarted: true })
          break
        case 'activity':
          st().set({ activity: [...st().activity.slice(-499), e.entry] })
          break
        case 'fs':
          if (e.event === 'change') reloadIfClean(e.path)
          st().refreshGit(e.root)
          break
        case 'git':
          st().refreshGit(e.root)
          break
        case 'openTab':
          st().addTab(e.tab, e.spaceId, { background: false })
          break
        case 'servers':
          st().set({ servers: e.servers })
          break
        case 'detached':
          if (!e.detached && st().detached[e.tabId]) st().dockTab(e.tabId)
          break
        case 'update':
          st().set({ update: e.state })
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
          s.splitWith(undefined, 'right')
          break
        case 'splitColumn':
          s.splitWith(undefined, 'bottom')
          break
        case 'splitLeft':
          s.splitWith(undefined, 'left')
          break
        case 'splitUp':
          s.splitWith(undefined, 'top')
          break
        case 'closePane':
          if (space?.activeTabId) s.closePane(space.activeTabId)
          break
        case 'detachTab':
          if (space?.activeTabId) s.detachTab(space.activeTabId)
          break
        case 'closeTab': {
          const tab = space?.tabs.find((t) => t.id === space.activeTabId)
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
      const ti = tabIndexShortcut(e, IS_MAC)
      const si = spaceIndexShortcut(e, IS_MAC)
      const cycle = IS_MAC ? e.metaKey && e.shiftKey && !e.ctrlKey : e.ctrlKey && !e.shiftKey && e.key === 'Tab'
      if (ti && space) {
        const t = space.tabs[ti - 1]
        if (t) s.setActiveTab(t.id)
        e.preventDefault()
      } else if (si) {
        const sp = s.spaces[si - 1]
        if (sp) s.setActiveSpace(sp.id)
        e.preventDefault()
      } else if (cycle && space && (IS_MAC ? ['[', ']', '{', '}'].includes(e.key) : true)) {
        const i = space.tabs.findIndex((t) => t.id === space.activeTabId)
        const d = IS_MAC ? (e.key === '[' || e.key === '{' ? -1 : 1) : 1
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
      <p className="muted small">
        {keyLabel('newAgent', IS_MAC)} agent · {keyLabel('newTerminal', IS_MAC)} terminal · {keyLabel('palette', IS_MAC)} commands ·{' '}
        {keyLabel('splitRow', IS_MAC)} split · {keyLabel('toggleFiles', IS_MAC)} files
      </p>
    </div>
  )
}

export function App() {
  const target = detachedTarget()
  return target ? <DetachedApp {...target} /> : <MainApp />
}

function MainApp() {
  const state = useStore()
  const space = selectActiveSpace(state)
  useMainEvents()
  useEffect(() => {
    state.init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // clear the green "done" dot a few seconds after the user looks at the tab
  useEffect(() => {
    const id = space?.activeTabId
    if (!id || state.statuses[id] !== 'done') return
    const t = setTimeout(() => {
      const s = useStore.getState()
      if (s.statuses[id] === 'done') s.set({ statuses: { ...s.statuses, [id]: 'idle' } })
    }, 3000)
    return () => clearTimeout(t)
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
              <Workspace key={s.id} space={s} active={s.id === space?.id} empty={<Welcome space={s} />} />
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
