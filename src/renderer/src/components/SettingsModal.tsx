import { useEffect, useState } from 'react'
import type { Settings } from '@shared/types'
import { useStore } from '@/store'

export function SettingsModal() {
  const { settingsOpen, info, agents, set, notify } = useStore()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [custom, setCustom] = useState('')

  useEffect(() => {
    if (!settingsOpen) return
    window.orbit.getSettings().then((s) => {
      setSettings(s)
      setCustom(Object.entries(s.agentCommands).map(([k, v]) => `${k}=${v}`).join('\n'))
    })
  }, [settingsOpen])

  if (!settingsOpen || !settings) return null
  const close = (): void => set({ settingsOpen: false })

  const save = async (): Promise<void> => {
    const agentCommands: Record<string, string> = {}
    for (const line of custom.split('\n')) {
      const i = line.indexOf('=')
      if (i > 0) agentCommands[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    }
    await window.orbit.setSettings({ shell: settings.shell || undefined, agentCommands, autoUpdate: settings.autoUpdate !== false })
    set({ agents: await window.orbit.listAgents() })
    close()
  }

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <div className="form-grid">
          <label className="span2">
            Shell <span className="muted">(empty = $SHELL)</span>
            <input value={settings.shell ?? ''} placeholder="/bin/zsh" onChange={(e) => setSettings({ ...settings, shell: e.target.value })} />
          </label>
          <label className="span2">
            Agent commands <span className="muted">(id=command, one per line — override or add agents)</span>
            <textarea
              rows={4}
              value={custom}
              placeholder={'claude=claude --model opus\naider=aider --no-auto-commits'}
              onChange={(e) => setCustom(e.target.value)}
            />
          </label>
          <div className="span2 detected">
            Detected:{' '}
            {agents.map((a) => (
              <span key={a.id} className={`pill ${a.available ? 'ok' : ''}`}>{a.label}</span>
            ))}
          </div>
          <div className="span2 mcp-box">
            <div className="mcp-title">Updates</div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={settings.autoUpdate !== false}
                onChange={(e) => setSettings({ ...settings, autoUpdate: e.target.checked })}
              />
              Check GitHub for new releases and download them automatically
            </label>
            <p className="muted">You're on Orbit {info?.version}. Updates install when you restart Orbit.</p>
            <button className="btn" onClick={() => window.orbit.checkForUpdates()}>Check now</button>
          </div>
          <div className="span2 mcp-box">
            <div className="mcp-title">Orbit MCP server</div>
            <code>{info?.mcpUrl}</code>
            <p className="muted">
              Agent tabs get this server automatically. Register it globally to use Orbit's server tools from Claude Code sessions outside the app too
              (the URL stays the same as long as port 47821 is free).
            </p>
            <button
              className="btn"
              onClick={async () => {
                try {
                  await window.orbit.registerMcpGlobal()
                  notify('Registered "orbit" MCP server in Claude Code (user scope)')
                } catch (e) {
                  notify((e as Error).message, 'error')
                }
              }}
            >
              Register in Claude Code globally
            </button>
          </div>
        </div>
        <div className="modal-actions">
          <span className="grow" />
          <button className="btn" onClick={close}>Cancel</button>
          <button className="btn primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}
