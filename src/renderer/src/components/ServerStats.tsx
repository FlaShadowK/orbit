import { useEffect, useState } from 'react'
import type { BeszelSnapshot, Server, StatMetric, StatRange, StatWidget, WidgetType } from '@shared/types'
import { useStore } from '@/store'
import { METRICS, TYPE_LABEL, defaultWidgets } from '@/lib/stats'
import { uid } from '@/lib/util'
import { StatTile } from './StatWidgets'
import { Icon } from './Icon'

const POLL_MS = 30_000

/** Live Beszel data for a server, refreshed every 30s while the window is visible. */
export function useBeszel(server: Server, range?: StatRange): { snap?: BeszelSnapshot; error?: string } {
  const [state, setState] = useState<{ snap?: BeszelSnapshot; error?: string }>({})
  const systemId = server.beszel?.systemId
  const r = range ?? server.beszel?.range ?? '1h'
  useEffect(() => {
    if (!systemId) return
    let alive = true
    const load = (): void => {
      if (document.hidden) return
      window.orbit.beszelSnapshot(server.id, r).then(
        (snap) => alive && setState({ snap }),
        (e) => alive && setState((s) => ({ snap: s.snap, error: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }))
      )
    }
    load()
    const t = setInterval(load, POLL_MS)
    document.addEventListener('visibilitychange', load)
    return () => {
      alive = false
      clearInterval(t)
      document.removeEventListener('visibilitychange', load)
    }
  }, [server.id, systemId, r, server.beszel?.url, server.beszel?.email])
  return state
}

