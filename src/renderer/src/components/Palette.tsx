import { useMemo, useState } from 'react'
import { selectActiveSpace, useStore } from '@/store'
import { createSpaceFromPicker } from './Sidebar'
import { Icon } from './Icon'
import { TAB_ICON } from './TabBar'
import { keyLabel } from '@shared/keys'
import { IS_MAC } from '@/lib/util'

interface Cmd {
  id: string
  label: string
  hint?: string
  icon: string
  run: () => void
}

/** Mounted only while open, so the full store subscription below costs nothing otherwise. */
export function Palette() {
  const open = useStore((s) => s.paletteOpen)
  return open ? <OpenPalette /> : null
}

function OpenPalette() {
  const state = useStore()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const space = selectActiveSpace(state)

  const cmds = useMemo<Cmd[]>(() => {
    const list: Cmd[] = []
    for (const a of state.agents.filter((x) => x.available)) list.push({ id: 'agent-' + a.id, label: `New ${a.label} agent`, icon: 'agent', run: () => state.newAgent(a.id) })
    list.push({ id: 'term', label: 'New terminal', hint: keyLabel('newTerminal', IS_MAC), icon: 'terminal', run: state.newTerminal })
    list.push({ id: 'space', label: 'New space from folder…', hint: keyLabel('newSpace', IS_MAC), icon: 'folder', run: createSpaceFromPicker })
    list.push({ id: 'server', label: 'Add server…', icon: 'server', run: () => state.set({ serverModal: { mode: 'new' } }) })
    list.push({
      id: 'import', label: 'Import servers from ~/.ssh/config', icon: 'server',
      run: async () => {
        const n = await window.orbit.importSshConfig()
        state.set({ servers: await window.orbit.listServers() })
        state.notify(n ? `Imported ${n} host(s)` : 'No new hosts found')
      }
    })
    list.push({ id: 'split', label: 'Split right with new terminal', hint: keyLabel('splitRow', IS_MAC), icon: 'split', run: () => state.splitWith(undefined, 'right') })
    list.push({ id: 'split-down', label: 'Split down with new terminal', hint: keyLabel('splitColumn', IS_MAC), icon: 'split-down', run: () => state.splitWith(undefined, 'bottom') })
    list.push({ id: 'split-left', label: 'Split left with new terminal', icon: 'split-left', run: () => state.splitWith(undefined, 'left') })
    list.push({ id: 'split-up', label: 'Split up with new terminal', icon: 'split-up', run: () => state.splitWith(undefined, 'top') })
    const focused = selectActiveSpace(state)?.activeTabId
    if (focused) list.push({ id: 'detach', label: 'Move tab to new window', hint: keyLabel('detachTab', IS_MAC), icon: 'window', run: () => state.detachTab(focused) })
    list.push({ id: 'updates', label: 'Check for updates', icon: 'refresh', run: () => window.orbit.checkForUpdates() })
    list.push({ id: 'files', label: 'Toggle file tree', hint: keyLabel('toggleFiles', IS_MAC), icon: 'sidebar', run: () => state.set({ showFiles: !state.showFiles }) })
    list.push({ id: 'activity', label: 'Toggle activity log', hint: keyLabel('toggleActivity', IS_MAC), icon: 'activity', run: () => state.set({ showActivity: !state.showActivity }) })
    list.push({ id: 'settings', label: 'Settings', icon: 'settings', run: () => state.set({ settingsOpen: true }) })
    for (const s of state.servers) {
      list.push({ id: 'ssh-' + s.id, label: `SSH: ${s.name}`, hint: s.host, icon: 'terminal', run: () => state.openSsh(s) })
      list.push({ id: 'sftp-' + s.id, label: `Files: ${s.name}`, hint: s.host, icon: 'files', run: () => state.openSftp(s) })
    }
    for (const sp of state.spaces) {
      list.push({ id: 'sp-' + sp.id, label: `Go to space: ${sp.name}`, icon: 'folder', run: () => state.setActiveSpace(sp.id) })
      for (const t of sp.tabs) list.push({ id: 'tab-' + t.id, label: `${sp.name} › ${t.title}`, icon: TAB_ICON[t.kind], run: () => state.setActiveTab(t.id) })
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.agents, state.servers, state.spaces, state.showFiles, state.showActivity, space?.id])

  const filtered = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return cmds.filter((c) => words.every((w) => (c.label + ' ' + (c.hint ?? '')).toLowerCase().includes(w))).slice(0, 50)
  }, [cmds, q])

  if (!state.paletteOpen) return null
  const close = (): void => {
    state.set({ paletteOpen: false })
    setQ('')
    setSel(0)
  }
  const run = (c?: Cmd): void => {
    if (!c) return
    close()
    c.run()
  }

  return (
    <div className="modal-backdrop top" onMouseDown={close}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          placeholder="Type a command, server, space or tab…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setSel(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSel((s) => Math.min(s + 1, filtered.length - 1))
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSel((s) => Math.max(s - 1, 0))
            }
            if (e.key === 'Enter') run(filtered[sel])
          }}
        />
        <div className="palette-list">
          {filtered.map((c, i) => (
            <div key={c.id} className={`palette-item ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => run(c)}>
              <Icon name={c.icon} />
              <span>{c.label}</span>
              {c.hint && <span className="palette-hint">{c.hint}</span>}
            </div>
          ))}
          {filtered.length === 0 && <div className="pane-message">No matches</div>}
        </div>
      </div>
    </div>
  )
}
