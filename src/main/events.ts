import { BrowserWindow, Notification } from 'electron'
import type { ActivityEntry, AgentActivity, AgentStatus, MainEvent } from '@shared/types'
import { showMain } from './windows'

export function emit(ev: MainEvent): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('orbit:event', ev)
}

export function send(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, ...args)
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
