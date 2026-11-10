import { BrowserWindow, Notification } from 'electron'
import type { ActivityEntry, AgentActivity, AgentStatus, MainEvent } from '@shared/types'
import { detachedWindows, mainWindow, showMain } from './windows'
import { countIpc, PERF } from './perf'
import type { OutputBatch } from './outputBatch'

export function emit(ev: MainEvent): void {
  for (const w of BrowserWindow.getAllWindows())
    if (!w.isDestroyed()) {
      w.webContents.send('orbit:event', ev)
      if (PERF) countIpc(64)
    }
}

export function send(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows())
    if (!w.isDestroyed()) {
      w.webContents.send(channel, ...args)
      if (PERF) countIpc(64)
    }
}

/**
 * Terminal output: the main window gets every batch, a detached window only its own tab's
 * output (it renders nothing else).
 */
export function sendTermBatch(batch: OutputBatch): void {
  const main = mainWindow()
  if (main) {
    main.webContents.send('term:batch', batch)
    if (PERF) countIpc(batch.reduce((n, [, d]) => n + d.length, 0))
  }
  for (const [tabId, w] of detachedWindows()) {
    if (w.isDestroyed()) continue
    const mine = batch.filter(([id]) => id === tabId)
    if (mine.length) w.webContents.send('term:batch', mine)
  }
}

// ---- agent status
const statuses = new Map<string, AgentStatus>()
const titles = new Map<string, string>()

export function setTabTitle(tabId: string, title: string): void {
  titles.set(tabId, title)
}

export function setStatus(tabId: string, status: AgentStatus): void {
  const prev = statuses.get(tabId)
  if (prev === status) return
  statuses.set(tabId, status)
  emit({ type: 'status', tabId, status })
  const focused = BrowserWindow.getAllWindows().some((w) => w.isFocused())
  if (!focused && prev === 'working' && (status === 'waiting' || status === 'done') && Notification.isSupported()) {
    const n = new Notification({
      title: titles.get(tabId) ?? 'Agent',
      body: status === 'waiting' ? 'Needs your input' : 'Finished'
    })
    n.on('click', () => {
      showMain()
      emit({ type: 'status', tabId, status })
      send('orbit:focusTab', tabId)
    })
    n.show()
  }
}

/** The terminal no longer runs an agent: forget its status. */
export function clearStatus(tabId: string): void {
  if (!statuses.has(tabId)) return
  statuses.delete(tabId)
  activities.delete(tabId)
  emit({ type: 'status', tabId, status: 'idle' })
}

export function getStatus(tabId: string): AgentStatus | undefined {
  return statuses.get(tabId)
}

const activities = new Map<string, AgentActivity>()
/** Fine-grained state of a working agent (drives the orbit animation speed). */
export function setActivity(tabId: string, activity: AgentActivity): void {
  if (activities.get(tabId) === activity) return
  activities.set(tabId, activity)
  emit({ type: 'agentActivity', tabId, activity })
}

export function getStatuses(): Record<string, AgentStatus> {
  return Object.fromEntries(statuses)
}

// ---- activity log
const activity: ActivityEntry[] = []
export function logActivity(entry: ActivityEntry): void {
  activity.push(entry)
  if (activity.length > 500) activity.shift()
  emit({ type: 'activity', entry })
}
export function getActivity(): ActivityEntry[] {
  return activity
}
