import { create } from 'zustand'
import type { ActivityEntry, AgentInfo, AgentStatus, OrbitInfo, Server, Space, Tab } from '@shared/types'
import { basename, SPACE_COLORS, uid } from './lib/util'
import { keyLabel } from '@shared/keys'
import { IS_MAC } from './lib/util'

export type ServerModalState = { mode: 'new' } | { mode: 'edit'; server: Server } | null

interface State {
  ready: boolean
  info?: OrbitInfo
  spaces: Space[]
  activeSpaceId?: string
  servers: Server[]
  agents: AgentInfo[]
  statuses: Record<string, AgentStatus>
  activity: ActivityEntry[]
  dirty: Record<string, boolean>
  /** tab ids whose session has been started at least once in this renderer */
  showFiles: boolean
  showActivity: boolean
  paletteOpen: boolean
  serverModal: ServerModalState
  settingsOpen: boolean
  toast?: { text: string; kind: 'info' | 'error' }

  init(): Promise<void>
  addSpace(root: string, name?: string): Space
  removeSpace(id: string): void
  updateSpace(id: string, patch: Partial<Space>): void
  setActiveSpace(id: string): void
  addTab(tab: Partial<Tab> & Pick<Tab, 'kind'>, spaceId?: string, opts?: { split?: 'row' | 'column'; background?: boolean }): Tab | undefined
  closeTab(tabId: string): void
  setActiveTab(tabId: string): void
  updateTab(tabId: string, patch: Partial<Tab>): void
  moveTab(tabId: string, toIndex: number): void
  splitWith(tabId: string | undefined, direction: 'row' | 'column'): void
  unsplit(): void
  openFile(path: string, serverId?: string): void
  newAgent(agentId?: string): void
  newTerminal(): void
  openSsh(server: Server): void
  openSftp(server: Server): void
  setDirty(tabId: string, dirty: boolean): void
  set(patch: Partial<State>): void
  notify(text: string, kind?: 'info' | 'error'): void
}

let persistTimer: number | undefined
function persist(get: () => State): void {
  window.clearTimeout(persistTimer)
  persistTimer = window.setTimeout(() => {
    const { spaces, activeSpaceId } = get()
    window.orbit.setSpaces(spaces, activeSpaceId)
  }, 300)
}

const findSpaceOfTab = (spaces: Space[], tabId: string): Space | undefined =>
  spaces.find((s) => s.tabs.some((t) => t.id === tabId))

const isSessionTab = (t: Tab): boolean => t.kind === 'agent' || t.kind === 'terminal' || t.kind === 'ssh'

