/**
 * Pane layout of a space: a binary split tree whose leaves show one tab each.
 * Tabs that are not in the tree stay in the tab bar but are hidden.
 * All functions are pure and return new trees.
 */
export type SplitDir = 'row' | 'column'
export type DropSide = 'left' | 'right' | 'top' | 'bottom' | 'center'

export type LayoutNode =
  | { type: 'leaf'; id: string; tabId: string }
  | { type: 'split'; id: string; dir: SplitDir; ratio: number; a: LayoutNode; b: LayoutNode }

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

let seq = 0
const nid = (): string => `n${Date.now().toString(36)}${(seq++).toString(36)}`

export const leaf = (tabId: string): LayoutNode => ({ type: 'leaf', id: nid(), tabId })

export function tabsIn(node: LayoutNode | undefined): string[] {
  if (!node) return []
  return node.type === 'leaf' ? [node.tabId] : [...tabsIn(node.a), ...tabsIn(node.b)]
}

export function hasTab(node: LayoutNode | undefined, tabId: string): boolean {
  return tabsIn(node).includes(tabId)
}

export function leafCount(node: LayoutNode | undefined): number {
  return tabsIn(node).length
}

/** Remove the pane showing `tabId`; its sibling takes the parent's place. */
export function removeTab(node: LayoutNode | undefined, tabId: string): LayoutNode | undefined {
  if (!node) return undefined
  if (node.type === 'leaf') return node.tabId === tabId ? undefined : node
  const a = removeTab(node.a, tabId)
  const b = removeTab(node.b, tabId)
  if (!a) return b
  if (!b) return a
  return a === node.a && b === node.b ? node : { ...node, a, b }
}

/** Show `next` in the pane that currently shows `prev`. */
export function replaceTab(node: LayoutNode | undefined, prev: string, next: string): LayoutNode | undefined {
  if (!node) return undefined
  if (node.type === 'leaf') return node.tabId === prev ? { ...node, tabId: next } : node
  const a = replaceTab(node.a, prev, next)!
  const b = replaceTab(node.b, prev, next)!
  return a === node.a && b === node.b ? node : { ...node, a, b }
}

/**
 * Put `tabId` next to (or into) the pane showing `targetTabId`.
 * The tab is first removed from wherever it is shown, so dragging a visible tab moves it.
 */
export function placeTab(node: LayoutNode | undefined, tabId: string, targetTabId: string | undefined, side: DropSide): LayoutNode {
  if (tabId === targetTabId) return node ?? leaf(tabId)
  const base = removeTab(node, tabId)
  if (!base || !targetTabId || !hasTab(base, targetTabId)) {
    if (!base) return leaf(tabId)
    if (side === 'center') return base
    return wrap(base, leaf(tabId), side)
  }
  const visit = (n: LayoutNode): LayoutNode => {
    if (n.type === 'leaf') {
      if (n.tabId !== targetTabId) return n
      return side === 'center' ? { ...n, tabId } : wrap(n, leaf(tabId), side)
    }
    const a = visit(n.a)
    const b = visit(n.b)
    return a === n.a && b === n.b ? n : { ...n, a, b }
  }
  return visit(base)
}

function wrap(existing: LayoutNode, added: LayoutNode, side: Exclude<DropSide, 'center'>): LayoutNode {
  const dir: SplitDir = side === 'left' || side === 'right' ? 'row' : 'column'
  const first = side === 'left' || side === 'top'
  return { type: 'split', id: nid(), dir, ratio: 0.5, a: first ? added : existing, b: first ? existing : added }
}

export function setRatio(node: LayoutNode, splitId: string, ratio: number): LayoutNode {
  const r = Math.min(0.9, Math.max(0.1, ratio))
  if (node.type === 'leaf') return node
  if (node.id === splitId) return { ...node, ratio: r }
  const a = setRatio(node.a, splitId, ratio)
  const b = setRatio(node.b, splitId, ratio)
  return a === node.a && b === node.b ? node : { ...node, a, b }
}

/** Drop the panes whose tab no longer exists. */
export function prune(node: LayoutNode | undefined, tabIds: Set<string>): LayoutNode | undefined {
  let n = node
  for (const t of tabsIn(node)) if (!tabIds.has(t)) n = removeTab(n, t)
  return n
}

export interface PaneRect {
  tabId: string
  leafId: string
  rect: Rect
}
export interface SplitterRect {
  splitId: string
  dir: SplitDir
  /** the area the split divides (to turn a pointer position into a ratio) */
  area: Rect
  /** position of the divider: x for rows, y for columns */
  at: number
}

/** Rectangles (fractions of the workspace, 0..1) for every pane and divider. */
export function computeRects(node: LayoutNode | undefined, area: Rect = { x: 0, y: 0, w: 1, h: 1 }) {
  const panes: PaneRect[] = []
  const splitters: SplitterRect[] = []
  const walk = (n: LayoutNode, r: Rect): void => {
    if (n.type === 'leaf') {
      panes.push({ tabId: n.tabId, leafId: n.id, rect: r })
      return
    }
    if (n.dir === 'row') {
      const wa = r.w * n.ratio
      walk(n.a, { x: r.x, y: r.y, w: wa, h: r.h })
      walk(n.b, { x: r.x + wa, y: r.y, w: r.w - wa, h: r.h })
      splitters.push({ splitId: n.id, dir: 'row', area: r, at: r.x + wa })
    } else {
      const ha = r.h * n.ratio
      walk(n.a, { x: r.x, y: r.y, w: r.w, h: ha })
      walk(n.b, { x: r.x, y: r.y + ha, w: r.w, h: r.h - ha })
      splitters.push({ splitId: n.id, dir: 'column', area: r, at: r.y + ha })
    }
  }
  if (node) walk(node, area)
  return { panes, splitters }
}

/** Which drop zone a pointer at (px, py) — fractions within a pane — falls into. */
export function dropSideAt(px: number, py: number, edge = 0.28): DropSide {
  const d = { left: px, right: 1 - px, top: py, bottom: 1 - py }
  const [side, dist] = (Object.entries(d) as [Exclude<DropSide, 'center'>, number][]).sort((a, b) => a[1] - b[1])[0]
  return dist < edge ? side : 'center'
}

/** The part of a pane that a drop on `side` will occupy (for the hover preview). */
export function previewRect(r: Rect, side: DropSide): Rect {
  switch (side) {
    case 'left': return { ...r, w: r.w / 2 }
    case 'right': return { ...r, x: r.x + r.w / 2, w: r.w / 2 }
    case 'top': return { ...r, h: r.h / 2 }
    case 'bottom': return { ...r, y: r.y + r.h / 2, h: r.h / 2 }
    default: return r
  }
}
