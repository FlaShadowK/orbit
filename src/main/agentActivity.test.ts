import { describe, expect, it } from 'vitest'
import { ActivityTracker, StatusGuesser, classifyChunk } from './agentActivity'

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

describe('StatusGuesser', () => {
  it('follows the busy line, permission prompts and the end of a turn', () => {
    const g = new StatusGuesser()
    expect(g.current(0)).toBeNull()
    g.feed('\x1b[2K✻ Pondering… (3s · esc to interrupt)', 100)
    expect(g.current(200)).toBe('working')
    g.feed('Do you want to make this edit to app.ts?\n❯ 1. Yes', 1000)
    expect(g.current(1100)).toBe('waiting')
    g.feed('✻ Writing… (9s · esc to interrupt)', 5000)
    expect(g.current(5100)).toBe('working')
    g.feed('Done, all tests pass.', 5200)
    expect(g.current(9000)).toBe('done')
  })

  it('stays working while a redrawn timer keeps ticking without the marker', () => {
    const g = new StatusGuesser()
    g.feed('Working (0s • esc to interrupt)', 0)
    expect(g.current(100)).toBe('working')
    for (let t = 1000; t <= 6000; t += 1000) {
      g.feed(`${t / 1000}s`, t)
      expect(g.current(t + 100)).toBe('working')
    }
    expect(g.current(9000)).toBe('done')
  })
})
