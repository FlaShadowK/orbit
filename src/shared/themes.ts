/**
 * Color themes. Each one sets the UI's CSS variables, the terminal palette and the editor
 * colors, so switching themes repaints everything at once.
 */
export interface TermColors {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export interface EditorColors {
  bg: string
  lineHighlight: string
  lineNumber: string
  lineNumberActive: string
  selection: string
  widget: string
  indent: string
  comment: string
  keyword: string
  string: string
  number: string
  type: string
}

export interface Theme {
  id: string
  label: string
  kind: 'dark' | 'light'
  /** CSS custom properties, without the leading `--` */
  ui: Record<string, string>
  term: TermColors
  editor: EditorColors
}

const DARK_ANSI = {
  red: '#ff6b81', green: '#7ee787', yellow: '#f5c26b', blue: '#7aa2ff', magenta: '#c792ea', cyan: '#5eead4',
  brightRed: '#ff8fa0', brightGreen: '#a5f3a5', brightYellow: '#ffd88a', brightBlue: '#9db8ff', brightMagenta: '#ddb3ff', brightCyan: '#99f6e4', brightWhite: '#ffffff'
}

const LIGHT_ANSI = {
  black: '#3b3833', red: '#c4314b', green: '#2a8a43', yellow: '#a26a00', blue: '#2f5fd0', magenta: '#8e44ad', cyan: '#0d8a83', white: '#cfc9be',
  brightBlack: '#8a8478', brightRed: '#de4a63', brightGreen: '#38a856', brightYellow: '#bf8300', brightBlue: '#4a78e8', brightMagenta: '#a65bc6', brightCyan: '#13a89f', brightWhite: '#1f1c18'
}

function dark(
  id: string,
  label: string,
  c: { bg: string; bg1: string; bg2: string; bg3: string; line: string; line2: string; fg: string; fg2: string; fg3: string; accent: string; accent2: string; warn: string; bad: string; ok: string; info: string; selection: string; ansiBlack: string; ansiBrightBlack: string },
  editor: Partial<EditorColors> = {}
): Theme {
  return {
    id,
    label,
    kind: 'dark',
    ui: {
      bg: c.bg, 'bg-1': c.bg1, 'bg-2': c.bg2, 'bg-3': c.bg3, line: c.line, 'line-2': c.line2,
      fg: c.fg, 'fg-2': c.fg2, 'fg-3': c.fg3, accent: c.accent, 'accent-2': c.accent2,
      warn: c.warn, bad: c.bad, ok: c.ok, info: c.info, 'on-accent': c.bg, scrim: 'rgba(0, 0, 0, 0.55)', shadow: 'rgba(0, 0, 0, 0.5)'
    },
    term: {
      ...DARK_ANSI,
      background: c.bg, foreground: c.fg, cursor: c.accent, cursorAccent: c.bg, selectionBackground: c.selection,
      black: c.ansiBlack, white: c.fg, brightBlack: c.ansiBrightBlack, yellow: c.warn, red: c.bad, green: c.ok
    },
    editor: {
      bg: c.bg1, lineHighlight: c.bg2, lineNumber: c.line2, lineNumberActive: c.fg2, selection: c.selection, widget: c.bg2, indent: c.line,
      comment: c.fg3, keyword: '#c792ea', string: '#a5e075', number: '#f78c6c', type: '#7fd6ff',
      ...editor
    }
  }
}

function light(
  id: string,
  label: string,
  c: { bg: string; bg1: string; bg2: string; bg3: string; line: string; line2: string; fg: string; fg2: string; fg3: string; accent: string; accent2: string; warn: string; bad: string; ok: string; info: string; selection: string }
): Theme {
  return {
    id,
    label,
    kind: 'light',
    ui: {
      bg: c.bg, 'bg-1': c.bg1, 'bg-2': c.bg2, 'bg-3': c.bg3, line: c.line, 'line-2': c.line2,
      fg: c.fg, 'fg-2': c.fg2, 'fg-3': c.fg3, accent: c.accent, 'accent-2': c.accent2,
      warn: c.warn, bad: c.bad, ok: c.ok, info: c.info, 'on-accent': '#ffffff', scrim: 'rgba(40, 36, 30, 0.28)', shadow: 'rgba(40, 36, 30, 0.18)'
    },
    term: {
      ...LIGHT_ANSI,
      background: c.bg, foreground: c.fg, cursor: c.accent, cursorAccent: c.bg, selectionBackground: c.selection
    },
    editor: {
      bg: c.bg, lineHighlight: c.bg1, lineNumber: c.line2, lineNumberActive: c.fg2, selection: c.selection, widget: c.bg1, indent: c.line,
      comment: c.fg3, keyword: '#8e44ad', string: '#2a8a43', number: '#b5541c', type: '#2f5fd0'
    }
  }
}

export const THEMES: Theme[] = [
  dark('orbit', 'Orbit', {
    bg: '#0b0d12', bg1: '#0f121a', bg2: '#141824', bg3: '#1a1f2e', line: '#1f2535', line2: '#2a3145',
    fg: '#d7dcea', fg2: '#9aa4bd', fg3: '#626b84', accent: '#8b9bff', accent2: '#5eead4',
    warn: '#f5c26b', bad: '#ff6b81', ok: '#7ee787', info: '#7aa2ff', selection: '#2a3b5c', ansiBlack: '#1b2030', ansiBrightBlack: '#4b5470'
  }, { bg: '#0d1017', lineHighlight: '#141a24', lineNumber: '#3a4256', widget: '#121722', indent: '#1a2030', comment: '#6b7389' }),
  dark('eclipse', 'Eclipse', {
    bg: '#000000', bg1: '#08080a', bg2: '#111114', bg3: '#1a1a1f', line: '#1c1c21', line2: '#2b2b32',
    fg: '#e9e7e4', fg2: '#a9a6a1', fg3: '#6c6a66', accent: '#4fd1c5', accent2: '#a78bfa',
    warn: '#ffcc66', bad: '#ff6b6b', ok: '#6ee7a0', info: '#7cb4ff', selection: '#1f3a3a', ansiBlack: '#1a1a1f', ansiBrightBlack: '#55545a'
  }),
  dark('nebula', 'Nebula', {
    bg: '#120d1d', bg1: '#170f26', bg2: '#1e1530', bg3: '#281c3e', line: '#2a1f40', line2: '#3b2c57',
    fg: '#ece4ff', fg2: '#b3a6d1', fg3: '#7a6c99', accent: '#e879f9', accent2: '#67e8f9',
    warn: '#fbbf24', bad: '#fb7185', ok: '#86efac', info: '#a5b4fc', selection: '#3d2a5c', ansiBlack: '#241a36', ansiBrightBlack: '#5f4f80'
  }, { keyword: '#f0abfc', type: '#67e8f9' }),
  dark('aurora', 'Aurora', {
    bg: '#091214', bg1: '#0c171a', bg2: '#112024', bg3: '#17292e', line: '#1a2c31', line2: '#263d44',
    fg: '#d6ece8', fg2: '#93b3ad', fg3: '#5b7a74', accent: '#5eead4', accent2: '#bef264',
    warn: '#fcd34d', bad: '#fb7185', ok: '#86efac', info: '#7dd3fc', selection: '#1d3d3c', ansiBlack: '#15252a', ansiBrightBlack: '#4a6a66'
  }, { keyword: '#5eead4', string: '#bef264' }),
  light('dawn', 'Dawn', {
    bg: '#fbf8f3', bg1: '#f3eee6', bg2: '#ebe4d9', bg3: '#e1d8c9', line: '#e2d9cc', line2: '#d0c4b2',
    fg: '#2b2620', fg2: '#5e5548', fg3: '#8f8473', accent: '#5b5bd6', accent2: '#0f9488',
    warn: '#c27c00', bad: '#d6334a', ok: '#1f9d55', info: '#2f6fd0', selection: '#d9d6f5'
  }),
  light('daylight', 'Daylight', {
    bg: '#ffffff', bg1: '#f6f7f9', bg2: '#eef0f4', bg3: '#e4e7ee', line: '#e3e6ec', line2: '#cfd4de',
    fg: '#1d2330', fg2: '#4a5367', fg3: '#7f889e', accent: '#4f6bed', accent2: '#0e9f8a',
    warn: '#c27c00', bad: '#d93a51', ok: '#188a4a', info: '#2f6fd0', selection: '#d6defc'
  })
]

export const DEFAULT_THEME = 'orbit'

export function themeById(id?: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}
