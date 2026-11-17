import { create } from 'zustand'
import type { ActivityEntry, AgentActivity, AgentBase, AgentInfo, AgentStatus, GitStatus, MainEvent, OrbitInfo, Server, Settings, Space, SpaceGroup, Tab, TabUsage, TransferState, UpdateState, UsageReport } from '@shared/types'
import { basename, IS_MAC, SPACE_COLORS, uid } from './lib/util'
import { keyLabel } from '@shared/keys'
import { hasTab, leaf, leafCount, placeTab as placeInLayout, prune, removeTab, replaceTab, setRatio, tabsIn, type DropSide } from '@shared/layout'

export type ServerModalState = { mode: 'new' } | { mode: 'edit'; server: Server } | null

interface State {
  ready: boolean
  info?: OrbitInfo
  spaces: Space[]
  activeSpaceId?: string
  /** sidebar folders of spaces */
  groups: SpaceGroup[]
  settings: Settings
  servers: Server[]
  agents: AgentInfo[]
  statuses: Record<string, AgentStatus>
  /** what a working agent is doing right now */
  activities: Record<string, AgentActivity>
  /** agent CLI running in a terminal tab, whether started by a button or typed */
  running: Record<string, AgentBase>
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
  /** git status per space root */
  git: Record<string, GitStatus>
  /** server whose stats tiles are being customized */
  statsEditor?: string
  /** file copies to/from servers, by id (finished ones linger briefly) */
  transfers: Record<string, TransferState>
  /** developer: latest resource usage sample (only while the readout is on) */
  usage?: UsageReport

  init(): Promise<void>
  addSpace(root: string, name?: string): Space
  removeSpace(id: string): void
  updateSpace(id: string, patch: Partial<Space>): void
  addGroup(name?: string): SpaceGroup
  updateGroup(id: string, patch: Partial<SpaceGroup>): void
  /** delete a folder; its spaces move back to the top level */
  removeGroup(id: string): void
  /** file a space under a folder (or the top level), optionally right before another space */
  moveSpaceToGroup(spaceId: string, groupId: string | undefined, beforeId?: string): void
  updateSettings(patch: Partial<Settings>): Promise<void>
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
  /** re-read git status for a space folder (debounced) */
  refreshGit(root: string): void
  /** open (or focus) the code review tab of the active space */
  openChanges(): void
  openFile(path: string, serverId?: string): void
  newAgent(agentId?: string): void
  /** a shell tab, starting in `cwd` (default: the space folder) */
  newTerminal(cwd?: string): void
  openSsh(server: Server): void
  openSftp(server: Server): void
  setDirty(tabId: string, dirty: boolean): void
  set(patch: Partial<State>): void
  notify(text: string, kind?: 'info' | 'error'): void
}

