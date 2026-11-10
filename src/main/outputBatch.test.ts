import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OutputBatcher } from './outputBatch'

describe('OutputBatcher', () => {
  let sent: [string, string][][]
  let b: OutputBatcher
  beforeEach(() => {
    vi.useFakeTimers()
    sent = []
    b = new OutputBatcher((batch) => sent.push(batch), { delayMs: 5, maxBytes: 100 })
  })
  afterEach(() => vi.useRealTimers())

  it('coalesces chunks from many sessions into one message', () => {
    b.push('a', 'x')
    b.push('b', 'y')
    b.push('a', 'z')
    expect(sent).toEqual([])
    vi.advanceTimersByTime(5)
    expect(sent).toEqual([[['a', 'xz'], ['b', 'y']]])
  })

  it('delivers echo right away while the user is typing', () => {
    b.noteInput('a')
    b.push('a', 'k')
    vi.advanceTimersByTime(0)
    expect(sent).toEqual([[['a', 'k']]])
  })

  it('does not make typed echo wait behind a pending slow flush', () => {
    b.push('agent', 'spinner')
    b.noteInput('probe')
    b.push('probe', 'k')
    vi.advanceTimersByTime(1)
    expect(sent).toEqual([[['agent', 'spinner'], ['probe', 'k']]])
  })

  it('keeps coalescing other terminals while one is being typed into', () => {
    b.noteInput('probe')
    b.push('agent', 'x')
    vi.advanceTimersByTime(1)
    expect(sent).toEqual([])
    vi.advanceTimersByTime(5)
    expect(sent).toEqual([[['agent', 'x']]])
  })

  it('goes back to coalescing once typing stops', () => {
    b.noteInput('a')
    vi.advanceTimersByTime(500)
    b.push('a', 'x')
    vi.advanceTimersByTime(1)
    expect(sent).toEqual([])
    vi.advanceTimersByTime(5)
    expect(sent.length).toBe(1)
  })

  it('flushes early when a batch gets big', () => {
    b.push('a', 'x'.repeat(60))
    b.push('b', 'y'.repeat(60))
    expect(sent.length).toBe(1)
  })

  it('discard() drops one session\'s pending output (it is in the replay already)', () => {
    b.push('a', 'dup')
    b.push('b', 'keep')
    b.discard('a')
    vi.advanceTimersByTime(5)
    expect(sent).toEqual([[['b', 'keep']]])
  })

  it('flush() sends pending output synchronously (before an exit event)', () => {
    b.push('a', 'bye')
    b.flush()
    expect(sent).toEqual([[['a', 'bye']]])
    vi.advanceTimersByTime(10)
    expect(sent.length).toBe(1)
  })
})
