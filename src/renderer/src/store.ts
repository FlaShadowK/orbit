import { create } from 'zustand'
import type { ActivityEntry, AgentActivity, AgentInfo, AgentStatus, OrbitInfo, Server, Space, Tab, UpdateState } from '@shared/types'
import { basename, IS_MAC, SPACE_COLORS, uid } from './lib/util'
import { keyLabel } from '@shared/keys'
import { hasTab, leaf, leafCount, placeTab as placeInLayout, prune, removeTab, replaceTab, setRatio, tabsIn, type DropSide } from '@shared/layout'

export type ServerModalState = { mode: 'new' } | { mode: 'edit'; server: Server } | null

interface State {
  ready: boolean
  info?: OrbitInfo
  spaces: Space[]
  activeSpaceId?: string
  servers: Server[]
  agents: AgentInfo[]
  statuses: Record<string, AgentStatus>
  /** what a working agent is doing right now (orbit speed) */
  activities: Record<string, AgentActivity>
  activity: ActivityEntry[]
  dirty: Record<string, boolean>
  /** tab ids whose session has been started at least once in this renderer */
  showFiles: boolean
  showActivity: boolean
  paletteOpen: boolean
  serverModal: ServerModalState
  settingsOpen: boolean
  toast?: { text: string; kind: 'info' | 'error' }
  /** tabs currently shown in their own window */
  detached: Record<string, boolean>
  /** tab being dragged from the tab bar (drives the drop-zone overlay) */
  draggingTabId?: string
  update: UpdateState

  init(): Promise<void>
  addSpace(root: string, name?: string): Space
  removeSpace(id: string): void
  updateSpace(id: string, patch: Partial<Space>): void
  setActiveSpace(id: string): void
  addTab(tab: Partial<Tab> & Pick<Tab, 'kind'>, spaceId?: string, opts?: { side?: DropSide; background?: boolean }): Tab | undefined
  closeTab(tabId: string): void
  setActiveTab(tabId: string): void
  updateTab(tabId: string, patch: Partial<Tab>): void
  moveTab(tabId: string, toIndex: number): void
  /** split the focused pane: show `tabId` (or a new terminal) on `side` of it */
  splitWith(tabId: string | undefined, side: Exclude<DropSide, 'center'>): void
  /** drag & drop: show `tabId` on `side` of the pane showing `targetTabId` */
  placeTab(tabId: string, targetTabId: string | undefined, side: DropSide): void
  /** hide a pane (the tab stays open in the tab bar) */
  closePane(tabId: string): void
  resizeSplit(spaceId: string, splitId: string, ratio: number): void
  detachTab(tabId: string, at?: { x: number; y: number }): void
  dockTab(tabId: string): void
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
/** detached windows render a single tab and must never overwrite the saved spaces */
let persistEnabled = true
export function disablePersistence(): void {
  persistEnabled = false
}
function persist(get: () => State): void {
  if (!persistEnabled) return
  window.clearTimeout(persistTimer)
  persistTimer = window.setTimeout(() => {
    const { spaces, activeSpaceId } = get()
    window.orbit.setSpaces(spaces, activeSpaceId)
  }, 300)
}

const findSpaceOfTab = (spaces: Space[], tabId: string): Space | undefined =>
  spaces.find((s) => s.tabs.some((t) => t.id === tabId))

const isSessionTab = (t: Tab): boolean => t.kind === 'agent' || t.kind === 'terminal' || t.kind === 'ssh'

/** Bring a saved space up to date: migrate the old single split and drop stale panes. */
export function normalizeSpace(s: Space): Space {
  const ids = new Set(s.tabs.map((t) => t.id))
  let layout = prune(s.layout, ids)
  const active = s.activeTabId && ids.has(s.activeTabId) ? s.activeTabId : s.tabs[0]?.id
  if (!layout && active) {
    layout = leaf(active)
    if (s.split && ids.has(s.split.tabId) && s.split.tabId !== active)
      layout = placeInLayout(layout, s.split.tabId, active, s.split.direction === 'row' ? 'right' : 'bottom')
  }
  const activeTabId = active && hasTab(layout, active) ? active : tabsIn(layout)[0]
  return { ...s, layout, activeTabId, split: undefined }
}

/** Show `tabId` in the focused pane of `s` (or focus it if it's already visible). */
function showTab(s: Space, tabId: string): Space {
  if (hasTab(s.layout, tabId)) return { ...s, activeTabId: tabId }
  if (s.layout && s.activeTabId && hasTab(s.layout, s.activeTabId))
    return { ...s, layout: replaceTab(s.layout, s.activeTabId, tabId), activeTabId: tabId }
  return { ...s, layout: s.layout ? placeInLayout(s.layout, tabId, tabsIn(s.layout)[0], 'center') : leaf(tabId), activeTabId: tabId }
}

/** Remove `tabId` from the panes; a lone pane switches to a neighbouring tab instead. */
function hideTab(s: Space, tabId: string, tabs: Tab[], detached: Record<string, boolean>): Space {
  if (!hasTab(s.layout, tabId)) return s
  const visible = new Set(tabsIn(s.layout))
  if (leafCount(s.layout) > 1) {
    const layout = removeTab(s.layout, tabId)
    const activeTabId = s.activeTabId === tabId || !hasTab(layout, s.activeTabId ?? '') ? tabsIn(layout)[0] : s.activeTabId
    return { ...s, layout, activeTabId }
  }
  const idx = s.tabs.findIndex((t) => t.id === tabId)
  const order = [...tabs.slice(idx), ...tabs.slice(0, idx).reverse()]
  const next = order.find((t) => t.id !== tabId && !visible.has(t.id) && !detached[t.id])
  if (next) return { ...s, layout: replaceTab(s.layout, tabId, next.id), activeTabId: next.id }
  return { ...s, layout: undefined, activeTabId: undefined }
}

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
    activities: {},
    activity: [],
    dirty: {},
    showFiles: true,
    showActivity: false,
    paletteOpen: false,
    serverModal: null,
    settingsOpen: false,
    detached: {},
    update: { status: 'idle' },

