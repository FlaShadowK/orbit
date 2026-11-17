import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'
import { DEFAULT_THEME, THEMES, themeById } from '@shared/themes'

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new JsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  }
}

const hex = (c: string): string => c.replace('#', '')

// one editor theme per app theme: `orbit-<id>`
for (const t of THEMES) {
  const e = t.editor
  monaco.editor.defineTheme(`orbit-${t.id}`, {
    base: t.kind === 'light' ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: hex(e.comment), fontStyle: 'italic' },
      { token: 'keyword', foreground: hex(e.keyword) },
      { token: 'string', foreground: hex(e.string) },
      { token: 'number', foreground: hex(e.number) },
      { token: 'type', foreground: hex(e.type) }
    ],
    colors: {
      'editor.background': e.bg,
      'editor.lineHighlightBackground': e.lineHighlight,
      'editorLineNumber.foreground': e.lineNumber,
      'editorLineNumber.activeForeground': e.lineNumberActive,
      'editor.selectionBackground': e.selection,
      'editorCursor.foreground': t.ui.accent,
      'editorWidget.background': e.widget,
      'editorIndentGuide.background1': e.indent,
      'minimap.background': e.bg
    }
  })
}

let current = `orbit-${DEFAULT_THEME}`
/** Monaco themes are global: switching repaints every open editor and diff. */
export function setEditorTheme(id: string): void {
  current = `orbit-${themeById(id).id}`
  monaco.editor.setTheme(current)
}
export const editorTheme = (): string => current

// Files are edited standalone (no project typings), so semantic errors would be noise.
monaco.typescript.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false })
monaco.typescript.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false })

export { monaco }

export function modelUri(path: string, serverId?: string): monaco.Uri {
  return serverId
    ? monaco.Uri.from({ scheme: 'sftp', authority: serverId, path: path.startsWith('/') ? path : '/' + path })
    : monaco.Uri.file(path)
}
