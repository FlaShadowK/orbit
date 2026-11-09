import { app, BrowserWindow, Menu } from 'electron'
import { store } from './store'
import { registerIpc } from './ipc'
import { startMcp, stopMcp } from './mcp'
import { killAll } from './sessions'
import { unwatchAll } from './files'
import { unwatchAll as unwatchGit } from './git'
import { emit } from './events'
import { shellEnv } from './shellEnv'
import { accelerator, type Command } from '@shared/keys'
import { createMainWindow, mainWindow, markQuitting } from './windows'
import { checkForUpdates, initUpdater } from './updater'

const IS_MAC = process.platform === 'darwin'

app.setName('Orbit')
// separate profile for testing a second instance next to your everyday Orbit
if (process.env.ORBIT_USER_DATA) app.setPath('userData', process.env.ORBIT_USER_DATA)

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
    ...(IS_MAC
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { label: 'Check for Updates…', click: () => checkForUpdates(true) },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
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
        { type: 'separator' },
        item('Split Right', 'splitRow'),
        item('Split Down', 'splitColumn'),
        { label: 'Split Left', click: send('splitLeft') },
        { label: 'Split Up', click: send('splitUp') },
        item('Close Pane', 'closePane'),
        item('Move Tab to New Window', 'detachTab'),
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' },
    ...(IS_MAC ? [] : [{ label: 'Help', submenu: [{ label: 'Check for Updates…', click: () => checkForUpdates(true) }] }])
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
  createMainWindow()
  initUpdater()
  app.on('activate', () => {
    if (!mainWindow()) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  markQuitting()
  store.flush()
  killAll()
  unwatchAll()
  unwatchGit()
  stopMcp()
})
