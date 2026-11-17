import { useShallow } from 'zustand/react/shallow'
import { useEffect, useRef, useState } from 'react'
import type { Settings } from '@shared/types'
import { THEMES } from '@shared/themes'
import { useStore } from '@/store'

/** Theme cards: a tiny painted window per theme. Picking one applies it right away. */
function ThemePicker() {
  const current = useStore((s) => s.settings.theme ?? 'orbit')
  return (
    <div className="theme-grid">
      {THEMES.map((t) => (
        <button
          key={t.id}
          className={`theme-card ${current === t.id ? 'on' : ''}`}
          onClick={() => useStore.getState().updateSettings({ theme: t.id })}
          title={`${t.label} (${t.kind})`}
        >
          <span className="theme-swatch" style={{ background: t.ui.bg, borderColor: t.ui['line-2'] }}>
            <span className="ts-side" style={{ background: t.ui['bg-1'], borderColor: t.ui.line }} />
            <span className="ts-lines">
              <i style={{ background: t.ui.accent, width: '46%' }} />
              <i style={{ background: t.ui['fg-2'], width: '70%' }} />
              <i style={{ background: t.ui['fg-3'], width: '58%' }} />
              <i style={{ background: t.ui['accent-2'], width: '36%' }} />
            </span>
            <span className="ts-dot" style={{ background: t.ui.warn }} />
          </span>
          <span className="theme-label">{t.label}</span>
        </button>
      ))}
    </div>
  )
}

/** Hidden until unlocked: tools for looking under the hood. */
function DeveloperBox() {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  if (!settings.devMode) return null
  return (
    <div className="span2 mcp-box dev-box">
      <div className="mcp-title">Developer</div>
      <label className="check-row">
        <input type="checkbox" checked={!!settings.showUsage} onChange={(e) => update({ showUsage: e.target.checked })} />
        Show resource usage under each space and tab
      </label>
      <p className="muted">
        CPU and memory of every terminal and everything running in it (agents, dev servers, builds), sampled every 2 seconds. SSH tabs show
        incoming traffic. Costs nothing while off.
      </p>
      <button className="link-btn" onClick={() => update({ devMode: false, showUsage: false })}>Hide developer settings</button>
    </div>
  )
}

export function SettingsModal() {
  const { settingsOpen, info, agents, set, notify } = useStore(useShallow((s) => ({ settingsOpen: s.settingsOpen, info: s.info, agents: s.agents, set: s.set, notify: s.notify })))
  const [settings, setSettings] = useState<Settings | null>(null)
  const [custom, setCustom] = useState('')
  const devMode = useStore((s) => !!s.settings.devMode)
  const versionClicks = useRef<number[]>([])

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
          <div className="span2">
            <div className="field-label">Theme</div>
            <ThemePicker />
          </div>
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
            <p className="muted">
              You're on{' '}
              <span
                className="version-tap"
                onClick={() => {
                  // five quick clicks on the version unlock the developer settings
                  const now = Date.now()
                  versionClicks.current = [...versionClicks.current.filter((t) => now - t < 2500), now]
                  if (versionClicks.current.length >= 5 && !devMode) {
                    versionClicks.current = []
                    useStore.getState().updateSettings({ devMode: true })
                    notify('Developer settings unlocked')
                  }
                }}
              >
                Orbit {info?.version}
              </span>
              . Updates install when you restart Orbit.
            </p>
            <button className="btn" onClick={() => window.orbit.checkForUpdates()}>Check now</button>
          </div>
          <DeveloperBox />
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
