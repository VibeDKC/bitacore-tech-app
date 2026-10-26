import type { Role } from '@shared/index'

export type BackendCapability =
  | 'viewCosts'
  | 'viewGrossMargin'
  | 'viewNetProfit'
  | 'manageAdmins'
  | 'manageStaff'
  | 'createBackup'
  | 'restoreBackup'
  | 'purgeData'
  | 'configureLegal'
  | 'configureAI'
  | 'annulInvoice'
  | 'closeCash'
  | 'createPurchase'
  | 'editInventory'
  | 'createOrder'
  | 'diagnoseOrder'
  | 'settleOrder'
  | 'viewAudit'
  | 'viewFullAudit'
  | 'exportAudit'
  | 'useAI'
  | 'applyDiscount'
  | 'authorizeNoCharge'
  | 'manageEvidence'
  | 'voidEvidence'
  | 'verifyEvidence'
  | 'exportEvidence'

const roleModules: Record<Role, string[]> = {
  superadmin: ['dashboard', 'pos', 'orders', 'inventory', 'customers', 'purchases', 'cash', 'reports', 'audit', 'settings'],
  admin: ['dashboard', 'pos', 'orders', 'inventory', 'customers', 'purchases', 'cash', 'reports', 'settings'],
  tecnico: ['dashboard', 'orders', 'inventory', 'customers'],
  cajero: ['dashboard', 'pos', 'inventory', 'customers', 'cash']
}

const roleCapabilities: Record<Role, BackendCapability[]> = {
  superadmin: [
    'viewCosts',
    'viewGrossMargin',
    'viewNetProfit',
    'manageAdmins',
    'manageStaff',
    'createBackup',
    'restoreBackup',
    'purgeData',
    'configureLegal',
    'configureAI',
    'annulInvoice',
    'closeCash',
    'createPurchase',
    'editInventory',
    'createOrder',
    'diagnoseOrder',
    'settleOrder',
    'viewAudit',
    'viewFullAudit',
    'exportAudit',
    'useAI',
    'applyDiscount',
    'authorizeNoCharge',
    'manageEvidence',
    'voidEvidence',
    'verifyEvidence',
    'exportEvidence'
  ],
  admin: [
    'viewCosts',
    'viewGrossMargin',
    'manageStaff',
    'createBackup',
    'annulInvoice',
    'closeCash',
    'createPurchase',
    'editInventory',
    'createOrder',
    'diagnoseOrder',
    'settleOrder',
    'useAI',
    'applyDiscount',
    'authorizeNoCharge',
    'manageEvidence',
    'voidEvidence',
    'verifyEvidence',
    'exportEvidence'
  ],
  tecnico: ['createOrder', 'diagnoseOrder', 'useAI', 'manageEvidence'],
  cajero: ['closeCash', 'settleOrder', 'applyDiscount']
}

export function can(role: Role, capability: BackendCapability) {
  return roleCapabilities[role].includes(capability)
}

export function canAccessModule(role: Role, module: string) {
  return roleModules[role].includes(module)
}

export function requireCapability(role: Role, capability: BackendCapability) {
  if (!can(role, capability)) {
    throw new RpcError(`Tu rol (${roleLabel(role)}) no tiene permiso para esta acción.`, 'FORBIDDEN')
  }
}

export function requireModule(role: Role, module: string) {
  if (!canAccessModule(role, module)) {
    throw new RpcError(`Tu rol (${roleLabel(role)}) no tiene acceso a este módulo.`, 'FORBIDDEN')
  }
}

export function roleLabel(role: Role) {
  return role === 'superadmin' ? 'Propietario' : role === 'admin' ? 'Administrador' : role === 'tecnico' ? 'Técnico' : 'Cajero'
}

export class RpcError extends Error {
  code: string

  constructor(message: string, code = 'BAD_REQUEST') {
    super(message)
    this.name = 'RpcError'
    this.code = code
  }
}
