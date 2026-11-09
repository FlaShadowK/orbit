/**
 * App shortcuts. macOS uses ⌘ (free in terminals); Windows/Linux use Ctrl+Shift
 * so plain Ctrl+C/D/W/K etc. keep working inside terminals.
 */
export type Command =
  | 'newSpace' | 'newAgent' | 'newTerminal' | 'save' | 'closeTab'
  | 'palette' | 'toggleFiles' | 'toggleActivity' | 'splitRow' | 'splitColumn'

interface Binding {
  mac: string
  other: string
}

export const BINDINGS: Record<Command, Binding> = {
  newSpace: { mac: 'Cmd+Shift+N', other: 'Ctrl+Shift+N' },
  newAgent: { mac: 'Cmd+T', other: 'Ctrl+Shift+T' },
  newTerminal: { mac: 'Cmd+Shift+T', other: 'Ctrl+Shift+E' },
  save: { mac: 'Cmd+S', other: 'Ctrl+S' },
  closeTab: { mac: 'Cmd+W', other: 'Ctrl+Shift+W' },
  palette: { mac: 'Cmd+K', other: 'Ctrl+Shift+P' },
  toggleFiles: { mac: 'Cmd+B', other: 'Ctrl+Shift+B' },
  toggleActivity: { mac: 'Cmd+J', other: 'Ctrl+Shift+J' },
  splitRow: { mac: 'Cmd+D', other: 'Ctrl+Shift+D' },
  splitColumn: { mac: 'Cmd+Shift+D', other: 'Alt+Shift+D' }
}

export function accelerator(cmd: Command, isMac: boolean): string {
  return isMac ? BINDINGS[cmd].mac : BINDINGS[cmd].other
}

/** Human-readable label, e.g. "⌘⇧T" on macOS or "Ctrl+Shift+T" elsewhere. */
export function keyLabel(cmd: Command, isMac: boolean): string {
  const acc = accelerator(cmd, isMac)
  if (!isMac) return acc
  return acc
    .replace('Cmd+', '⌘')
    .replace('Shift+', '⇧')
    .replace('Alt+', '⌥')
    .replace('Ctrl+', '⌃')
}

export interface KeyLike {
  key: string
  code?: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/** Does this keyboard event match an app shortcut? (so terminals let it through) */
export function isAppShortcut(e: KeyLike, isMac: boolean): boolean {
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key
  return (Object.keys(BINDINGS) as Command[]).some((cmd) => {
    const parts = accelerator(cmd, isMac).split('+')
    const k = parts.pop()!
    const want = {
      meta: parts.includes('Cmd'),
      ctrl: parts.includes('Ctrl'),
      shift: parts.includes('Shift'),
      alt: parts.includes('Alt')
    }
    return (
      key === k &&
      e.metaKey === want.meta &&
      e.ctrlKey === want.ctrl &&
      e.shiftKey === want.shift &&
      e.altKey === want.alt
    )
  })
}

function digit(e: KeyLike): number | null {
  const m = e.code?.match(/^Digit([1-9])$/) ?? e.key.match(/^([1-9])$/)
  return m ? Number(m[1]) : null
}

/** Tab switching: macOS ⌘1-9, elsewhere Alt+1-9. */
export function tabIndexShortcut(e: KeyLike, isMac: boolean): number | null {
  const n = digit(e)
  if (n == null || e.shiftKey) return null
  return (isMac ? e.metaKey && !e.ctrlKey && !e.altKey : e.altKey && !e.ctrlKey && !e.metaKey) ? n : null
}

/** Space switching: macOS ⌃1-9, elsewhere Ctrl+Alt+1-9. */
export function spaceIndexShortcut(e: KeyLike, isMac: boolean): number | null {
  const n = digit(e)
  if (n == null || e.shiftKey) return null
  return (isMac ? e.ctrlKey && !e.metaKey && !e.altKey : e.ctrlKey && e.altKey && !e.metaKey) ? n : null
}