let persistTimer: number | undefined
const gitTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** roots with a `git status` in flight, and those that changed again while it ran */
const gitRunning = new Set<string>()
const gitAgain = new Set<string>()
/** detached windows render a single tab and must never overwrite the saved spaces */
let persistEnabled = true
export function disablePersistence(): void {
  persistEnabled = false
}
function persist(get: () => State): void {
  if (!persistEnabled) return
  window.clearTimeout(persistTimer)
  persistTimer = window.setTimeout(() => {
    const { spaces, activeSpaceId, groups } = get()
    window.orbit.setSpaces(spaces, activeSpaceId, groups)
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
    groups: [],
    settings: { fontSize: 13, agentCommands: {}, defaultAgent: 'claude' },
    transfers: {},
    servers: [],
    agents: [],
    statuses: {},
    running: {},
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
    git: {},

    async init() {
      // optional: a renderer hot-reloaded onto an older main process doesn't have it yet
      window.orbit.updateState?.().then((update) => set({ update }), () => {})
      const [info, { spaces, activeSpaceId, groups }, servers, agents, statuses, activity, settings] = await Promise.all([
        window.orbit.info(),
        window.orbit.getSpaces(),
        window.orbit.listServers(),
        window.orbit.listAgents(),
        window.orbit.getStatuses(),
        window.orbit.getActivity(),
        window.orbit.getSettings()
      ])
      const groupIds = new Set((groups ?? []).map((g) => g.id))
      set({
        info,
        // a space filed under a folder that no longer exists goes back to the top level
        spaces: spaces.map((s) => normalizeSpace(s.groupId && !groupIds.has(s.groupId) ? { ...s, groupId: undefined } : s)),
        groups: groups ?? [],
        activeSpaceId: activeSpaceId ?? spaces[0]?.id,
        servers, agents, statuses, activity, settings, ready: true
      })
      window.orbit.runningAgents?.().then((running) => set({ running }), () => {})
      for (const s of spaces) {
        window.orbit.fsWatch(s.root)
        window.orbit.git?.watch(s.root)
        get().refreshGit(s.root)
      }
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
      window.orbit.git?.watch(root)
      get().refreshGit(root)
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

    addGroup(name = 'New folder') {
      const group: SpaceGroup = { id: uid(), name }
      set({ groups: [...get().groups, group] })
      persist(get)
      return group
    },

    updateGroup(id, patch) {
      set({ groups: get().groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) })
      persist(get)
    },

    removeGroup(id) {
      mutateSpaces((spaces) => spaces.map((s) => (s.groupId === id ? { ...s, groupId: undefined } : s)), { groups: get().groups.filter((g) => g.id !== id) })
    },

    moveSpaceToGroup(spaceId, groupId, beforeId) {
      if (spaceId === beforeId) return
      // open the folder it lands in, so the space doesn't seem to vanish
      if (groupId) set({ groups: get().groups.map((g) => (g.id === groupId ? { ...g, collapsed: false } : g)) })
      mutateSpaces((spaces) => {
        const moving = spaces.find((s) => s.id === spaceId)
        if (!moving) return spaces
        const rest = spaces.filter((s) => s.id !== spaceId)
        const at = beforeId ? rest.findIndex((s) => s.id === beforeId) : -1
        const next = { ...moving, groupId }
        return at < 0 ? [...rest, next] : [...rest.slice(0, at), next, ...rest.slice(at)]
      })
    },

    async updateSettings(patch) {
      set({ settings: { ...get().settings, ...patch } })
      set({ settings: await window.orbit.setSettings(patch) })
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

    // Throttled, not debounced: agents writing files nonstop would keep pushing a debounce
    // back forever. At most one `git status` per root runs at a time; changes during a run
    // queue exactly one more.
    refreshGit(root) {
      if (gitTimers.has(root)) return
      gitTimers.set(
        root,
        setTimeout(() => {
          gitTimers.delete(root)
          if (!window.orbit.git) return
          if (gitRunning.has(root)) {
            gitAgain.add(root)
            return
          }
          gitRunning.add(root)
          window.orbit.git
            .status(root)
            .then(
              (st) => set({ git: { ...get().git, [root]: st } }),
              () => set({ git: { ...get().git, [root]: { isRepo: false, ahead: 0, behind: 0, files: [] } } })
            )
            .finally(() => {
              gitRunning.delete(root)
              if (gitAgain.delete(root)) get().refreshGit(root)
            })
        }, 300)
      )
    },

    openChanges() {
      const space = activeSpace()
      if (!space) return
      const existing = space.tabs.find((t) => t.kind === 'changes')
      if (existing) get().setActiveTab(existing.id)
      else get().addTab({ kind: 'changes', title: 'Changes' })
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
      get().addTab({ kind: 'agent', agent: id, title: agent?.label ?? id, agentSessionId: agent?.base === 'claude' || id === 'claude' ? uid() : undefined })
    },

    newTerminal(cwd) {
      get().addTab({ kind: 'terminal', title: cwd ? basename(cwd) : 'Terminal', cwd })
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

/**
 * Agent status, activity and detection events come in bursts with many agents running (each
 * one can flip between streaming and thinking several times a second). Applying each as its
 * own store update re-renders the tab bar and sidebar every time; instead they are collected
 * and applied together once per frame. Returns false for events it doesn't handle.
 */
let agentQueue: { statuses: Record<string, AgentStatus>; activities: Record<string, AgentActivity>; running: Record<string, AgentBase | null> } | null = null

export function queueAgentEvent(e: MainEvent): boolean {
  if (e.type !== 'status' && e.type !== 'agentActivity' && e.type !== 'agentDetected') return false
  if (!agentQueue) {
    agentQueue = { statuses: {}, activities: {}, running: {} }
    requestAnimationFrame(flushAgentEvents)
  }
  if (e.type === 'status') agentQueue.statuses[e.tabId] = e.status
  else if (e.type === 'agentActivity') agentQueue.activities[e.tabId] = e.activity
  else agentQueue.running[e.tabId] = e.agent
  return true
}

function flushAgentEvents(): void {
  const q = agentQueue
  agentQueue = null
  if (!q) return
  const s = useStore.getState()
  const patch: Partial<State> = {}
  if (Object.keys(q.statuses).length) patch.statuses = { ...s.statuses, ...q.statuses }
  if (Object.keys(q.activities).length) patch.activities = { ...s.activities, ...q.activities }
  const detected = Object.entries(q.running)
  if (detected.length) {
    const running = { ...s.running }
    for (const [id, agent] of detected) {
      if (agent) running[id] = agent
      else delete running[id]
    }
    patch.running = running
  }
  useStore.setState(patch)
}

/** Keep a transfer's latest progress; finished ones disappear after a few seconds (errors stay longer). */
export function trackTransfer(t: TransferState): void {
  const s = useStore.getState()
  s.set({ transfers: { ...s.transfers, [t.id]: t } })
  if (t.status === 'error') s.notify(`${t.direction === 'up' ? 'Upload' : 'Download'} of ${t.label} failed: ${t.error ?? 'unknown error'}`, 'error')
  if (t.status === 'done' || t.status === 'cancelled' || t.status === 'error')
    setTimeout(() => {
      const { transfers } = useStore.getState()
      if (transfers[t.id]?.status !== t.status) return
      const next = { ...transfers }
      delete next[t.id]
      useStore.getState().set({ transfers: next })
    }, t.status === 'error' ? 12000 : 4000)
}

export const selectActiveSpace = (s: State): Space | undefined => s.spaces.find((x) => x.id === s.activeSpaceId)

/** Resource use of a space: all of its tabs added up. */
export function spaceUsage(space: Space, usage?: UsageReport): TabUsage | undefined {
  if (!usage) return undefined
  let cpu = 0
  let mem = 0
  let net = 0
  let any = false
  for (const t of space.tabs) {
    const u = usage.tabs[t.id]
    if (!u) continue
    any = true
    cpu += u.cpu ?? 0
    mem += u.mem ?? 0
    net += u.net ?? 0
  }
  return any ? { cpu: Math.round(cpu * 10) / 10, mem, net } : undefined
}

/** "3.2% · 184 MB", or "↓ 1.2 KB/s" for SSH-only. */
export function usageText(u?: TabUsage): string {
  if (!u) return ''
  const parts: string[] = []
  if (u.cpu != null) parts.push(`${u.cpu < 10 ? u.cpu.toFixed(1) : Math.round(u.cpu)}% CPU`)
  if (u.mem) parts.push(u.mem >= 1024 ** 3 ? `${(u.mem / 1024 ** 3).toFixed(2)} GB` : `${Math.round(u.mem / 1024 ** 2)} MB`)
  if (u.net) parts.push(`↓ ${u.net >= 1024 ** 2 ? `${(u.net / 1024 ** 2).toFixed(1)} MB/s` : u.net >= 1024 ? `${(u.net / 1024).toFixed(1)} KB/s` : `${u.net} B/s`}`)
  return parts.join(' · ')
}

/** Sidebar order: top-level spaces first, then each folder's. */
export function sidebarSections(spaces: Space[], groups: SpaceGroup[]): { group?: SpaceGroup; spaces: Space[] }[] {
  const known = new Set(groups.map((g) => g.id))
  return [
    { spaces: spaces.filter((s) => !s.groupId || !known.has(s.groupId)) },
    ...groups.map((group) => ({ group, spaces: spaces.filter((s) => s.groupId === group.id) }))
  ]
}

/**
 * The space rows on screen, top to bottom: what ⌃1–9 switch between. A collapsed folder hides
 * its spaces except the one you're in.
 */
export function visibleSpaces(spaces: Space[], groups: SpaceGroup[], activeSpaceId?: string): Space[] {
  return sidebarSections(spaces, groups).flatMap((sec) => (sec.group?.collapsed ? sec.spaces.filter((s) => s.id === activeSpaceId) : sec.spaces))
}

/** The most active working agent in a space (for the sidebar indicator). */
export function spaceActivity(space: Space, statuses: Record<string, AgentStatus>, activities: Record<string, AgentActivity>): AgentActivity | undefined {
  const acts = space.tabs.filter((t) => statuses[t.id] === 'working').map((t) => activities[t.id] ?? 'thinking')
  return acts.includes('streaming') ? 'streaming' : acts.includes('thinking') ? 'thinking' : acts[0]
}

/** An agent tab: opened from an agent button, or a terminal with an agent CLI running in it. */
export const isAgentTab = (t: Tab, running: Record<string, AgentBase>): boolean => t.kind === 'agent' || !!running[t.id]

/** Which agent CLI a tab runs right now, if known. */
export function tabAgent(t: Tab, running: Record<string, AgentBase>, agents: AgentInfo[]): AgentBase | undefined {
  if (running[t.id]) return running[t.id]
  if (t.kind !== 'agent') return undefined
  return agents.find((a) => a.id === t.agent)?.base ?? (t.agent as AgentBase | undefined)
}

export function spaceStatus(space: Space, statuses: Record<string, AgentStatus>, running: Record<string, AgentBase> = {}): AgentStatus | undefined {
  const st = space.tabs.filter((t) => isAgentTab(t, running)).map((t) => statuses[t.id])
  if (st.includes('waiting')) return 'waiting'
  if (st.includes('working')) return 'working'
  if (st.includes('done')) return 'done'
  return undefined
}