const ago = (ms: number): string => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`
}

/** Stats tiles under a server in the sidebar. */
export function ServerStats({ server }: { server: Server }) {
  const { snap, error } = useBeszel(server)
  const set = useStore((s) => s.set)
  if (!server.beszel?.systemId) return null
  const widgets = server.beszel.widgets ?? defaultWidgets()
  const down = snap && snap.status !== 'up'

  return (
    <div className="server-stats">
      <div className="stats-head">
        <span className={`stats-led ${snap ? (down ? 'down' : 'up') : ''}`} />
        <span className="stats-meta">
          {error && !snap ? 'Beszel unavailable' : down ? `${snap!.status} · ${ago(snap!.updated)}` : snap ? `${server.beszel.range ?? '1h'} · ${ago(snap.updated)}` : 'Loading stats…'}
        </span>
        <button className="icon-btn stats-edit" title="Customize stats" onClick={() => set({ statsEditor: server.id })}>
          <Icon name="settings" size={12} />
        </button>
      </div>
      {error && !snap && <div className="stats-error" title={error}>{error}</div>}
      {snap && (
        <div className="stat-grid">
          {widgets
            .filter((w) => METRICS[w.metric].available?.(snap) !== false)
            .map((w) => (
              <StatTile key={w.id} widget={w} snap={snap} />
            ))}
        </div>
      )}
    </div>
  )
}

const RANGES: StatRange[] = ['1h', '12h', '24h', '7d']

/** Tile layout editor: drag to reorder, pick metric / display / width, live preview. */
export function StatsEditor() {
  const serverId = useStore((s) => s.statsEditor)
  const servers = useStore((s) => s.servers)
  const { set, notify } = useStore()
  const server = servers.find((s) => s.id === serverId)
  const [widgets, setWidgets] = useState<StatWidget[]>([])
  const [range, setRange] = useState<StatRange>('1h')
  const [selected, setSelected] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [applyAll, setApplyAll] = useState(false)
  const { snap } = useBeszel(server ?? ({ id: '', beszel: undefined } as unknown as Server), range)

  useEffect(() => {
    if (!server) return
    const w = server.beszel?.widgets ?? defaultWidgets()
    setWidgets(w)
    setRange(server.beszel?.range ?? '1h')
    setSelected(w[0]?.id ?? null)
    setApplyAll(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId])

  if (!server?.beszel) return null
  const close = (): void => set({ statsEditor: undefined })
  const sel = widgets.find((w) => w.id === selected)
  const patch = (id: string, p: Partial<StatWidget>): void => setWidgets((ws) => ws.map((w) => (w.id === id ? { ...w, ...p } : w)))
  const add = (metric: StatMetric): void => {
    const def = METRICS[metric]
    const w: StatWidget = { id: uid(), metric, type: def.types[0], span: def.types[0] === 'spark' || def.types[0] === 'list' ? 2 : 1 }
    setWidgets((ws) => [...ws, w])
    setSelected(w.id)
  }
  const remove = (id: string): void => {
    setWidgets((ws) => ws.filter((w) => w.id !== id))
    if (selected === id) setSelected(null)
  }
  const moveBefore = (dragged: string, target: string): void => {
    if (dragged === target) return
    setWidgets((ws) => {
      const from = ws.findIndex((w) => w.id === dragged)
      const to = ws.findIndex((w) => w.id === target)
      const next = [...ws]
      const [w] = next.splice(from, 1)
      next.splice(to, 0, w)
      return next
    })
  }

  const save = async (): Promise<void> => {
    const targets = applyAll ? servers.filter((s) => s.beszel?.systemId) : [server]
    for (const s of targets) await window.orbit.saveServer({ ...s, beszel: { ...s.beszel!, widgets, range } })
    set({ servers: await window.orbit.listServers(), statsEditor: undefined })
    notify(applyAll ? `Stats layout applied to ${targets.length} servers` : 'Stats layout saved')
  }

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal stats-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Customize stats · {server.name}</h2>
        <div className="stats-editor">
          <div className="stats-preview-col">
            <div className="editor-label">Layout <span className="muted">· drag tiles to reorder</span></div>
            <div className="stats-preview">
              {!snap && <div className="muted small">Waiting for data from Beszel…</div>}
              {snap && (
                <div className="stat-grid">
                  {widgets.map((w) => (
                    <div
                      key={w.id}
                      className={`edit-tile ${selected === w.id ? 'selected' : ''} ${dragId === w.id ? 'dragging' : ''}`}
                      style={{ gridColumn: `span ${w.span}` }}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move'
                        setDragId(w.id)
                      }}
                      onDragOver={(e) => {
                        e.preventDefault()
                        if (dragId) moveBefore(dragId, w.id)
                      }}
                      onDragEnd={() => setDragId(null)}
                      onClick={() => setSelected(w.id)}
                    >
                      <StatTile widget={w} snap={snap} />
                      <button className="edit-tile-x" title="Remove tile" onClick={(e) => { e.stopPropagation(); remove(w.id) }}>
                        <Icon name="x" size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="editor-label">Add a tile</div>
            <div className="metric-chips">
              {(Object.keys(METRICS) as StatMetric[]).map((m) => (
                <button
                  key={m}
                  className={`metric-chip ${snap && METRICS[m].available?.(snap) === false ? 'unavailable' : ''}`}
                  title={snap && METRICS[m].available?.(snap) === false ? `${server.name} doesn't report this yet; the tile stays hidden until it does` : undefined}
                  style={{ ['--metric' as string]: METRICS[m].color }}
                  onClick={() => add(m)}
                >
                  <Icon name="plus" size={10} /> {METRICS[m].label}
                </button>
              ))}
            </div>
          </div>

          <div className="stats-props">
            <div className="editor-label">Time range for graphs</div>
            <Segmented value={range} options={RANGES.map((r) => [r, r])} onChange={setRange} />

            {sel ? (
              <>
                <div className="editor-label">Metric</div>
                <select
                  value={sel.metric}
                  onChange={(e) => {
                    const metric = e.target.value as StatMetric
                    const types = METRICS[metric].types
                    patch(sel.id, { metric, type: types.includes(sel.type) ? sel.type : types[0] })
                  }}
                >
                  {(Object.keys(METRICS) as StatMetric[]).map((m) => (
                    <option key={m} value={m}>{METRICS[m].label}</option>
                  ))}
                </select>
                <div className="editor-label">Show as</div>
                <Segmented<WidgetType> value={sel.type} options={METRICS[sel.metric].types.map((t) => [t, TYPE_LABEL[t]])} onChange={(type) => patch(sel.id, { type })} />
                <div className="editor-label">Width</div>
                <Segmented<'1' | '2'> value={String(sel.span) as '1' | '2'} options={[['1', 'Half'], ['2', 'Full']]} onChange={(v) => patch(sel.id, { span: Number(v) as 1 | 2 })} />
                <button className="btn danger remove-tile" onClick={() => remove(sel.id)}>
                  <Icon name="trash" size={12} /> Remove tile
                </button>
              </>
            ) : (
              <p className="muted small">Select a tile to change what it shows.</p>
            )}
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={() => { setWidgets(defaultWidgets()); setSelected(null) }}>Reset to default</button>
          <label className="check-row">
            <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} /> Apply to all monitored servers
          </label>
          <span className="grow" />
          <button className="btn" onClick={close}>Cancel</button>
          <button className="btn primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map(([v, label]) => (
        <button key={v} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  )
}
