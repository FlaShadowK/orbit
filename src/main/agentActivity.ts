import type { AgentActivity } from '@shared/types'

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-Z\\-_]|[\x00-\x08\x0b-\x1f\x7f]/g

export function stripAnsi(s: string): string {
  return s.replace(ANSI, '')
}

/** "Thinking harder", "ultrathink", "thinking deeply"… → the agent is in extended thinking. */
const DEEP = /\b(ultrathink|think(?:ing)?\s+(?:harder|more|longer|deeply|hard))\b/i
/** Claude Code's status line: "✻ Pondering… (12s · ↓ 1.2k tokens · esc to interrupt)" */
const SPINNER_LINE = /esc to interrupt|^[\s✻✶✳✢✽·*•◐◓◑◒⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]+\s*\S*…/m

export type ChunkKind = 'deep' | 'content' | 'spinner' | 'noise'

/** What a piece of agent terminal output tells us about what the agent is doing. */
export function classifyChunk(raw: string): ChunkKind {
  const text = stripAnsi(raw)
  if (DEEP.test(text)) return 'deep'
  const visible = text.replace(/\s+/g, '')
  if (!visible) return 'noise'
  // the spinner redraws constantly while the model thinks; that's not real output
  if (SPINNER_LINE.test(text) && visible.length < 160) return 'spinner'
  return 'content'
}

const STREAM_HOLD_MS = 900
const DEEP_HOLD_MS = 5000

/** Turns a stream of output chunks into "streaming" / "thinking" / "deep" for a working agent. */
export class ActivityTracker {
  private contentAt = -Infinity
  private deepAt = -Infinity

  feed(raw: string, now = Date.now()): void {
    const kind = classifyChunk(raw)
    if (kind === 'deep') this.deepAt = now
    else if (kind === 'content') this.contentAt = now
  }

  current(now = Date.now()): AgentActivity {
    if (now - this.deepAt < DEEP_HOLD_MS) return 'deep'
    if (now - this.contentAt < STREAM_HOLD_MS) return 'streaming'
    return 'thinking'
  }
}
