import { useEffect, useRef, useState } from 'react'
import type { Tab } from '@shared/types'
import { monaco, modelUri } from '@/lib/monaco'
import { langFor } from '@/lib/util'
import { useStore } from '@/store'

/** last saved content per model uri — used for dirty tracking and external reloads */
const savedContent = new Map<string, string>()

async function loadContent(tab: Tab): Promise<string> {
  return tab.serverId
    ? window.orbit.sftpRead(tab.serverId, tab.filePath!)
    : window.orbit.fsRead(tab.filePath!)
}

export async function saveTab(tab: Tab): Promise<void> {
  const uri = modelUri(tab.filePath!, tab.serverId)
  const model = monaco.editor.getModel(uri)
  if (!model) return
  const value = model.getValue()
  if (tab.serverId) await window.orbit.sftpWrite(tab.serverId, tab.filePath!, value)
  else await window.orbit.fsWrite(tab.filePath!, value)
  savedContent.set(uri.toString(), value)
  useStore.getState().setDirty(tab.id, false)
}

/** Called on fs change events: reload the model if it has no unsaved edits. */
export async function reloadIfClean(path: string): Promise<void> {
  const uri = monaco.Uri.file(path)
  const model = monaco.editor.getModel(uri)
  if (!model) return
  const key = uri.toString()
  if (model.getValue() !== savedContent.get(key)) return // user has unsaved edits
  try {
    const next = await window.orbit.fsRead(path)
    if (next === model.getValue()) return
    savedContent.set(key, next)
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: next }], () => null)
  } catch {
    /* deleted or unreadable */
  }
}

export function disposeModel(tab: Tab): void {
  if (!tab.filePath) return
  const uri = modelUri(tab.filePath, tab.serverId)
  monaco.editor.getModel(uri)?.dispose()
  savedContent.delete(uri.toString())
}

export function EditorView({ tab, focused }: { tab: Tab; focused: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let disposed = false
    const uri = modelUri(tab.filePath!, tab.serverId)
    const key = uri.toString()
    const editor = monaco.editor.create(host.current!, {
      theme: 'orbit',
      fontFamily: '"JetBrains Mono Variable", Menlo, monospace',
      fontSize: 13,
      lineHeight: 20,
      minimap: { enabled: true, scale: 1, renderCharacters: false },
      smoothScrolling: true,
      cursorSmoothCaretAnimation: 'on',
      automaticLayout: true,
      scrollBeyondLastLine: false,
      padding: { top: 10 },
      bracketPairColorization: { enabled: true },
      renderWhitespace: 'selection'
    })
    editorRef.current = editor
    // ⌘S is handled by the app menu → saveTab()

    const attach = (model: monaco.editor.ITextModel): void => {
      editor.setModel(model)
      setLoading(false)
      const sub = model.onDidChangeContent(() => useStore.getState().setDirty(tab.id, model.getValue() !== savedContent.get(key)))
      editor.onDidDispose(() => sub.dispose())
      if (focused) editor.focus()
    }

    const existing = monaco.editor.getModel(uri)
    if (existing) attach(existing)
    else
      loadContent(tab).then(
        (content) => {
          if (disposed) return
          savedContent.set(key, content)
          const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(content, langFor(tab.filePath!), uri)
          attach(model)
        },
        (e) => {
          setError((e as Error).message)
          setLoading(false)
        }
      )

    return () => {
      disposed = true
      editor.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id])

  useEffect(() => {
    if (focused) editorRef.current?.focus()
  }, [focused])

  return (
    <div className="editor-wrap">
      {error && <div className="pane-message error">{error}</div>}
      {loading && !error && <div className="pane-message">Loading…</div>}
      <div className="editor-host" ref={host} style={{ visibility: error ? 'hidden' : 'visible' }} />
    </div>
  )
}
