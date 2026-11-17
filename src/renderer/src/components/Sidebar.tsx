import { useShallow } from 'zustand/react/shallow'
import { useState } from 'react'
import { isAgentTab, sidebarSections, spaceActivity, spaceStatus, spaceUsage, usageText, useStore, visibleSpaces } from '@/store'
import type { Space, SpaceGroup } from '@shared/types'
import { ContextMenu, type MenuAt, type MenuItem } from './ContextMenu'
import { Icon } from './Icon'
import { StatusDot } from './StatusDot'
import { ServerStats } from './ServerStats'
import { keyLabel } from '@shared/keys'
import { IS_MAC, isFileOnly } from '@/lib/util'

export async function createSpaceFromPicker(): Promise<void> {
  const root = await window.orbit.pickFolder()
  if (root) useStore.getState().addSpace(root)
}

const SPACE_MIME = 'application/x-orbit-space'

export function Sidebar() {
  const { spaces, groups, activeSpaceId, servers, openSsh, openSftp, set } = useStore(useShallow((s) => ({ spaces: s.spaces, groups: s.groups, activeSpaceId: s.activeSpaceId, servers: s.servers, openSsh: s.openSsh, openSftp: s.openSftp, set: s.set })))
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ at: MenuAt; items: MenuItem[] } | null>(null)
  /** drop target while a space is dragged: a folder id, '' for the top level */
  const [dropGroup, setDropGroup] = useState<string | null>(null)
  const sections = sidebarSections(spaces, groups)
  const order = visibleSpaces(spaces, groups, activeSpaceId)

  const newFolder = (spaceId?: string): void => {
    const g = useStore.getState().addGroup()
    if (spaceId) useStore.getState().moveSpaceToGroup(spaceId, g.id)
    setRenaming(g.id)
  }

  const dropProps = (groupId: string | undefined, beforeId?: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(SPACE_MIME)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      if (dropGroup !== (groupId ?? '')) setDropGroup(groupId ?? '')
    },
    onDrop: (e: React.DragEvent) => {
      const id = e.dataTransfer.getData(SPACE_MIME)
      setDropGroup(null)
      if (!id) return
      e.preventDefault()
      e.stopPropagation()
      useStore.getState().moveSpaceToGroup(id, groupId, beforeId)
    }
  })

  const spaceMenu = (sp: Space): MenuItem[] => {
    const st = useStore.getState()
    return [
      { label: 'Rename', icon: 'edit', onClick: () => setRenaming(sp.id) },
      { label: IS_MAC ? 'Open in Finder' : 'Open in File Manager', icon: 'folder', onClick: () => window.orbit.openPath(sp.root) },
      { label: 'Copy Path', icon: 'copy', onClick: () => navigator.clipboard.writeText(sp.root).then(() => st.notify('Copied path')) },
      { header: 'Move to folder' },
      ...groups.filter((g) => g.id !== sp.groupId).map((g): MenuItem => ({ label: g.name, icon: 'folder', onClick: () => st.moveSpaceToGroup(sp.id, g.id) })),
      ...(sp.groupId ? [{ label: 'Out of folder', icon: 'up', onClick: () => st.moveSpaceToGroup(sp.id, undefined) } as MenuItem] : []),
      { label: 'New folder…', icon: 'folder-plus', onClick: () => newFolder(sp.id) },
      'sep',
      {
        label: 'Close space',
        icon: 'trash',
        danger: true,
        onClick: () => {
          if (confirm(`Close space "${sp.name}"? Running agents and terminals in it will be stopped. Files are not touched.`)) st.removeSpace(sp.id)
        }
      }
    ]
  }

  const groupMenu = (g: SpaceGroup): MenuItem[] => {
    const st = useStore.getState()
    return [
      { label: 'Rename', icon: 'edit', onClick: () => setRenaming(g.id) },
      { label: g.collapsed ? 'Expand' : 'Collapse', icon: g.collapsed ? 'chevron-down' : 'chevron-right', onClick: () => st.updateGroup(g.id, { collapsed: !g.collapsed }) },
      {
        label: 'New space in this folder…',
        icon: 'plus',
        onClick: async () => {
          const root = await window.orbit.pickFolder()
          if (root) st.moveSpaceToGroup(st.addSpace(root).id, g.id)
        }
      },
      'sep',
      { label: 'Delete folder', icon: 'trash', danger: true, onClick: () => st.removeGroup(g.id) }
    ]
  }

  const renameInput = (value: string, onDone: (v: string) => void) => (
    <input
      autoFocus
      className="inline-input"
      defaultValue={value}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => {
        onDone(e.target.value.trim() || value)
        setRenaming(null)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setRenaming(null)
      }}
    />
  )

  const row = (sp: Space, nested: boolean) => (
    <SpaceRow
      key={sp.id}
      space={sp}
      nested={nested}
      active={sp.id === activeSpaceId}
      index={order.indexOf(sp)}
      renaming={renaming === sp.id}
      renameInput={renameInput}
      onMenu={(at) => setMenu({ at, items: spaceMenu(sp) })}
      onRename={() => setRenaming(sp.id)}
      drop={dropProps(sp.groupId, sp.id)}
      onDragEnd={() => setDropGroup(null)}
    />
  )

  return (
    <aside className="sidebar">
      <div className="sidebar-top drag">
        <div className="brand">
          <span className="brand-mark" />
          Orbit
        </div>
      </div>

      <div className="section spaces-section" onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropGroup(null)}>
        <div className={`section-head ${dropGroup === '' ? 'drop' : ''}`} {...dropProps(undefined)}>
          <span>Spaces</span>
          <span className="section-tools">
            <button className="icon-btn" title="New folder" onClick={() => newFolder()}>
              <Icon name="folder-plus" />
            </button>
            <button className="icon-btn" title={`New space (${keyLabel('newSpace', IS_MAC)})`} onClick={createSpaceFromPicker}>
              <Icon name="plus" />
            </button>
          </span>
        </div>
        {spaces.length === 0 && (
          <button className="empty-cta" onClick={createSpaceFromPicker}>
            Open a project folder
          </button>
        )}
        <div className="space-list">
          <div className={`space-top ${dropGroup === '' ? 'drop' : ''}`} {...dropProps(undefined)}>
            {sections[0].spaces.map((sp) => row(sp, false))}
          </div>
          {sections.slice(1).map(({ group, spaces: inGroup }) => {
            const g = group!
            const shown = g.collapsed ? inGroup.filter((sp) => sp.id === activeSpaceId) : inGroup
            return (
              <div key={g.id} className={`space-group ${g.collapsed ? 'collapsed' : ''} ${dropGroup === g.id ? 'drop' : ''}`} {...dropProps(g.id)}>
                <GroupRow
                  group={g}
                  spaces={inGroup}
                  renaming={renaming === g.id}
                  renameInput={renameInput}
                  onMenu={(at) => setMenu({ at, items: groupMenu(g) })}
                  onRename={() => setRenaming(g.id)}
                />
                {shown.map((sp) => row(sp, true))}
                {!g.collapsed && inGroup.length === 0 && <div className="group-empty">Drag spaces here</div>}
              </div>
            )
          })}
        </div>
      </div>
      {menu && <ContextMenu at={menu.at} items={menu.items} onClose={() => setMenu(null)} />}

      <div className="section grow">
        <div className="section-head">
          <span>Servers</span>
          <button className="icon-btn" title="Add server" onClick={() => set({ serverModal: { mode: 'new' } })}>
            <Icon name="plus" />
          </button>
        </div>
        {servers.length === 0 && (
          <div className="empty-hint">
            <button className="empty-cta" onClick={() => set({ serverModal: { mode: 'new' } })}>Add a server</button>
            <button
              className="link-btn"
              onClick={async () => {
                const n = await window.orbit.importSshConfig()
                useStore.getState().notify(n ? `Imported ${n} host(s) from ~/.ssh/config` : 'No new hosts found in ~/.ssh/config')
              }}
            >
              or import ~/.ssh/config
            </button>
          </div>
        )}
        <div className="server-list">
          {servers.map((srv) => (
            <div key={srv.id} className="server-item">
            <div className="server-row" onDoubleClick={() => (isFileOnly(srv) ? openSftp(srv) : openSsh(srv))} title={`${srv.protocol && srv.protocol !== 'ssh' ? `${srv.protocol}://` : ''}${srv.username}@${srv.host}:${srv.port}`}>
              <span className="server-led" style={{ background: srv.color }} />
              <div className="server-text">
                <span className="server-name">{srv.name}</span>
                <span className="server-host">{srv.username}@{srv.host}</span>
              </div>
              <div className="row-actions">
                {!isFileOnly(srv) && <button className="icon-btn" title="Open SSH terminal" onClick={() => openSsh(srv)}><Icon name="terminal" /></button>}
                <button className="icon-btn" title={`Browse files (${isFileOnly(srv) ? srv.protocol!.toUpperCase() : 'SFTP'})`} onClick={() => openSftp(srv)}><Icon name="files" /></button>
                <button className="icon-btn" title="Edit" onClick={() => set({ serverModal: { mode: 'edit', server: srv } })}><Icon name="edit" /></button>
              </div>
            </div>
            <ServerStats server={srv} />
            </div>
          ))}
        </div>
      </div>

      <UpdatePill />
      <div className="sidebar-foot">
        <button className="icon-btn" title={`Activity log (${keyLabel('toggleActivity', IS_MAC)})`} onClick={() => set({ showActivity: !useStore.getState().showActivity })}>
          <Icon name="activity" />
        </button>
        <button className="icon-btn" title="Settings" onClick={() => set({ settingsOpen: true })}>
          <Icon name="settings" />
        </button>
        <button className="foot-palette" onClick={() => set({ paletteOpen: true })}>
          <Icon name="search" size={12} /> Commands <kbd>{keyLabel('palette', IS_MAC)}</kbd>
        </button>
      </div>
    </aside>
  )
}


