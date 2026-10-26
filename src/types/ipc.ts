/**
 * Contrato del puente IPC entre el proceso principal de Electron y el renderer.
 * Este archivo no importa Electron para poder compartirse con ambos procesos.
 */

export interface AppInfo {
  version: string
  platform: string
  currency: string
  locale: string
  dbPath: string
}

export interface RpcFailure {
  code: string
  message: string
}

export type RpcEnvelope<T> = { ok: true; data: T } | { ok: false; error: RpcFailure }

export interface BitacoreBridge {
  rpc<T = unknown>(command: string, payload?: Record<string, unknown>): Promise<RpcEnvelope<T>>
  appInfo(): Promise<AppInfo>
  onMenuAction(callback: (action: string) => void): () => void
}

export const IPC_CHANNELS = {
  rpc: 'bitacoretech:rpc',
  appInfo: 'bitacoretech:app-info',
  menuAction: 'bitacoretech:menu-action'
} as const
