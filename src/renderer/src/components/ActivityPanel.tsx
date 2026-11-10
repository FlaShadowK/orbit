import { useShallow } from 'zustand/react/shallow'
import { useState } from 'react'
import { useStore } from '@/store'
import { Icon } from './Icon'

export function ActivityPanel() {
  const { activity, showActivity, set } = useStore(useShallow((s) => ({ activity: s.activity, showActivity: s.showActivity, set: s.set })))
  const [open, setOpen] = useState<string | null>(null)
  if (!showActivity) return null
  const items = [...activity].reverse()
  return (
    <div className="activity">
      <div className="panel-header">
        <Icon name="activity" />
        <span className="panel-title">Agent activity on servers</span>
        <span className="muted">{activity.length} calls</span>
        <span className="grow" />
        <button className="icon-btn" onClick={() => set({ showActivity: false })}><Icon name="x" /></button>
      </div>
      <div className="activity-list">
        {items.length === 0 && <div className="pane-message">No MCP tool calls yet. Agents' server actions (ssh_exec, sftp, upload) appear here.</div>}
        {items.map((a) => (
          <div key={a.id} className={`activity-row ${a.ok ? '' : 'bad'}`} onClick={() => setOpen(open === a.id ? null : a.id)}>
            <div className="activity-line">
              <span className={`led ${a.ok ? 'ok' : 'bad'}`} />
              <span className="activity-time">{new Date(a.at).toLocaleTimeString()}</span>
              <span className="activity-tool">{a.tool}</span>
              {a.server && <span className="activity-server">{a.server}</span>}
              <code className="activity-summary">{a.summary}</code>
              <span className="activity-dur">{a.durationMs} ms</span>
            </div>
            {open === a.id && a.output && <pre className="activity-output">{a.output}</pre>}
          </div>
        ))}
      </div>
    </div>
  )
}
