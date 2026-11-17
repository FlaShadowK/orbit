import { themeById, type Theme } from '@shared/themes'
import { setEditorTheme } from './monaco'

/** Paint the app in a theme: CSS variables, editors; terminals follow via the store. */
export function applyTheme(id?: string): Theme {
  const t = themeById(id)
  const root = document.documentElement
  for (const [k, v] of Object.entries(t.ui)) root.style.setProperty(`--${k}`, v)
  root.style.colorScheme = t.kind
  root.dataset.theme = t.id
  root.dataset.themeKind = t.kind
  setEditorTheme(t.id)
  return t
}
