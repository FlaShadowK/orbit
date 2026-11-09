import { app, BrowserWindow, Menu, shell } from 'electron'
import { join } from 'path'
import { store } from './store'
import { registerIpc } from './ipc'
import { startMcp, stopMcp } from './mcp'
import { killAll } from './sessions'
import { unwatchAll } from './files'
import { emit } from './events'
import { shellEnv } from './shellEnv'
import { accelerator, type Command } from '@shared/keys'
import { isSafeExternalUrl } from './links'

const IS_MAC = process.platform === 'darwin'

app.setName('Orbit')

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 900,
    minHeight: 560,
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
    }
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
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

function buildMenu(): void {
  const send = (cmd: string) => () => BrowserWindow.getFocusedWindow()?.webContents.send('orbit:command', cmd)
  const item = (label: string, cmd: Command): Electron.MenuItemConstructorOptions => ({ label, accelerator: accelerator(cmd, IS_MAC), click: send(cmd) })
  // On Windows/Linux, Ctrl+C/V/X/A must stay with the terminal, so the menu uses Ctrl+Shift for clipboard
  const editMenu: Electron.MenuItemConstructorOptions = IS_MAC
    ? { role: 'editMenu' }
    : {
        label: 'Edit',
        submenu: [
          { role: 'undo', accelerator: '' },
          { role: 'redo', accelerator: '' },
          { type: 'separator' },
          { role: 'cut', accelerator: 'Ctrl+Shift+X' },
          { role: 'copy', accelerator: 'Ctrl+Shift+C' },
          { role: 'paste', accelerator: 'Ctrl+Shift+V' },
          { role: 'selectAll', accelerator: '' }
        ]
      }
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        item('New Space…', 'newSpace'),
        item('New Agent Tab', 'newAgent'),
        item('New Terminal Tab', 'newTerminal'),
        item('Save', 'save'),
        item('Close Tab', 'closeTab'),
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }
      ]
    },
    editMenu,
    {
      label: 'View',
      submenu: [
        item('Command Palette', 'palette'),
        item('Toggle Files', 'toggleFiles'),
        item('Toggle Activity', 'toggleActivity'),
        item('Split Right', 'splitRow'),
        item('Split Down', 'splitColumn'),
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(async () => {
  store.load()
  store.onServersChanged = (servers) => emit({ type: 'servers', servers })
  shellEnv()
  await startMcp()
  registerIpc()
  buildMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  store.flush()
  killAll()
  unwatchAll()
  stopMcp()
})
