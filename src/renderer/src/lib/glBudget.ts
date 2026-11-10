/**
 * Chromium keeps at most ~16 live WebGL contexts per page and, past that, silently kills the
 * oldest one — which can be a terminal the user is looking at. Terminals therefore hold a
 * WebGL renderer only through this budget: taking a slot evicts hidden terminals first
 * (least recently shown), so visible ones are never the ones that lose their context.
 */
export interface GlHolder {
  /** shown in a pane right now */
  visible: boolean
  /** when it was last shown (for picking which hidden terminal gives its context back) */
  lastShown: number
  /** dispose the WebGL renderer (the terminal falls back to the DOM renderer) */
  release(): void
}

export class GlBudget {
  private holders = new Set<GlHolder>()

  constructor(private readonly max: number) {}

  get size(): number {
    return this.holders.size
  }

  /** Make room for `h` (evicting hidden holders) and register it. False if no room. */
  acquire(h: GlHolder): boolean {
    if (this.holders.has(h)) return true
    if (this.holders.size >= this.max) {
      const hidden = [...this.holders].filter((x) => !x.visible).sort((a, b) => a.lastShown - b.lastShown)
      for (const victim of hidden) {
        if (this.holders.size < this.max) break
        this.holders.delete(victim)
        victim.release()
      }
    }
    // every slot is taken by a visible terminal: this one stays on the DOM renderer
    if (this.holders.size >= this.max) return false
    this.holders.add(h)
    return true
  }

  drop(h: GlHolder): void {
    this.holders.delete(h)
  }
}

/** shared by every terminal in this window; leaves headroom below Chromium's limit */
export const glBudget = new GlBudget(12)