export const useStore = create<State>((set, get) => {
  const mutateSpaces = (fn: (spaces: Space[]) => Space[], extra: Partial<State> = {}): void => {
    set({ spaces: fn(get().spaces), ...extra })
    persist(get)
  }
  const activeSpace = (): Space | undefined => get().spaces.find((s) => s.id === get().activeSpaceId)

  return {
    ready: false,
    spaces: [],
    servers: [],
    agents: [],
    statuses: {},
    activity: [],
    dirty: {},
    showFiles: true,
    showActivity: false,
    paletteOpen: false,
    serverModal: null,
    settingsOpen: false,

    async init() {
      const [info, { spaces, activeSpaceId }, servers, agents, statuses, activity] = await Promise.all([
        window.orbit.info(),
        window.orbit.getSpaces(),
        window.orbit.listServers(),
        window.orbit.listAgents(),
        window.orbit.getStatuses(),
        window.orbit.getActivity()
      ])
      set({ info, spaces, activeSpaceId: activeSpaceId ?? spaces[0]?.id, servers, agents, statuses, activity, ready: true })
      for (const s of spaces) window.orbit.fsWatch(s.root)
    },

    addSpace(root, name) {
      const space: Space = {
        id: uid(),
        name: name ?? basename(root),
        root,
        color: SPACE_COLORS[get().spaces.length % SPACE_COLORS.length],
        tabs: []
      }
      mutateSpaces((s) => [...s, space], { activeSpaceId: space.id })
      window.orbit.fsWatch(root)
      return space
    },

    removeSpace(id) {
      const space = get().spaces.find((s) => s.id === id)
      space?.tabs.filter(isSessionTab).forEach((t) => window.orbit.termKill(t.id))
      const rest = get().spaces.filter((s) => s.id !== id)
      mutateSpaces(() => rest, { activeSpaceId: get().activeSpaceId === id ? rest[0]?.id : get().activeSpaceId })
    },

    updateSpace(id, patch) {
      mutateSpaces((spaces) => spaces.map((s) => (s.id === id ? { ...s, ...patch } : s)))
    },

    setActiveSpace(id) {
      set({ activeSpaceId: id })
      persist(get)
    },

    addTab(partial, spaceId, opts) {
      const space = spaceId ? get().spaces.find((s) => s.id === spaceId) : activeSpace()
      const target = space ?? activeSpace()
      if (!target) {
        get().notify(`Create a space first (${keyLabel('newSpace', IS_MAC)})`, 'error')
        return undefined
      }
      const tab: Tab = { id: uid(), title: partial.kind, ...partial }
      mutateSpaces((spaces) =>
        spaces.map((s) => {
          if (s.id !== target.id) return s
          const next: Space = { ...s, tabs: [...s.tabs, tab] }
          if (opts?.split) next.split = { tabId: tab.id, direction: opts.split }
          else if (!opts?.background) {
            next.activeTabId = tab.id
            if (s.split?.tabId === s.activeTabId) next.split = undefined
          }
          return next
        }),
        opts?.background ? {} : { activeSpaceId: target.id }
      )
      window.orbit.setTabTitle(tab.id, `${target.name} · ${tab.title}`)
      return tab
    },

    closeTab(tabId) {
      const space = findSpaceOfTab(get().spaces, tabId)
      if (!space) return
      const tab = space.tabs.find((t) => t.id === tabId)!
      if (tab.kind === 'editor' && get().dirty[tabId] && !confirm(`Discard unsaved changes to ${tab.title}?`)) return
      if (isSessionTab(tab)) window.orbit.termKill(tabId)
      const idx = space.tabs.findIndex((t) => t.id === tabId)
      const tabs = space.tabs.filter((t) => t.id !== tabId)
      let activeTabId = space.activeTabId
      let split = space.split
      if (split?.tabId === tabId) split = undefined
      if (activeTabId === tabId) {
        if (split) {
          activeTabId = split.tabId
          split = undefined
        } else activeTabId = (tabs[idx] ?? tabs[idx - 1])?.id
      }
      const dirty = { ...get().dirty }
      delete dirty[tabId]
      mutateSpaces((spaces) => spaces.map((s) => (s.id === space.id ? { ...s, tabs, activeTabId, split } : s)), { dirty })
    },

    setActiveTab(tabId) {
      const space = findSpaceOfTab(get().spaces, tabId)
      if (!space) return
      mutateSpaces(
        (spaces) =>
          spaces.map((s) => {
            if (s.id !== space.id) return s
            // clicking the split tab keeps the split; clicking another replaces the primary pane
            if (s.split?.tabId === tabId) return s
            return { ...s, activeTabId: tabId }
          }),
        { activeSpaceId: space.id }
      )
      window.dispatchEvent(new CustomEvent('orbit:focus', { detail: tabId }))
    },

    updateTab(tabId, patch) {
      mutateSpaces((spaces) =>
        spaces.map((s) => (s.tabs.some((t) => t.id === tabId) ? { ...s, tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t)) } : s))
      )
    },

    moveTab(tabId, toIndex) {
      mutateSpaces((spaces) =>
        spaces.map((s) => {
          const from = s.tabs.findIndex((t) => t.id === tabId)
          if (from < 0) return s
          const tabs = [...s.tabs]
          const [t] = tabs.splice(from, 1)
          tabs.splice(Math.min(toIndex, tabs.length), 0, t)
          return { ...s, tabs }
        })
      )
    },

    splitWith(tabId, direction) {
      const space = activeSpace()
      if (!space) return
      if (!tabId) {
        // split with a fresh terminal
        get().addTab({ kind: 'terminal', title: 'Terminal' }, space.id, { split: direction })
        return
      }
      if (tabId === space.activeTabId) return
      get().updateSpace(space.id, { split: { tabId, direction } })
    },

    unsplit() {
      const space = activeSpace()
      if (space) get().updateSpace(space.id, { split: undefined })
    },

    openFile(path, serverId) {
      const space = activeSpace()
      if (!space) return
      const existing = space.tabs.find((t) => t.kind === 'editor' && t.filePath === path && t.serverId === serverId)
      if (existing) return get().setActiveTab(existing.id)
      get().addTab({ kind: 'editor', title: path.split(/[\\/]/).pop() ?? path, filePath: path, serverId })
    },

    newAgent(agentId) {
      const id = agentId ?? get().agents.find((a) => a.available)?.id ?? 'claude'
      const agent = get().agents.find((a) => a.id === id)
      get().addTab({ kind: 'agent', agent: id, title: agent?.label ?? id, agentSessionId: id === 'claude' ? uid() : undefined })
    },

    newTerminal() {
      get().addTab({ kind: 'terminal', title: 'Terminal' })
    },

    openSsh(server) {
      get().addTab({ kind: 'ssh', title: server.name, serverId: server.id })
    },

    openSftp(server) {
      get().addTab({ kind: 'sftp', title: `${server.name} files`, serverId: server.id })
    },

    setDirty(tabId, dirty) {
      if (!!get().dirty[tabId] === dirty) return
      set({ dirty: { ...get().dirty, [tabId]: dirty } })
    },

    set(patch) {
      set(patch)
    },

    notify(text, kind = 'info') {
      set({ toast: { text, kind } })
      window.setTimeout(() => {
        if (get().toast?.text === text) set({ toast: undefined })
      }, 3500)
    }
  }
})

export const selectActiveSpace = (s: State): Space | undefined => s.spaces.find((x) => x.id === s.activeSpaceId)

export function spaceStatus(space: Space, statuses: Record<string, AgentStatus>): AgentStatus | undefined {
  const st = space.tabs.filter((t) => t.kind === 'agent').map((t) => statuses[t.id])
  if (st.includes('waiting')) return 'waiting'
  if (st.includes('working')) return 'working'
  if (st.includes('done')) return 'done'
  return undefined
}
