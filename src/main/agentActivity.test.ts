import { describe, expect, it } from 'vitest'
import { ActivityTracker, classifyChunk } from './agentActivity'

describe('classifyChunk', () => {
  it('treats the redrawing spinner line as thinking, not output', () => {
    expect(classifyChunk('\x1b[2K\x1b[1G\x1b[38;5;174m✻\x1b[39m Pondering… \x1b[2m(12s · ↓ 1.2k tokens · esc to interrupt)\x1b[22m')).toBe('spinner')
    expect(classifyChunk('\r✶ Brewing…')).toBe('spinner')
  })

  it('detects real output', () => {
    expect(classifyChunk('⏺ I updated src/main/index.ts to register the new handler.\r\n')).toBe('content')
    expect(classifyChunk('  12 +  const x = 1\r\n  13 -  const y = 2\r\n')).toBe('content')
  })

  it('detects extended thinking', () => {
    expect(classifyChunk('✻ Thinking harder… (esc to interrupt)')).toBe('deep')
    expect(classifyChunk('ultrathink')).toBe('deep')
  })

  it('ignores cursor movement and blank redraws', () => {
    expect(classifyChunk('\x1b[?25l\x1b[2K\r\n\x1b[?25h')).toBe('noise')
  })
})

describe('ActivityTracker', () => {
  it('streams while output flows, then falls back to thinking', () => {
    const t = new ActivityTracker()
    t.feed('Here is the plan:\r\n1. Add the route\r\n', 1000)
    expect(t.current(1200)).toBe('streaming')
    t.feed('✻ Pondering… (esc to interrupt)', 1500)
    expect(t.current(2500)).toBe('thinking')
  })

  it('stays in deep thinking for a while after the hint', () => {
    const t = new ActivityTracker()
    t.feed('✻ Thinking more… (esc to interrupt)', 0)
    t.feed('some output\r\n', 1000)
    expect(t.current(1100)).toBe('deep')
    expect(t.current(6000)).toBe('thinking')
  })
})