    async init() {
      // optional: a renderer hot-reloaded onto an older main process doesn't have it yet
      window.orbit.updateState?.().then((update) => set({ update }), () => {})
      const [info, { spaces, activeSpaceId }, servers, agents, statuses, activity] = await Promise.all([
        window.orbit.info(),
        window.orbit.getSpaces(),
        window.orbit.listServers(),
        window.orbit.listAgents(),
        window.orbit.getStatuses(),
        window.orbit.getActivity()
      ])
      set({ info, spaces: spaces.map(normalizeSpace), activeSpaceId: activeSpaceId ?? spaces[0]?.id, servers, agents, statuses, activity, ready: true })
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
      mutateSpaces(
        (spaces) =>
          spaces.map((s) => {
            if (s.id !== target.id) return s
            const next: Space = { ...s, tabs: [...s.tabs, tab] }
            if (opts?.side && opts.side !== 'center' && s.layout)
              return { ...next, layout: placeInLayout(s.layout, tab.id, s.activeTabId, opts.side), activeTabId: tab.id }
            if (opts?.background && s.layout) return next
            return showTab(next, tab.id)
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
      if (get().detached[tabId]) window.orbit.closeDetached(tabId)
      const tabs = space.tabs.filter((t) => t.id !== tabId)
      const dirty = { ...get().dirty }
      delete dirty[tabId]
      const detached = { ...get().detached }
      delete detached[tabId]
      mutateSpaces(
        (spaces) => spaces.map((s) => (s.id === space.id ? { ...hideTab(s, tabId, space.tabs, detached), tabs } : s)),
        { dirty, detached }
      )
    },

    setActiveTab(tabId) {
      const space = findSpaceOfTab(get().spaces, tabId)
      if (!space) return
      if (get().detached[tabId]) {
        window.orbit.focusDetached(tabId)
        return
      }
      mutateSpaces((spaces) => spaces.map((s) => (s.id === space.id ? showTab(s, tabId) : s)), { activeSpaceId: space.id })
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

    splitWith(tabId, side) {
      const space = activeSpace()
      if (!space) return
      if (!tabId) {
        get().addTab({ kind: 'terminal', title: 'Terminal' }, space.id, { side })
        return
      }
      get().placeTab(tabId, space.activeTabId, side)
    },

    placeTab(tabId, targetTabId, side) {
      const space = findSpaceOfTab(get().spaces, tabId)
      if (!space) return
      const detached = { ...get().detached }
      if (detached[tabId]) {
        delete detached[tabId]
        window.orbit.closeDetached(tabId)
      }
      mutateSpaces(
        (spaces) =>
          spaces.map((s) => {
            if (s.id !== space.id) return s
            const target = targetTabId && hasTab(s.layout, targetTabId) ? targetTabId : s.activeTabId
            return { ...s, layout: placeInLayout(s.layout, tabId, target, side), activeTabId: tabId }
          }),
        { detached, activeSpaceId: space.id }
      )
      window.dispatchEvent(new CustomEvent('orbit:focus', { detail: tabId }))
    },

    closePane(tabId) {
      const space = findSpaceOfTab(get().spaces, tabId)
      if (!space || leafCount(space.layout) < 2) return
      mutateSpaces((spaces) => spaces.map((s) => (s.id === space.id ? hideTab(s, tabId, s.tabs, get().detached) : s)))
    },

    resizeSplit(spaceId, splitId, ratio) {
      mutateSpaces((spaces) => spaces.map((s) => (s.id === spaceId && s.layout ? { ...s, layout: setRatio(s.layout, splitId, ratio) } : s)))
    },

    detachTab(tabId, at) {
      const space = findSpaceOfTab(get().spaces, tabId)
      const tab = space?.tabs.find((t) => t.id === tabId)
      if (!space || !tab || get().detached[tabId]) return
      if (get().dirty[tabId]) {
        get().notify(`Save ${tab.title} before moving it to a window`, 'error')
        return
      }
      const detached = { ...get().detached, [tabId]: true }
      // hide it here first so this window lets go of the session before the new one attaches
      mutateSpaces((spaces) => spaces.map((s) => (s.id === space.id ? hideTab(s, tabId, s.tabs, detached) : s)), { detached })
      window.orbit.detachTab({ tabId, spaceId: space.id, title: tab.title, at })
    },

    dockTab(tabId) {
      const detached = { ...get().detached }
      delete detached[tabId]
      set({ detached })
      const space = findSpaceOfTab(get().spaces, tabId)
      if (!space) return
      // come back next to what the user is looking at instead of replacing it
      mutateSpaces(
        (spaces) =>
          spaces.map((s) =>
            s.id !== space.id ? s : s.layout ? { ...s, layout: placeInLayout(s.layout, tabId, s.activeTabId, 'right'), activeTabId: tabId } : showTab(s, tabId)
          ),
        { activeSpaceId: space.id }
      )
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

/** The most active working agent in a space (for the sidebar indicator). */
export function spaceActivity(space: Space, statuses: Record<string, AgentStatus>, activities: Record<string, AgentActivity>): AgentActivity | undefined {
  const acts = space.tabs.filter((t) => statuses[t.id] === 'working').map((t) => activities[t.id] ?? 'thinking')
  return acts.includes('streaming') ? 'streaming' : acts.includes('thinking') ? 'thinking' : acts[0]
}

export function spaceStatus(space: Space, statuses: Record<string, AgentStatus>): AgentStatus | undefined {
  const st = space.tabs.filter((t) => t.kind === 'agent').map((t) => statuses[t.id])
  if (st.includes('waiting')) return 'waiting'
  if (st.includes('working')) return 'working'
  if (st.includes('done')) return 'done'
  return undefined
}
