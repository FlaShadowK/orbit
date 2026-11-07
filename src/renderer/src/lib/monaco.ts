import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new JsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  }
}

monaco.editor.defineTheme('orbit', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6b7389', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'c792ea' },
    { token: 'string', foreground: 'a5e075' },
    { token: 'number', foreground: 'f78c6c' },
    { token: 'type', foreground: '7fd6ff' }
  ],
  colors: {
    'editor.background': '#0d1017',
    'editor.lineHighlightBackground': '#141a24',
    'editorLineNumber.foreground': '#3a4256',
    'editorLineNumber.activeForeground': '#9aa4bd',
    'editor.selectionBackground': '#2a3b5c',
    'editorCursor.foreground': '#8b9bff',
    'editorWidget.background': '#121722',
    'editorIndentGuide.background1': '#1a2030'
  }
})

// Files are edited standalone (no project typings), so semantic errors would be noise.
monaco.typescript.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false })
monaco.typescript.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false })

export { monaco }

export function modelUri(path: string, serverId?: string): monaco.Uri {
  return serverId
    ? monaco.Uri.from({ scheme: 'sftp', authority: serverId, path: path.startsWith('/') ? path : '/' + path })
    : monaco.Uri.file(path)
}
