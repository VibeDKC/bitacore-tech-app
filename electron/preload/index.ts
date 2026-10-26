import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type AppInfo, type BitacoreBridge, type RpcEnvelope } from '@shared/ipc'

const bridge: BitacoreBridge = {
  rpc<T = unknown>(command: string, payload: Record<string, unknown> = {}) {
    return ipcRenderer.invoke(IPC_CHANNELS.rpc, command, payload) as Promise<RpcEnvelope<T>>
  },
  appInfo() {
    return ipcRenderer.invoke(IPC_CHANNELS.appInfo) as Promise<AppInfo>
  },
  onMenuAction(callback: (action: string) => void) {
    const listener = (_event: unknown, action: string) => callback(action)
    ipcRenderer.on(IPC_CHANNELS.menuAction, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.menuAction, listener)
  }
}

contextBridge.exposeInMainWorld('bitacoretech', bridge)
