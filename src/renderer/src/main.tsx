import './lib/canvasFontFix'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { App } from './App'

// xterm measures the cell size once at open — make sure the mono font is ready first
Promise.all([
  document.fonts.load('13px "JetBrains Mono Variable"'),
  document.fonts.load('bold 13px "JetBrains Mono Variable"')
])
  .catch(() => {})
  .finally(() => createRoot(document.getElementById('root')!).render(<App />))
