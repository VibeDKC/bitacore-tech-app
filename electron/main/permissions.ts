import type { Role } from '@shared/index'

export type BackendCapability =
  | 'viewCosts'
  | 'viewGrossMargin'
  | 'viewNetProfit'
  | 'manageAdmins'
  | 'manageStaff'
  | 'createBackup'
  | 'importBackup'
  | 'restoreBackup'
  | 'purgeData'
  | 'configureLegal'
  | 'configureBusiness'
  | 'managePermissions'
  | 'configureAI'
  | 'manageDictionaries'
  | 'annulInvoice'
  | 'closeCash'
  | 'createPurchase'
  | 'editInventory'
  | 'createOrder'
  | 'diagnoseOrder'
  | 'assignTechnician'
  | 'settleOrder'
  | 'manageLoyalty'
  | 'viewAudit'
  | 'viewFullAudit'
  | 'exportAudit'
  | 'useAI'
  | 'applyDiscount'
  | 'managePromotions'
  | 'publishCatalog'
  | 'authorizeNoCharge'
  | 'manageEvidence'
  | 'voidEvidence'
  | 'verifyEvidence'
  | 'exportEvidence'

export const ALL_CAPABILITIES: BackendCapability[] = [
  'viewCosts',
  'viewGrossMargin',
  'viewNetProfit',
  'manageAdmins',
  'manageStaff',
  'createBackup',
  'importBackup',
  'restoreBackup',
  'purgeData',
  'configureLegal',
  'configureBusiness',
  'managePermissions',
  'configureAI',
  'manageDictionaries',
  'annulInvoice',
  'closeCash',
  'createPurchase',
  'editInventory',
  'createOrder',
  'diagnoseOrder',
  'assignTechnician',
  'manageLoyalty',
  'settleOrder',
  'viewAudit',
  'viewFullAudit',
  'exportAudit',
  'useAI',
  'applyDiscount',
  'managePromotions',
  'publishCatalog',
  'authorizeNoCharge',
  'manageEvidence',
  'voidEvidence',
  'verifyEvidence',
  'exportEvidence'
]

export const ROOT_ONLY_CAPABILITIES: BackendCapability[] = [
  'viewAudit',
  'viewFullAudit',
  'exportAudit',
  'purgeData',
  'restoreBackup',
  'manageAdmins',
  'configureLegal',
  'configureAI'
]

export function capabilitiesForRole(role: Role) {
  return roleCapabilities[role]
}

const roleModules: Record<Role, string[]> = {
  superadmin: ['dashboard', 'pos', 'orders', 'inventory', 'customers', 'purchases', 'cash', 'reports', 'audit', 'promotions', 'settings'],
  admin: ['dashboard', 'pos', 'orders', 'inventory', 'customers', 'purchases', 'cash', 'reports', 'promotions', 'settings'],
  tecnico: ['dashboard', 'orders', 'inventory', 'customers', 'promotions'],
  cajero: ['dashboard', 'pos', 'inventory', 'customers', 'cash', 'promotions']
}

const roleCapabilities: Record<Role, BackendCapability[]> = {
  superadmin: [
    'viewCosts',
    'viewGrossMargin',
    'viewNetProfit',
    'manageAdmins',
    'manageStaff',
    'createBackup',
    'importBackup',
    'restoreBackup',
    'purgeData',
    'configureLegal',
    'configureBusiness',
    'managePermissions',
    'configureAI',
    'manageDictionaries',
    'annulInvoice',
    'closeCash',
    'createPurchase',
    'editInventory',
    'createOrder',
    'diagnoseOrder',
    'assignTechnician',
    'manageLoyalty',
    'settleOrder',
    'viewAudit',
    'viewFullAudit',
    'exportAudit',
    'useAI',
    'applyDiscount',
    'managePromotions',
    'publishCatalog',
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
    'configureBusiness',
    'managePermissions',
    'manageDictionaries',
    'createBackup',
    'importBackup',
    'annulInvoice',
    'closeCash',
    'createPurchase',
    'editInventory',
    'createOrder',
    'diagnoseOrder',
    'assignTechnician',
    'manageLoyalty',
    'settleOrder',
    'useAI',
    'applyDiscount',
    'managePromotions',
    'publishCatalog',
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
  details?: Record<string, unknown>

  constructor(message: string, code = 'BAD_REQUEST', details?: Record<string, unknown>) {
    super(message)
    this.name = 'RpcError'
    this.code = code
    this.details = details
  }
}
