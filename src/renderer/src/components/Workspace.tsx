import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Space, Tab } from '@shared/types'
import { computeRects, dropSideAt, previewRect, type DropSide, type PaneRect, type Rect, type SplitterRect } from '@shared/layout'
import { useStore } from '@/store'
import { TerminalView } from './TerminalView'
import { EditorView } from './EditorView'
import { SftpView } from './SftpView'
import { ChangesView } from './ChangesView'

export const isSession = (t: Tab): boolean => t.kind === 'agent' || t.kind === 'terminal' || t.kind === 'ssh'

/** MIME type used for tab drags, so panes can tell them apart from file drops */
export const TAB_MIME = 'application/x-orbit-tab'

const EPS = 1e-6
const pct = (v: number): string => `${(v * 100).toFixed(4)}%`

/** Absolute position for a rect given in workspace fractions, leaving a 1px gap on inner edges. */
function rectStyle(r: Rect): CSSProperties {
  const left = r.x > EPS
  const top = r.y > EPS
  return {
    left: left ? `calc(${pct(r.x)} + 1px)` : 0,
    top: top ? `calc(${pct(r.y)} + 1px)` : 0,
    width: left ? `calc(${pct(r.w)} - 1px)` : pct(r.w),
    height: top ? `calc(${pct(r.h)} - 1px)` : pct(r.h)
  }
}

export function PaneContent({ tab, space, visible, focused }: { tab: Tab; space: Space; visible: boolean; focused: boolean }): ReactNode {
  return (
    <>
      {isSession(tab) && <TerminalView tab={tab} space={space} visible={visible} focused={focused} />}
      {tab.kind === 'editor' && <EditorView tab={tab} focused={focused} />}
      {tab.kind === 'sftp' && <SftpView tab={tab} />}
      {tab.kind === 'changes' && <ChangesView space={space} focused={focused} />}
    </>
  )
}

/**
 * The panes of one space. Every pane is an absolutely positioned sibling, so moving a tab
 * between panes or changing the split tree never remounts its terminal or editor.
 */
export function Workspace({ space, active, empty }: { space: Space; active: boolean; empty: ReactNode }) {
  const detached = useStore((s) => s.detached)
  const dragging = useStore((s) => s.draggingTabId)
  const ref = useRef<HTMLDivElement>(null)
  const { panes, splitters } = useMemo(() => computeRects(space.layout), [space.layout])
  const rects = useMemo(() => new Map(panes.map((p) => [p.tabId, p.rect])), [panes])
  const multi = panes.length > 1
  const draggingHere = active && !!dragging && space.tabs.some((t) => t.id === dragging)

  return (
    <div className={`panes ${multi ? 'multi' : ''}`} ref={ref} style={{ display: active ? 'block' : 'none' }}>
      {space.tabs.length === 0 && empty}
      {space.tabs.map((t) => {
        if (detached[t.id]) return null
        const rect = rects.get(t.id)
        const visible = active && !!rect
        // terminals stay mounted while hidden so their sessions keep streaming
        if (!visible && !isSession(t)) return null
        const focused = active && space.activeTabId === t.id
        return (
          <div
            key={t.id}
            className={`pane ${focused ? 'focused' : ''}`}
            style={rect ? rectStyle(rect) : { display: 'none' }}
            onMouseDown={() => {
              if (!focused) useStore.getState().setActiveTab(t.id)
            }}
          >
            <PaneContent tab={t} space={space} visible={visible} focused={focused} />
          </div>
        )
      })}
      {active && splitters.map((s) => <Splitter key={s.splitId} spaceId={space.id} splitter={s} container={ref} />)}
      {draggingHere && <DropOverlay space={space} panes={panes} tabId={dragging!} />}
    </div>
  )
}

function Splitter({ spaceId, splitter, container }: { spaceId: string; splitter: SplitterRect; container: React.RefObject<HTMLDivElement | null> }) {
  const { dir, area, at } = splitter
  const style: CSSProperties =
    dir === 'row'
      ? { left: `calc(${pct(at)} - 3px)`, top: pct(area.y), width: 7, height: pct(area.h) }
      : { top: `calc(${pct(at)} - 3px)`, left: pct(area.x), height: 7, width: pct(area.w) }
  return (
    <div
      className={`splitter splitter-${dir}`}
      style={style}
      onPointerDown={(e) => {
        const box = container.current?.getBoundingClientRect()
        if (!box) return
        e.preventDefault()
        const el = e.currentTarget
        el.setPointerCapture(e.pointerId)
        el.classList.add('dragging')
        const move = (ev: PointerEvent): void => {
          const frac = dir === 'row' ? (ev.clientX - box.left) / box.width : (ev.clientY - box.top) / box.height
          const ratio = dir === 'row' ? (frac - area.x) / area.w : (frac - area.y) / area.h
          useStore.getState().resizeSplit(spaceId, splitter.splitId, ratio)
        }
        const up = (): void => {
          el.classList.remove('dragging')
          el.removeEventListener('pointermove', move)
          el.removeEventListener('pointerup', up)
          el.removeEventListener('pointercancel', up)
        }
        el.addEventListener('pointermove', move)
        el.addEventListener('pointerup', up)
        el.addEventListener('pointercancel', up)
      }}
    />
  )
}

const SIDE_LABEL: Record<DropSide, string> = {
  left: 'Split left',
  right: 'Split right',
  top: 'Split up',
  bottom: 'Split down',
  center: 'Open here'
}

/** Shown while a tab is dragged: highlights where it will land if released. */
function DropOverlay({ space, panes, tabId }: { space: Space; panes: PaneRect[]; tabId: string }) {
  const [hover, setHover] = useState<{ target?: string; side: DropSide; rect: Rect } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const locate = (e: React.DragEvent): typeof hover => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return null
    const fx = (e.clientX - box.left) / box.width
    const fy = (e.clientY - box.top) / box.height
    if (panes.length === 0) return { side: 'center', rect: { x: 0, y: 0, w: 1, h: 1 } }
    const pane = panes.find((p) => fx >= p.rect.x && fx <= p.rect.x + p.rect.w && fy >= p.rect.y && fy <= p.rect.y + p.rect.h)
    if (!pane) return null
    const side = dropSideAt((fx - pane.rect.x) / pane.rect.w, (fy - pane.rect.y) / pane.rect.h)
    // dropping a tab onto its own lone pane, or into its own pane's centre, changes nothing
    if (pane.tabId === tabId && (side === 'center' || panes.length === 1)) return null
    return { target: pane.tabId, side, rect: previewRect(pane.rect, side) }
  }

  return (
    <div
      ref={ref}
      className="drop-overlay"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(TAB_MIME)) return
        const h = locate(e)
        if (h) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }
        setHover((prev) => (prev?.target === h?.target && prev?.side === h?.side ? prev : h))
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setHover(null)
      }}
      onDrop={(e) => {
        e.preventDefault()
        const h = locate(e)
        setHover(null)
        useStore.getState().set({ draggingTabId: undefined })
        if (h) useStore.getState().placeTab(tabId, h.target, h.side)
      }}
    >
      {hover && (
        <div className={`drop-preview side-${hover.side}`} style={rectStyle(hover.rect)}>
          <span>{SIDE_LABEL[hover.side]}</span>
        </div>
      )}
    </div>
  )
}
