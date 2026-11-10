import { describe, expect, it } from 'vitest'
import { GlBudget, type GlHolder } from './glBudget'

const holder = (visible: boolean, lastShown: number): GlHolder & { released: boolean } => {
  const h = { visible, lastShown, released: false, release: () => (h.released = true) }
  return h
}

describe('GlBudget', () => {
  it('hands out slots while under the limit', () => {
    const b = new GlBudget(2)
    expect(b.acquire(holder(true, 1))).toBe(true)
    expect(b.acquire(holder(true, 2))).toBe(true)
    expect(b.size).toBe(2)
  })

  it('evicts the least recently shown hidden terminal when full', () => {
    const b = new GlBudget(2)
    const old = holder(false, 1)
    const recent = holder(false, 5)
    b.acquire(old)
    b.acquire(recent)
    expect(b.acquire(holder(true, 9))).toBe(true)
    expect(old.released).toBe(true)
    expect(recent.released).toBe(false)
  })

  it('never evicts a visible terminal', () => {
    const b = new GlBudget(2)
    const a = holder(true, 1)
    const c = holder(true, 2)
    b.acquire(a)
    b.acquire(c)
    expect(b.acquire(holder(true, 3))).toBe(false)
    expect(a.released || c.released).toBe(false)
  })

  it('frees the slot on drop', () => {
    const b = new GlBudget(1)
    const a = holder(true, 1)
    b.acquire(a)
    b.drop(a)
    expect(b.acquire(holder(true, 2))).toBe(true)
  })
})
