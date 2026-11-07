import { app, BrowserWindow, Menu, shell } from 'electron'
import { join } from 'path'
import { store } from './store'
import { registerIpc } from './ipc'
import { startMcp, stopMcp } from './mcp'
import { killAll } from './sessions'
import { unwatchAll } from './files'
import { emit } from './events'
import { shellEnv } from './shellEnv'

app.setName('Orbit')

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: '#0b0d12',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

function buildMenu(): void {
  const send = (cmd: string) => () => BrowserWindow.getFocusedWindow()?.webContents.send('orbit:command', cmd)
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Space…', accelerator: 'CmdOrCtrl+Shift+N', click: send('newSpace') },
        { label: 'New Agent Tab', accelerator: 'CmdOrCtrl+T', click: send('newAgent') },
        { label: 'New Terminal Tab', accelerator: 'CmdOrCtrl+Shift+T', click: send('newTerminal') },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('save') },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: send('closeTab') },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Command Palette', accelerator: 'CmdOrCtrl+K', click: send('palette') },
        { label: 'Toggle Files', accelerator: 'CmdOrCtrl+B', click: send('toggleFiles') },
        { label: 'Toggle Activity', accelerator: 'CmdOrCtrl+J', click: send('toggleActivity') },
        { label: 'Split Right', accelerator: 'CmdOrCtrl+D', click: send('splitRow') },
        { label: 'Split Down', accelerator: 'CmdOrCtrl+Shift+D', click: send('splitColumn') },
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
