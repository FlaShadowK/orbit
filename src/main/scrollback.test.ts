import { describe, expect, it } from 'vitest'
import { Scrollback } from './scrollback'

describe('Scrollback', () => {
  it('keeps everything while under the limit', () => {
    const b = new Scrollback(10)
    b.push('abc')
    b.push('def')
    expect(b.toString()).toBe('abcdef')
  })

  it('keeps exactly the last `limit` characters', () => {
    const b = new Scrollback(10)
    for (const s of ['0123', '4567', '89ab', 'cdef']) b.push(s)
    expect(b.toString()).toBe('6789abcdef')
    b.push('XYZ')
    expect(b.toString()).toBe('9abcdefXYZ')
  })

  it('handles a single chunk bigger than the limit', () => {
    const b = new Scrollback(4)
    b.push('abcdefgh')
    expect(b.toString()).toBe('efgh')
  })

  it('does not hold more than about one chunk past the limit in memory', () => {
    const b = new Scrollback(1000)
    for (let i = 0; i < 10_000; i++) b.push('x'.repeat(100))
    expect(b.size).toBeLessThan(1100)
    expect(b.toString().length).toBe(1000)
  })
})
