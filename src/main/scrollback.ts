/**
 * The last `limit` characters of a terminal's output, kept so a reloaded renderer (or a tab
 * docking back from its own window) can replay it.
 *
 * Appending to one big string and slicing it back to size copies the whole buffer on every
 * chunk once it's full (256 KB × thousands of chunks/s with many agents). Instead chunks are
 * kept as-is and whole chunks dropped from the front; the string is only joined on replay.
 */
export class Scrollback {
  private chunks: string[] = []
  private head = 0
  /** characters currently held (between `limit` and `limit` + one chunk) */
  size = 0

  constructor(private readonly limit: number) {}

  push(data: string): void {
    this.chunks.push(data)
    this.size += data.length
    while (this.size - this.chunks[this.head].length >= this.limit) this.size -= this.chunks[this.head++].length
    // compact the dropped prefix now and then instead of shifting on every drop
    if (this.head > 1024 && this.head * 2 > this.chunks.length) {
      this.chunks = this.chunks.slice(this.head)
      this.head = 0
    }
  }

  toString(): string {
    const all = (this.head ? this.chunks.slice(this.head) : this.chunks).join('')
    this.chunks = [all]
    this.head = 0
    return all.length > this.limit ? all.slice(-this.limit) : all
  }
}
