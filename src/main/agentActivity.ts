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

/** "esc to interrupt" (Claude Code, Codex), "esc to cancel" (Gemini CLI): shown only while the agent works */
const BUSY = /esc (?:to )?(?:interrupt|cancel)/i
/** permission / confirmation prompts */
const ASK = /Do you want to|Would you like to (?:run|make|proceed)|Allow (?:command|execution|this)|\[y\/n\]|\(y\/n\)/i
const BUSY_HOLD_MS = 1500

export type GuessedStatus = 'working' | 'waiting' | 'done'

/**
 * Agent status for agents Orbit can't hook into (started by typing a command, or CLIs
 * without hooks), read from what they print: their "esc to interrupt" line means working,
 * a permission prompt means waiting, and the line going away means the turn finished.
 */
export class StatusGuesser {
  private busyAt = -Infinity
  private askAt = -Infinity
  private outputAt = -Infinity
  private working = false

  feed(raw: string, now = Date.now()): void {
    const text = stripAnsi(raw)
    if (!text.trim()) return
    this.outputAt = now
    if (BUSY.test(text)) this.busyAt = now
    if (ASK.test(text)) this.askAt = now
  }

  /** null until the agent has shown any sign of working */
  current(now = Date.now()): GuessedStatus | null {
    const asked = this.askAt >= this.busyAt && this.askAt > -Infinity
    // TUIs that redraw only changed cells won't resend the marker, but keep ticking a timer
    const busy = now - this.busyAt < BUSY_HOLD_MS || (this.working && !asked && now - this.outputAt < BUSY_HOLD_MS)
    if (busy && !asked) {
      this.working = true
      return 'working'
    }
    this.working = false
    if (this.busyAt === -Infinity) return asked ? 'waiting' : null
    return asked ? 'waiting' : 'done'
  }
}
