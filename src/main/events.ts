import { BrowserWindow, Notification } from 'electron'
import type { ActivityEntry, AgentStatus, MainEvent } from '@shared/types'

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
      const w = BrowserWindow.getAllWindows()[0]
      w?.show()
      w?.focus()
      emit({ type: 'status', tabId, status })
      send('orbit:focusTab', tabId)
    })
    n.show()
  }
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
