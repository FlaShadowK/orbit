import { useState } from 'react'
import type { AgentAlias, AgentBase, AgentInfo } from '@shared/types'
import { useStore } from '@/store'
import { uid } from '@/lib/util'
import { Icon } from './Icon'

const BASES: { id: AgentBase; label: string }[] = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'gemini', label: 'Gemini CLI' },
  { id: 'opencode', label: 'opencode' },
  { id: 'other', label: 'Other' }
]

/** Best guess of which CLI an alias runs, from its name or command. */
function guessBase(text: string): AgentBase {
  const t = text.toLowerCase()
  return BASES.find((b) => b.id !== 'other' && t.includes(b.id))?.id ?? 'other'
}

async function saveAliases(next: AgentAlias[]): Promise<void> {
  await window.orbit.setSettings({ agentAliases: next })
  useStore.getState().set({ agents: await window.orbit.listAgents() })
}

async function currentAliases(): Promise<AgentAlias[]> {
  return (await window.orbit.getSettings()).agentAliases ?? []
}

export async function removeAlias(id: string): Promise<void> {
  await saveAliases((await currentAliases()).filter((a) => a.id !== id))
}

/** Inline form to add or edit an agent alias like `claude-work`. */
export function AliasForm({ alias, onDone }: { alias?: AgentInfo; onDone: () => void }) {
  const [command, setCommand] = useState(alias?.command ?? '')
  const [label, setLabel] = useState(alias?.label ?? '')
  const [base, setBase] = useState<AgentBase | null>(alias?.base ?? null)
  const effectiveBase = base ?? guessBase(command)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const cmd = command.trim()
    if (!cmd) return
    const entry: AgentAlias = { id: alias?.id ?? `alias-${uid().slice(0, 8)}`, label: label.trim() || cmd, command: cmd, base: effectiveBase }
    const list = await currentAliases()
    const i = list.findIndex((a) => a.id === entry.id)
    if (i >= 0) list[i] = entry
    else list.push(entry)
    await saveAliases(list)
    onDone()
  }

  return (
    <form className="alias-form" onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && onDone()}>
      <label>
        Command
        <input autoFocus value={command} placeholder="claude-work" spellCheck={false} onChange={(e) => setCommand(e.target.value)} />
      </label>
      <label>
        Name <span className="muted">(optional)</span>
        <input value={label} placeholder={command.trim() || 'Claude (work)'} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <label>
        Runs
        <select value={effectiveBase} onChange={(e) => setBase(e.target.value as AgentBase)}>
          {BASES.map((b) => (
            <option key={b.id} value={b.id}>{b.label}</option>
          ))}
        </select>
      </label>
      <p className="muted small">
        Shell aliases and functions from your shell config work.{' '}
        {effectiveBase === 'claude' && 'Orbit adds its MCP server and status hooks to the command.'}
      </p>
      <div className="alias-actions">
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <button type="submit" className="btn primary" disabled={!command.trim()}>{alias ? 'Save' : 'Add'}</button>
      </div>
    </form>
  )
}