type RenameInput = (value: string, onDone: (v: string) => void) => React.ReactNode

function SpaceRow({ space: s, nested, active, index, renaming, renameInput, onMenu, onRename, drop, onDragEnd }: {
  space: Space
  nested: boolean
  active: boolean
  index: number
  renaming: boolean
  renameInput: RenameInput
  onMenu: (at: MenuAt) => void
  onRename: () => void
  drop: { onDragOver: (e: React.DragEvent) => void; onDrop: (e: React.DragEvent) => void }
  onDragEnd: () => void
}) {
  const { statuses, activities, running, usage, showUsage } = useStore(useShallow((st) => ({ statuses: st.statuses, activities: st.activities, running: st.running, usage: st.usage, showUsage: !!(st.settings.devMode && st.settings.showUsage) })))
  const st = spaceStatus(s, statuses, running)
  const agents = s.tabs.filter((t) => isAgentTab(t, running)).length
  const meta = showUsage ? usageText(spaceUsage(s, usage)) || 'idle' : ''
  return (
    <div
      className={`space-row ${active ? 'active' : ''} ${nested ? 'nested' : ''} ${showUsage ? 'with-meta' : ''}`}
      onClick={() => useStore.getState().setActiveSpace(s.id)}
      onDoubleClick={onRename}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu({ x: e.clientX, y: e.clientY })
      }}
      draggable={!renaming}
      onDragStart={(e) => {
        e.dataTransfer.setData(SPACE_MIME, s.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragEnd={onDragEnd}
      {...drop}
      title={s.root}
    >
      <span className="space-swatch" style={{ background: s.color }} />
      {renaming ? (
        renameInput(s.name, (name) => useStore.getState().updateSpace(s.id, { name }))
      ) : (
        <span className="space-text">
          <span className="space-name">{s.name}</span>
          {meta && <span className="usage-meta">{meta}</span>}
        </span>
      )}
      {st && <StatusDot status={st} activity={spaceActivity(s, statuses, activities)} />}
      {agents > 0 && <span className="pill">{agents}</span>}
      <span className="kbd-hint">{index >= 0 && index < 9 ? (IS_MAC ? `⌃${index + 1}` : `Ctrl+Alt+${index + 1}`) : ''}</span>
    </div>
  )
}

/** A sidebar folder. Collapsed, it still shows whether any agent inside needs you. */
function GroupRow({ group: g, spaces, renaming, renameInput, onMenu, onRename }: {
  group: SpaceGroup
  spaces: Space[]
  renaming: boolean
  renameInput: RenameInput
  onMenu: (at: MenuAt) => void
  onRename: () => void
}) {
  const { statuses, activities, running } = useStore(useShallow((st) => ({ statuses: st.statuses, activities: st.activities, running: st.running })))
  const all: Space = { id: g.id, name: g.name, root: '', color: '', tabs: spaces.flatMap((s) => s.tabs) }
  const st = g.collapsed ? spaceStatus(all, statuses, running) : undefined
  return (
    <div
      className="group-row"
      onClick={() => useStore.getState().updateGroup(g.id, { collapsed: !g.collapsed })}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onRename()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <Icon name={g.collapsed ? 'chevron-right' : 'chevron-down'} size={12} />
      {renaming ? renameInput(g.name, (name) => useStore.getState().updateGroup(g.id, { name })) : <span className="group-name">{g.name}</span>}
      {st && <StatusDot status={st} activity={spaceActivity(all, statuses, activities)} />}
      <span className="group-count">{spaces.length}</span>
    </div>
  )
}

/** Shown in the sidebar while an update downloads, and as a restart button once it's ready. */
function UpdatePill() {
  const update = useStore((s) => s.update)
  if (update.status === 'downloading')
    return (
      <div className="update-pill" title={`Downloading Orbit ${update.version}`}>
        <Icon name="refresh" size={12} /> v{update.version}
        <span className="bar"><i style={{ width: `${update.percent ?? 0}%` }} /></span>
      </div>
    )
  if (update.status === 'ready')
    return (
      <button className="update-pill" onClick={() => window.orbit.installUpdate()} title="Restart Orbit to install the update">
        <Icon name="check" size={12} /> Restart to update to v{update.version}
      </button>
    )
  if (update.status === 'available')
    return (
      <button className="update-pill" onClick={() => window.orbit.openExternal('https://github.com/FlaShadowK/orbit/releases/latest')}>
        <Icon name="globe" size={12} /> Orbit {update.version} is available
      </button>
    )
  return null
}
