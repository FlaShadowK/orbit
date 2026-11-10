export type OutputBatch = [id: string, data: string][]

/**
 * Coalesces terminal output from every session into one IPC message every few ms.
 *
 * A busy agent emits ~10–100 small chunks a second; with dozens of agents, one IPC message per
 * chunk means thousands of messages a second, each with its own serialization and dispatch cost
 * on both sides. Batching cuts that to ~200/s regardless of agent count. Output right after the
 * user typed is sent immediately so keystroke echo never waits on the batch window.
 */
export class OutputBatcher {
  private pending = new Map<string, string>()
  private bytes = 0
  private timer: { cancel(): void } | null = null
  private timerFast = false
  /** session the user last typed into, and when */
  private inputId: string | null = null
  private inputAt = -Infinity
  private readonly delayMs: number
  private readonly maxBytes: number

  constructor(
    private readonly send: (batch: OutputBatch) => void,
    { delayMs = 5, maxBytes = 256 * 1024 }: { delayMs?: number; maxBytes?: number } = {}
  ) {
    this.delayMs = delayMs
    this.maxBytes = maxBytes
  }

  /** The user typed into terminal `id`: its echo should go out without delay for a moment. */
  noteInput(id: string): void {
    this.inputId = id
    this.inputAt = Date.now()
  }

  push(id: string, data: string): void {
    const prev = this.pending.get(id)
    this.pending.set(id, prev === undefined ? data : prev + data)
    this.bytes += data.length
    if (this.bytes >= this.maxBytes) return this.flush()
    // only the terminal being typed into skips the batch window; the rest keep coalescing
    const fast = id === this.inputId && Date.now() - this.inputAt < 150
    if (this.timer && (this.timerFast || !fast)) return
    this.timer?.cancel()
    this.timerFast = fast
    // echo: next turn of the event loop (setTimeout(0) costs ~1ms in Node)
    if (fast) {
      const h = setImmediate(() => this.flush())
      this.timer = { cancel: () => clearImmediate(h) }
    } else {
      const h = setTimeout(() => this.flush(), this.delayMs)
      this.timer = { cancel: () => clearTimeout(h) }
    }
  }

  /** Drop pending output of one session (a renderer is about to get it via scrollback replay). */
  discard(id: string): void {
    const data = this.pending.get(id)
    if (data === undefined) return
    this.pending.delete(id)
    this.bytes -= data.length
  }

  flush(): void {
    this.timer?.cancel()
    this.timer = null
    if (!this.pending.size) return
    const batch: OutputBatch = [...this.pending]
    this.pending.clear()
    this.bytes = 0
    this.send(batch)
  }
}
