import { useId, useMemo, useRef, useState } from 'react'
import type { BeszelSnapshot, StatWidget } from '@shared/types'
import { METRICS, levelColor } from '@/lib/stats'

/** One stats tile: renders a metric of a Beszel snapshot in the widget's chosen form. */
export function StatTile({ widget, snap }: { widget: StatWidget; snap: BeszelSnapshot }) {
  const def = METRICS[widget.metric]
  // a metric can lose a type when the layout was made for another server; fall back gracefully
  const type = def.types.includes(widget.type) ? widget.type : def.types[0]
  return (
    <div className={`stat-tile t-${type}`} style={{ gridColumn: `span ${widget.span}`, ['--metric' as string]: def.color }}>
      {type === 'spark' && <SparkTile widget={widget} snap={snap} />}
      {type === 'gauge' && <GaugeTile widget={widget} snap={snap} />}
      {type === 'bar' && <BarTile widget={widget} snap={snap} />}
      {type === 'value' && <ValueTile widget={widget} snap={snap} />}
      {type === 'list' && <ListTile snap={snap} />}
    </div>
  )
}

function ValueTile({ widget, snap }: { widget: StatWidget; snap: BeszelSnapshot }) {
  const def = METRICS[widget.metric]
  const pct = def.percent?.(snap)
  return (
    <>
      <div className="tile-label">{def.short}</div>
      <div className="tile-value" style={pct != null ? { color: levelColor(pct, 'var(--fg)') } : undefined}>{def.value(snap)}</div>
      {def.detail && <div className="tile-detail">{def.detail(snap)}</div>}
    </>
  )
}

function BarTile({ widget, snap }: { widget: StatWidget; snap: BeszelSnapshot }) {
  const def = METRICS[widget.metric]
  const pct = Math.max(0, Math.min(100, def.percent?.(snap) ?? 0))
  return (
    <>
      <div className="tile-row">
        <span className="tile-label">{def.short}</span>
        <span className="tile-value small">{def.value(snap)}</span>
      </div>
      <div className="tile-meter">
        <i style={{ width: `${pct}%`, background: levelColor(pct, def.color) }} />
      </div>
      {def.detail && widget.span === 2 && <div className="tile-detail">{def.detail(snap)}</div>}
    </>
  )
}

function GaugeTile({ widget, snap }: { widget: StatWidget; snap: BeszelSnapshot }) {
  const def = METRICS[widget.metric]
  const pct = Math.max(0, Math.min(100, def.percent?.(snap) ?? 0))
  // 270° arc, open at the bottom
  const r = 22
  const len = 2 * Math.PI * r * 0.75
  const color = levelColor(pct, def.color)
  return (
    <div className="gauge-wrap">
      <svg viewBox="0 0 56 56" className="gauge">
        <circle cx="28" cy="28" r={r} className="gauge-track" strokeDasharray={`${len} 999`} transform="rotate(135 28 28)" />
        <circle
          cx="28" cy="28" r={r} className="gauge-fill" stroke={color}
          strokeDasharray={`${(len * pct) / 100} 999`} transform="rotate(135 28 28)"
          style={{ filter: `drop-shadow(0 0 3px ${color}66)` }}
        />
        <text x="28" y="30" className="gauge-text">{def.value(snap)}</text>
        <text x="28" y="44" className="gauge-sub">{def.short}</text>
      </svg>
      {widget.span === 2 && def.detail && <div className="tile-detail gauge-side">{def.detail(snap)}</div>}
    </div>
  )
}

function SparkTile({ widget, snap }: { widget: StatWidget; snap: BeszelSnapshot }) {
  const def = METRICS[widget.metric]
  const gid = useId().replace(/:/g, '')
  const box = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const W = 200
  const H = 26
  const pts = useMemo(() => snap.series.map((p) => ({ t: p.t, v: def.point?.(p) })).filter((p): p is { t: number; v: number } => p.v != null), [snap.series, def])
  const max = useMemo(() => {
    const m = Math.max(...pts.map((p) => p.v), 0)
    return def.percent ? Math.max(m * 1.15, 5) : m * 1.15 || 1
  }, [pts, def])
  const xy = (i: number, v: number): [number, number] => [(i / Math.max(pts.length - 1, 1)) * W, H - 2 - (v / max) * (H - 4)]
  const line = pts.map((p, i) => xy(i, p.v).map((n) => n.toFixed(1)).join(',')).join(' ')
  const h = hover != null ? pts[hover] : undefined

  return (
    <>
      <div className="tile-row">
        <span className="tile-label">{def.short}</span>
        <span className="tile-value small">{h ? def.formatPoint?.(h.v) : def.value(snap)}</span>
      </div>
      <svg
        ref={box}
        className="spark"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onMouseMove={(e) => {
          const r = box.current!.getBoundingClientRect()
          setHover(Math.round(((e.clientX - r.left) / r.width) * (pts.length - 1)))
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={def.color} stopOpacity="0.35" />
            <stop offset="1" stopColor={def.color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {pts.length > 1 && (
          <>
            <polygon points={`0,${H} ${line} ${W},${H}`} fill={`url(#${gid})`} />
            <polyline points={line} fill="none" stroke={def.color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </>
        )}
        {h && <line x1={xy(hover!, h.v)[0]} x2={xy(hover!, h.v)[0]} y1="0" y2={H} className="spark-cursor" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="tile-detail">{h ? new Date(h.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : def.detail?.(snap)}</div>
    </>
  )
}

function ListTile({ snap }: { snap: BeszelSnapshot }) {
  const top = snap.containers.slice(0, 4)
  const max = Math.max(...top.map((c) => c.mem), 1)
  return (
    <>
      <div className="tile-row">
        <span className="tile-label">Containers</span>
        <span className="tile-value small">{snap.containers.length}</span>
      </div>
      <div className="tile-list">
        {top.map((c) => (
          <div key={c.name} className="tile-list-row" title={`${c.name}: ${c.mem.toFixed(0)} MB, ${c.cpu.toFixed(2)}% CPU`}>
            <span className="tile-list-name">{c.name}</span>
            <span className="tile-list-bar"><i style={{ width: `${(c.mem / max) * 100}%` }} /></span>
            <span className="tile-list-val">{c.mem >= 1024 ? `${(c.mem / 1024).toFixed(1)}G` : `${c.mem.toFixed(0)}M`}</span>
          </div>
        ))}
        {!top.length && <div className="tile-detail">No containers</div>}
      </div>
    </>
  )
}
