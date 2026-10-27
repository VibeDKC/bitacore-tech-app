import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { IPC_CHANNELS, type AppInfo, type RpcEnvelope } from '@shared/ipc'
import {
  APP_DATA_FOLDER,
  LEGACY_APP_DATA_FOLDER,
  closeDatabase,
  getDatabasePath,
  migrateLegacyData,
  openDatabase
} from './database'
import { EVIDENCE_SCHEME, resolveEvidenceFile } from './evidence'
import { handleRpc } from './rpc'
import { RpcError } from './permissions'
import { resolveProductImageFile } from './productImages'
import { resolvePaymentReceiptFile } from './paymentReceipts'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const isDev = Boolean(process.env.ELECTRON_RENDERER_URL)

// El nombre del paquete puede hacer que Electron use %APPDATA%\bitacoretech.
// Se fija explícitamente la carpeta visible para el negocio.
app.setName('BitacoreTech')
const appDataPath = app.getPath('appData')
// Permite aislar datos en pruebas o instalaciones portables sin tocar la
// carpeta real del usuario. En operación normal no se define.
const userDataOverride = process.env.BITACORETECH_DATA_PATH
const legacyDataOverride = process.env.BITACORETECH_LEGACY_DATA_PATH
const userDataPath = userDataOverride ? path.resolve(userDataOverride) : path.join(appDataPath, APP_DATA_FOLDER)
const legacyDataPath = legacyDataOverride
  ? path.resolve(legacyDataOverride)
  : path.join(appDataPath, LEGACY_APP_DATA_FOLDER)
app.setPath('userData', userDataPath)

protocol.registerSchemesAsPrivileged([
  {
    scheme: EVIDENCE_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  }
])

let mainWindow: BrowserWindow | null = null

function createWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    title: 'BitacoreTech Taller & POS',
    backgroundColor: '#F7F8FA',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(currentDir, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  window.once('ready-to-show', () => window.show())

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    const allowed = process.env.ELECTRON_RENDERER_URL
    if (allowed && url.startsWith(allowed)) return
    if (!allowed && url.startsWith('file://')) return
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  if (isDev) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL as string)
  } else {
    void window.loadFile(path.join(currentDir, '../renderer/index.html'))
  }

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  mainWindow = window
}

function registerEvidenceProtocol() {
  protocol.handle(EVIDENCE_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      const isEvidence = relativePath.startsWith('evidence/')
      const isProductImage = relativePath.startsWith('product-images/')
      const isPaymentReceipt = relativePath.startsWith('payment-receipts/')
      if (!isEvidence && !isProductImage && !isPaymentReceipt) {
        return new Response('Archivo no encontrado', { status: 404 })
      }
      const absolutePath = isProductImage
        ? resolveProductImageFile(app.getPath('userData'), relativePath)
        : isPaymentReceipt
          ? resolvePaymentReceiptFile(app.getPath('userData'), relativePath)
          : resolveEvidenceFile(app.getPath('userData'), relativePath)
      if (!fs.existsSync(absolutePath)) {
        return new Response('Archivo no encontrado', { status: 404 })
      }
      return net.fetch(pathToFileURL(absolutePath).toString())
    } catch {
      return new Response('Archivo no encontrado', { status: 404 })
    }
  })
}

function registerPermissions() {
  const allowed = new Set<string>(['media'])
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(allowed.has(permission))
  })
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return allowed.has(permission)
  })
}

function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Archivo',
      submenu: [{ role: 'quit', label: 'Salir de BitacoreTech' }]
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Deshacer' },
        { role: 'redo', label: 'Rehacer' },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' }
      ]
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'reload', label: 'Recargar' },
        { role: 'toggleDevTools', label: 'Herramientas de desarrollo' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Restablecer zoom' },
        { role: 'zoomIn', label: 'Acercar' },
        { role: 'zoomOut', label: 'Alejar' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pantalla completa' }
      ]
    },
    {
      label: 'Ayuda',
      submenu: [
        {
          label: 'Acerca de BitacoreTech',
          click: () => {
            mainWindow?.webContents.send(IPC_CHANNELS.menuAction, 'about')
          }
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function registerIpc() {
  ipcMain.handle(IPC_CHANNELS.appInfo, (): AppInfo => {
    return {
      version: app.getVersion(),
      platform: process.platform,
      currency: 'COP',
      locale: 'es-CO',
      dbPath: getDatabasePath(app.getPath('userData'))
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.rpc,
    async (_event, command: unknown, payload: unknown): Promise<RpcEnvelope<unknown>> => {
      const body =
        payload && typeof payload === 'object' && !Array.isArray(payload)
          ? { ...(payload as Record<string, unknown>) }
          : {}
      const token = typeof body.__token === 'string' ? body.__token : undefined
      delete body.__token
      try {
        if (typeof command !== 'string' || !command) {
          throw new RpcError('Comando IPC inválido', 'BAD_REQUEST')
        }
        const data = await handleRpc(command, body, token, {
          userDataPath: app.getPath('userData'),
          version: app.getVersion()
        })
        return { ok: true, data }
      } catch (error) {
        const failure =
          error instanceof RpcError
            ? {
                code: error.code,
                message: error.message,
                ...(error.details ? { details: error.details } : {})
              }
            : {
                code: 'INTERNAL_ERROR',
                message:
                  error instanceof Error
                    ? error.message
                    : 'Ocurrió un error inesperado en el proceso principal.'
              }
        if (!(error instanceof RpcError)) console.error('[BitacoreTech] Error IPC', command, error)
        return { ok: false, error: failure }
      }
    }
  )
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('co.bitacoretech.taller')
    try {
      const migration = migrateLegacyData(app.getPath('userData'), legacyDataPath)
      if (migration.migrated) {
        console.log(
          `[BitacoreTech] Datos migrados desde ${migration.from}. Archivos de evidencia: ${migration.evidenceFiles}.`
        )
      }
      openDatabase(app.getPath('userData'))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Ocurrió un error inesperado al preparar la base de datos.'
      dialog.showErrorBox('BitacoreTech · No se pudieron abrir los datos', message)
      app.quit()
      return
    }

    registerEvidenceProtocol()
    registerPermissions()
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
    closeDatabase()
  })
}
