import { describe, expect, it } from 'vitest'
import { computeRects, dropSideAt, leaf, placeTab, prune, removeTab, replaceTab, setRatio, tabsIn, type LayoutNode } from './layout'

const shape = (n: LayoutNode | undefined): unknown =>
  !n ? null : n.type === 'leaf' ? n.tabId : { [n.dir]: [shape(n.a), shape(n.b)] }

describe('layout tree', () => {
  it('splits a pane on every side', () => {
    const base = leaf('A')
    expect(shape(placeTab(base, 'B', 'A', 'right'))).toEqual({ row: ['A', 'B'] })
    expect(shape(placeTab(base, 'B', 'A', 'left'))).toEqual({ row: ['B', 'A'] })
    expect(shape(placeTab(base, 'B', 'A', 'bottom'))).toEqual({ column: ['A', 'B'] })
    expect(shape(placeTab(base, 'B', 'A', 'top'))).toEqual({ column: ['B', 'A'] })
    expect(shape(placeTab(base, 'B', 'A', 'center'))).toEqual('B')
  })

  it('nests splits inside the targeted pane only', () => {
    let l = placeTab(leaf('A'), 'B', 'A', 'right')
    l = placeTab(l, 'C', 'B', 'bottom')
    expect(shape(l)).toEqual({ row: ['A', { column: ['B', 'C'] }] })
  })

  it('moves a visible tab instead of duplicating it', () => {
    let l = placeTab(leaf('A'), 'B', 'A', 'right')
    l = placeTab(l, 'C', 'B', 'bottom')
    l = placeTab(l, 'C', 'A', 'left')
    expect(shape(l)).toEqual({ row: [{ row: ['C', 'A'] }, 'B'] })
    expect(tabsIn(l).sort()).toEqual(['A', 'B', 'C'])
  })

  it('collapses the parent when a pane is removed', () => {
    const l = placeTab(placeTab(leaf('A'), 'B', 'A', 'right'), 'C', 'B', 'bottom')
    expect(shape(removeTab(l, 'B'))).toEqual({ row: ['A', 'C'] })
    expect(removeTab(leaf('A'), 'A')).toBeUndefined()
  })

  it('replaces and prunes tabs', () => {
    const l = placeTab(leaf('A'), 'B', 'A', 'right')
    expect(shape(replaceTab(l, 'B', 'Z'))).toEqual({ row: ['A', 'Z'] })
    expect(shape(prune(l, new Set(['A'])))).toEqual('A')
  })

  it('computes pane rectangles and clamps ratios', () => {
    const l = placeTab(leaf('A'), 'B', 'A', 'right')
    const resized = setRatio(l, (l as { id: string }).id, 0.99)
    const { panes, splitters } = computeRects(resized)
    expect(panes.map((p) => [p.tabId, +p.rect.w.toFixed(2)])).toEqual([['A', 0.9], ['B', 0.1]])
    expect(splitters[0].at).toBeCloseTo(0.9)
  })

  it('maps pointer positions to drop zones', () => {
    expect(dropSideAt(0.05, 0.5)).toBe('left')
    expect(dropSideAt(0.95, 0.5)).toBe('right')
    expect(dropSideAt(0.5, 0.1)).toBe('top')
    expect(dropSideAt(0.5, 0.9)).toBe('bottom')
    expect(dropSideAt(0.5, 0.5)).toBe('center')
  })
})
