import { useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

export type MenuItem =
  | { label: string; icon?: string; onClick: () => void; danger?: boolean; disabled?: boolean; hint?: string }
  | { header: string }
  | 'sep'

export interface MenuAt {
  x: number
  y: number
}

/** A right-click menu at the pointer, kept inside the window. */
export function ContextMenu({ at, items, onClose }: { at: MenuAt; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: at.x, top: at.y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      left: Math.max(4, Math.min(at.x, window.innerWidth - width - 6)),
      top: Math.max(4, at.y + height > window.innerHeight - 6 ? at.y - height : at.y)
    })
  }, [at.x, at.y])

  return (
    <>
      <div
        className="menu-backdrop no-drag"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div className="dropdown no-drag" ref={ref} style={{ ...pos, marginTop: 0 }} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        {items.map((it, i) => {
          if (it === 'sep') return <div key={i} className="dropdown-sep" />
          if ('header' in it) return <div key={i} className="dropdown-label">{it.header}</div>
          return (
            <button
              key={i}
              className={it.danger ? 'danger' : ''}
              disabled={it.disabled}
              onClick={() => {
                onClose()
                it.onClick()
              }}
            >
              {it.icon && <Icon name={it.icon} />} {it.label}
              {it.hint && <span className="muted menu-hint">{it.hint}</span>}
            </button>
          )
        })}
      </div>
    </>
  )
}
