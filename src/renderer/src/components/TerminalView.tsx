import { memo, useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import type { Space, Tab } from '@shared/types'
import { subscribeTerm } from '@/lib/term'
import { glBudget, type GlHolder } from '@/lib/glBudget'
import { tabAgent, useStore } from '@/store'
import { isAppShortcut, spaceIndexShortcut, tabIndexShortcut } from '@shared/keys'

const IS_MAC = navigator.platform.toLowerCase().includes('mac')

const THEME = {
  background: '#0b0d12',
  foreground: '#d7dcea',
  cursor: '#8b9bff',
  cursorAccent: '#0b0d12',
  selectionBackground: '#2a3b5c',
  black: '#1b2030', red: '#ff6b81', green: '#7ee787', yellow: '#f5c26b',
  blue: '#7aa2ff', magenta: '#c792ea', cyan: '#5eead4', white: '#d7dcea',
  brightBlack: '#4b5470', brightRed: '#ff8fa0', brightGreen: '#a5f3a5', brightYellow: '#ffd88a',
  brightBlue: '#9db8ff', brightMagenta: '#ddb3ff', brightCyan: '#99f6e4', brightWhite: '#ffffff'
}

/** shell-quote a path for pasting into a terminal */
function quotePath(p: string): string {
  return /^[\w@%+=:,./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`
}

/**
 * macOS terminal key conventions (like Terminal.app / iTerm2 "natural text editing").
 * Returns the bytes to send, or null to let xterm handle the key.
 */
function macKeySequence(e: KeyboardEvent): string | null {
  const { key, metaKey: cmd, altKey: opt, ctrlKey: ctrl } = e
  if (ctrl) return null
  if (cmd && !opt) {
    if (key === 'Backspace') return '\x15' // kill line (Ctrl+U)
    if (key === 'Delete') return '\x0b' // kill to end of line (Ctrl+K)
    if (key === 'ArrowLeft') return '\x01' // line start (Ctrl+A)
    if (key === 'ArrowRight') return '\x05' // line end (Ctrl+E)
    return null
  }
  if (opt && !cmd) {
    if (key === 'ArrowLeft') return '\x1bb' // word back
    if (key === 'ArrowRight') return '\x1bf' // word forward
    if (key === 'Backspace') return '\x17' // delete word (Ctrl+W)
    if (key === 'Delete') return '\x1bd' // delete word forward
  }
  return null
}

interface Props {
  tab: Tab
  space: Space
  visible: boolean
  focused: boolean
}

export const TerminalView = memo(function TerminalView({ tab, space, visible, focused }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const openRef = useRef<() => void>(() => {})
  /** hidden terminals give their WebGL context back (Chromium allows only ~16 per page) */
  const hideRef = useRef<() => void>(() => {})
  const glRef = useRef<GlHolder | null>(null)
  const exited = useRef(false)
  const tabRef = useRef(tab)
  tabRef.current = tab

  useEffect(() => {
    const term = new Terminal({
      fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.15,
      cols: 120,
      rows: 32,
      cursorBlink: true,
      allowProposedApi: true,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
      scrollback: 20000,
      customGlyphs: true,
      rescaleOverlappingGlyphs: true,
      drawBoldTextInBrightColors: false,
      theme: THEME
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon((_e, uri) => window.orbit.openExternal(uri)))
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'
    termRef.current = term

    const send = (data: string): void => {
      if (!exited.current) window.orbit.termWrite(tab.id, data)
    }

    // Opening (and measuring the font) while the container is display:none gives a
    // broken cell size, so the terminal is only attached to the DOM once it is visible.
    // The session itself starts right away (xterm buffers output until then).
    let opened = false
    let webgl: WebglAddon | null = null
    // The WebGL renderer floors the glyph advance to whole device pixels
    // (JetBrains Mono 13px = 7.8px → 7px on a 1x external monitor), so every cell is
    // ~10% too narrow and rescaleOverlappingGlyphs squeezes the glyphs. Pad the cell
    // back to the rounded width via letterSpacing, and redo it whenever the DPR changes
    // (window moved between Retina and non-Retina screens).
    let dprQuery: MediaQueryList | null = null
    const syncCellWidth = (): void => {
      const dpr = window.devicePixelRatio || 1
      // macOS has no subpixel AA, so on 1x screens the 400 weight renders thin and
      // washed out; one step heavier reads like native text there.
      const weight = dpr < 2 ? 500 : 'normal'
      if (term.options.fontWeight !== weight) term.options.fontWeight = weight
      const ctx = document.createElement('canvas').getContext('2d')
      if (ctx) {
        ctx.font = `${term.options.fontSize}px ${term.options.fontFamily}`
        const w = ctx.measureText('W').width * dpr
        const pad = Math.max(0, Math.round(w) - Math.floor(w))
        if (term.options.letterSpacing !== pad) term.options.letterSpacing = pad
      }
      dprQuery?.removeEventListener('change', onDprChange)
      dprQuery = window.matchMedia(`(resolution: ${dpr}dppx)`)
      dprQuery.addEventListener('change', onDprChange)
    }
    let glCanvas: HTMLCanvasElement | null = null
    const dropWebgl = (): void => {
      const addon = webgl
      webgl = null
      glBudget.drop(gl)
      if (!addon) return
      // xterm's dispose leaves the context alive until GC, and Chromium counts it against its
      // limit meanwhile (killing other terminals' contexts): free it explicitly
      if (glCanvas) {
        glCanvas.dataset.orbitReleased = '1'
        const ctx = glCanvas.getContext('webgl2')
        ctx?.getExtension('WEBGL_lose_context')?.loseContext()
        glCanvas = null
      }
      addon.dispose()
    }
    const gl: GlHolder = { visible: false, lastShown: 0, release: () => dropWebgl() }
    glRef.current = gl
    let glRetries = 0
    let glRetryTimer: ReturnType<typeof setTimeout> | undefined
    const loadWebgl = (): void => {
      dropWebgl()
      // no slot left (every one is on screen): stay on the DOM renderer
      if (!glBudget.acquire(gl)) return
      try {
        const addon = new WebglAddon()
        addon.onContextLoss(() => {
          if (webgl !== addon) return addon.dispose()
          dropWebgl()
          // a terminal on screen shouldn't stay on the slow renderer: try again, a few times
          if (gl.visible && glRetries++ < 3)
            glRetryTimer = setTimeout(() => {
              if (gl.visible && !webgl) {
                loadWebgl()
                term.refresh(0, term.rows - 1)
              }
            }, 1000)
        })
        const before = new Set(term.element?.querySelectorAll('canvas'))
        term.loadAddon(addon)
        webgl = addon
        glCanvas = [...(term.element?.querySelectorAll('canvas') ?? [])].find((c) => !before.has(c)) ?? null
      } catch {
        dropWebgl() // DOM renderer fallback
      }
    }
    // xterm's WebGL renderer keeps its own cached DPR and does not reliably resize its
    // canvas when the window moves between Retina and 1x screens (text ends up at half
    // or double size). Rebuilding the renderer after the change reads the DPR fresh.
    let dprTimer: ReturnType<typeof setTimeout> | undefined
    const onDprChange = (): void => {
      clearTimeout(dprTimer)
      dprTimer = setTimeout(() => {
        if (!opened) return
        syncCellWidth()
        // hidden terminals have no WebGL renderer; they get a fresh one when shown
        if (webgl) loadWebgl()
        fitNow()
        term.refresh(0, term.rows - 1)
      }, 50)
    }
    const fitNow = (): void => {
      if (!opened || !host.current || host.current.offsetWidth === 0) return
      try {
        fit.fit()
      } catch {
        /* ignore */
      }
    }
    const openIfVisible = (): void => {
      if (opened || !host.current || host.current.offsetWidth === 0) return
      opened = true
      term.open(host.current)
      loadWebgl()
      syncCellWidth()
      fitNow()
    }
    openRef.current = () => {
      openIfVisible()
      if (opened && !webgl) {
        loadWebgl()
        term.refresh(0, term.rows - 1)
      }
      fitNow()
    }
    hideRef.current = () => dropWebgl()

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      // Shift+Enter → newline in agent prompts (same as Option+Enter)
      if (e.key === 'Enter' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        send('\x1b\r')
        e.preventDefault()
        return false
      }
      if (IS_MAC) {
        const seq = macKeySequence(e)
        if (seq) {
          send(seq)
          e.preventDefault()
          return false
        }
      }
      // let app-level shortcuts through to the menu / app
      if (isAppShortcut(e, IS_MAC)) return false
      if (tabIndexShortcut(e, IS_MAC) || spaceIndexShortcut(e, IS_MAC)) return false
      if (IS_MAC && e.metaKey && e.shiftKey && /^[[\]{}]$/.test(e.key)) return false
      // Windows/Linux: Ctrl+Shift+C/V/X are copy/paste/cut (Edit menu)
      if (!IS_MAC && e.ctrlKey && e.shiftKey && ['C', 'V', 'X'].includes(e.key.toUpperCase())) return false
      return true
    })

    const start = (): void => {
      exited.current = false
      const t = tabRef.current
      fitNow()
      window.orbit
        .termStart({
          id: t.id,
          kind: t.kind === 'ssh' ? 'ssh' : 'pty',
          cwd: space.root,
          tabKind: t.kind,
          agent: t.agent,
          agentSessionId: t.agentSessionId,
          resume: !!t.agentStarted,
          spaceId: space.id,
          serverId: t.serverId,
          cols: term.cols,
          rows: term.rows
        })
        .then((r) => {
          if (r.replay) term.write(r.replay)
        })
    }

    const unsub = subscribeTerm(
      tab.id,
      (data) => term.write(data),
      () => {
        exited.current = true
        term.write('\r\n\x1b[2m[process exited — press Enter to restart]\x1b[0m\r\n')
      }
    )
    term.onData((d) => {
      if (exited.current) {
        if (d === '\r') {
          term.reset()
          start()
        }
        return
      }
      window.orbit.termWrite(tab.id, d)
    })
    term.onBinary((d) => send(d))
    term.onResize(({ cols, rows }) => window.orbit.termResize(tab.id, cols, rows))
    term.onTitleChange((title) => {
      if (tabRef.current.kind === 'terminal' && title) useStore.getState().updateTab(tab.id, { title: title.slice(0, 40) })
    })

    // ---- paste: images become attachments / file paths
    const onPaste = (e: ClipboardEvent): void => {
      const items = [...(e.clipboardData?.items ?? [])]
      const hasImage = items.some((i) => i.kind === 'file' && i.type.startsWith('image/'))
      const hasText = items.some((i) => i.kind === 'string' && i.type === 'text/plain')
      if (!hasImage || hasText) return // plain text paste is handled by xterm
      e.preventDefault()
      e.stopImmediatePropagation()
      const t = tabRef.current
      const { running, agents } = useStore.getState()
      if (tabAgent(t, running, agents) === 'claude') {
        // Claude Code reads the image from the system clipboard on Ctrl+V
        send('\x16')
        return
      }
      const blob = items.find((i) => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile()
      if (!blob) return
      blob
        .arrayBuffer()
        .then((buf) => window.orbit.saveImage(new Uint8Array(buf), blob.type))
        .then((file) => term.paste(quotePath(file)))
    }

    // ---- drag & drop files → paste their paths (Claude attaches dropped images)
    const onDragOver = (e: DragEvent): void => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }
    }
    const onDrop = (e: DragEvent): void => {
      const files = [...(e.dataTransfer?.files ?? [])]
      if (!files.length) return
      e.preventDefault()
      const paths = files.map((f) => window.orbit.pathForFile(f)).filter(Boolean)
      if (paths.length) term.paste(paths.map(quotePath).join(' ') + ' ')
      term.focus()
    }

    const el = host.current!
    el.addEventListener('paste', onPaste, true)
    el.addEventListener('dragover', onDragOver)
    el.addEventListener('drop', onDrop)

    openIfVisible()
    start()

    const ro = new ResizeObserver(() => {
      openIfVisible()
      fitNow()
    })
    ro.observe(el)

    const onFocus = (e: Event): void => {
      if ((e as CustomEvent).detail === tab.id) setTimeout(() => term.focus(), 0)
    }
    window.addEventListener('orbit:focus', onFocus)

    return () => {
      ro.disconnect()
      dprQuery?.removeEventListener('change', onDprChange)
      clearTimeout(dprTimer)
      unsub()
      el.removeEventListener('paste', onPaste, true)
      el.removeEventListener('dragover', onDragOver)
      el.removeEventListener('drop', onDrop)
      window.removeEventListener('orbit:focus', onFocus)
      clearTimeout(glRetryTimer)
      dropWebgl()
      term.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id])

  useEffect(() => {
    const gl = glRef.current
    if (gl) {
      gl.visible = visible
      if (visible) gl.lastShown = Date.now()
    }
    if (visible) {
      requestAnimationFrame(() => {
        openRef.current()
        if (focused) termRef.current?.focus()
      })
      return
    }
    // keep the context briefly so flicking between tabs doesn't rebuild it every time
    const t = setTimeout(() => hideRef.current(), 2000)
    return () => clearTimeout(t)
  }, [visible, focused])

  return <div className="terminal-host" ref={host} />
})
