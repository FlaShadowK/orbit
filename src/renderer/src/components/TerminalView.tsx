import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { Space, Tab } from '@shared/types'
import { subscribeTerm } from '@/lib/term'
import { useStore } from '@/store'

const USE_WEBGL = false

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

interface Props {
  tab: Tab
  space: Space
  visible: boolean
  focused: boolean
}

export function TerminalView({ tab, space, visible, focused }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const exited = useRef(false)
  const tabRef = useRef(tab)
  tabRef.current = tab

  useEffect(() => {
    const term = new Terminal({
      fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      macOptionIsMeta: true,
      scrollback: 10000,
      theme: THEME
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon((_e, uri) => window.orbit.openExternal(uri)))
    term.open(host.current!)
    if (USE_WEBGL) {
      try {
        const webgl = new WebglAddon()
        webgl.onContextLoss(() => webgl.dispose())
        term.loadAddon(webgl)
      } catch {
        /* DOM renderer fallback */
      }
    }
    termRef.current = term
    fitRef.current = fit

    // let app-level shortcuts through
    term.attachCustomKeyEventHandler((e) => {
      const mod = e.metaKey || (e.ctrlKey && e.shiftKey)
      if (mod && ['k', 't', 'w', 'b', 'j', 'd', 's'].includes(e.key.toLowerCase())) return false
      if (e.metaKey && /^[1-9]$/.test(e.key)) return false
      return true
    })

    const start = (): void => {
      exited.current = false
      const t = tabRef.current
      try {
        fit.fit()
      } catch {
        /* hidden */
      }
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
    term.onResize(({ cols, rows }) => window.orbit.termResize(tab.id, cols, rows))
    term.onTitleChange((title) => {
      if (tabRef.current.kind === 'terminal' && title) useStore.getState().updateTab(tab.id, { title: title.slice(0, 40) })
    })

    start()

    const ro = new ResizeObserver(() => {
      if (host.current && host.current.offsetWidth > 0) {
        try {
          fit.fit()
        } catch {
          /* ignore */
        }
      }
    })
    ro.observe(host.current!)

    const onFocus = (e: Event): void => {
      if ((e as CustomEvent).detail === tab.id) setTimeout(() => term.focus(), 0)
    }
    window.addEventListener('orbit:focus', onFocus)

    return () => {
      ro.disconnect()
      unsub()
      window.removeEventListener('orbit:focus', onFocus)
      term.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id])

  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => {
        try {
          fitRef.current?.fit()
        } catch {
          /* ignore */
        }
        if (focused) termRef.current?.focus()
      })
    }
  }, [visible, focused])

  return <div className="terminal-host" ref={host} />
}
