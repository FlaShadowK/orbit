import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'path'
import { isSafeExternalUrl } from './links'
import { emit } from './events'

const IS_MAC = process.platform === 'darwin'

let main: BrowserWindow | null = null
let quitting = false
/** called from before-quit so windows closing during shutdown don't try to dock their tabs */
export function markQuitting(): void {
  quitting = true
}
/** tab id → its own window */
const detached = new Map<string, BrowserWindow>()

function load(win: BrowserWindow, hash = ''): void {
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL + (hash ? `#${hash}` : ''))
  else win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
}

function baseWindow(opts: Electron.BrowserWindowConstructorOptions): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    backgroundColor: '#0b0d12',
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'default',
    autoHideMenuBar: !IS_MAC,
    icon: IS_MAC ? undefined : join(__dirname, '../../resources/icon.png'),
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    },
    ...opts
  })
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  // the renderer is a single-page app: never let it navigate away from itself
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) {
      e.preventDefault()
      if (isSafeExternalUrl(url)) shell.openExternal(url)
    }
  })
  return win
}

export function createMainWindow(): BrowserWindow {
  main = baseWindow({ width: 1480, height: 920, minWidth: 900, minHeight: 560 })
  main.on('closed', () => {
    main = null
    // detached tabs belong to the main window; they dock back when it reopens
    for (const w of [...detached.values()]) w.destroy()
    detached.clear()
  })
  load(main)
  return main
}

export function mainWindow(): BrowserWindow | null {
  return main && !main.isDestroyed() ? main : null
}

export interface DetachRequest {
  tabId: string
  spaceId: string
  title: string
  /** screen point where the tab was dropped */
  at?: { x: number; y: number }
}

export function detachTab(req: DetachRequest): void {
  const existing = detached.get(req.tabId)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return
  }
  const width = 960
  const height = 640
  let pos: { x: number; y: number } | undefined
  if (req.at) {
    const { workArea } = screen.getDisplayNearestPoint(req.at)
    pos = {
      x: Math.round(Math.min(Math.max(req.at.x - 120, workArea.x), workArea.x + workArea.width - width)),
      y: Math.round(Math.min(Math.max(req.at.y - 16, workArea.y), workArea.y + workArea.height - height))
    }
  }
  const win = baseWindow({ width, height, minWidth: 420, minHeight: 260, title: req.title, ...pos })
  detached.set(req.tabId, win)
  win.on('closed', () => {
    if (detached.get(req.tabId) === win) detached.delete(req.tabId)
    // closing the window docks the tab back into the main window
    if (!quitting) emit({ type: 'detached', tabId: req.tabId, detached: false })
  })
  load(win, `detached=${encodeURIComponent(req.tabId)}&space=${encodeURIComponent(req.spaceId)}`)
}

/** Close a detached window without docking (the tab was closed or re-placed by the main window). */
export function closeDetached(tabId: string): void {
  const win = detached.get(tabId)
  if (!win) return
  detached.delete(tabId)
  win.destroy()
}

export function focusDetached(tabId: string): void {
  const win = detached.get(tabId)
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
}

/** Bring the main window forward (e.g. from a notification). */
export function showMain(): void {
  const w = mainWindow()
  if (!w) return
  if (w.isMinimized()) w.restore()
  w.show()
  w.focus()
}
