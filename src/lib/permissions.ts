import type { Capability, ModuleKey, Role } from '@/types'

export const roleLabels: Record<Role, string> = {
  superadmin: 'Propietario',
  admin: 'Administrador',
  tecnico: 'Técnico',
  cajero: 'Cajero'
}

export const roleShortLabels: Record<Role, string> = {
  superadmin: 'Propietario',
  admin: 'Encargado',
  tecnico: 'Taller',
  cajero: 'Caja'
}

export const roleDescriptions: Record<Role, string> = {
  superadmin: 'Acceso total, configuración maestra y acciones destructivas.',
  admin: 'Operación completa, personal base y reportes brutos.',
  tecnico: 'Recepción, diagnóstico y repuestos. Sin costos ni anulaciones.',
  cajero: 'POS, caja y clientes. Sin costos ni reportes financieros.'
}

const roleModules: Record<Role, ModuleKey[]> = {
  superadmin: [
    'dashboard',
    'pos',
    'orders',
    'inventory',
    'customers',
    'purchases',
    'cash',
    'reports',
    'audit',
    'settings'
  ],
  admin: ['dashboard', 'pos', 'orders', 'inventory', 'customers', 'purchases', 'cash', 'reports', 'settings'],
  tecnico: ['dashboard', 'orders', 'inventory', 'customers'],
  cajero: ['dashboard', 'pos', 'inventory', 'customers', 'cash']
}

const roleCapabilities: Record<Role, Capability[]> = {
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
    'authorizeNoCharge',
    'viewAudit',
    'viewFullAudit',
    'exportAudit',
    'useAI',
    'applyDiscount',
    'manageEvidence',
    'voidEvidence',
    'verifyEvidence',
    'exportEvidence'
  ],
  admin: [
    'viewCosts',
    'viewGrossMargin',
    'manageStaff',
    'manageDictionaries',
    'createBackup',
    'annulInvoice',
    'closeCash',
    'createPurchase',
    'editInventory',
    'createOrder',
    'diagnoseOrder',
    'assignTechnician',
    'manageLoyalty',
    'settleOrder',
    'authorizeNoCharge',
    'useAI',
    'applyDiscount',
    'manageEvidence',
    'voidEvidence',
    'verifyEvidence',
    'exportEvidence'
  ],
  tecnico: ['createOrder', 'diagnoseOrder', 'useAI', 'manageEvidence'],
  cajero: ['closeCash', 'settleOrder', 'applyDiscount']
}

export function canAccessModule(role: Role, module: ModuleKey) {
  return roleModules[role].includes(module)
}

let effectivePermissions: Set<Capability> | null = null

export function setEffectivePermissions(permissions: Capability[] | null) {
  effectivePermissions = permissions ? new Set(permissions) : null
}

export function can(role: Role, capability: Capability) {
  if (effectivePermissions) return effectivePermissions.has(capability)
  return roleCapabilities[role].includes(capability)
}

export const capabilityLabels: Record<Capability, string> = {
  viewCosts: 'Ver costos',
  viewGrossMargin: 'Ver margen bruto',
  viewNetProfit: 'Ver utilidad neta',
  manageAdmins: 'Gestionar administradores',
  manageStaff: 'Gestionar personal',
  createBackup: 'Crear respaldos',
  restoreBackup: 'Restaurar respaldos',
  purgeData: 'Purgar datos',
  configureLegal: 'Configurar legal',
  configureAI: 'Configurar IA',
  manageDictionaries: 'Gestionar diccionarios',
  annulInvoice: 'Anular facturas',
  closeCash: 'Cerrar caja',
  createPurchase: 'Crear compras',
  editInventory: 'Editar inventario',
  createOrder: 'Crear OT',
  diagnoseOrder: 'Diagnosticar OT',
  assignTechnician: 'Reasignar técnico',
  manageLoyalty: 'Configurar fidelidad',
  settleOrder: 'Cobrar y entregar',
  viewAudit: 'Ver auditoría',
  viewFullAudit: 'Ver auditoría completa',
  exportAudit: 'Exportar auditoría',
  useAI: 'Usar IA',
  applyDiscount: 'Aplicar descuentos',
  authorizeNoCharge: 'Autorizar entrega sin cobro',
  manageEvidence: 'Gestionar evidencias',
  voidEvidence: 'Anular evidencias',
  verifyEvidence: 'Verificar evidencias',
  exportEvidence: 'Exportar evidencias'
}

export const allCapabilities = Object.keys(capabilityLabels) as Capability[]

export const rootOnlyCapabilities: Capability[] = [
  'viewAudit',
  'viewFullAudit',
  'exportAudit',
  'purgeData',
  'restoreBackup',
  'manageAdmins',
  'configureLegal',
  'configureAI'
]

export function roleCan(role: Role, capability: Capability) {
  return roleCapabilities[role].includes(capability)
}

export function visibleModules(role: Role) {
  return roleModules[role]
}

export const permissionMatrix: Array<{
  group: string
  items: Array<{ label: string; roles: Record<Role, 'full' | 'partial' | 'none' | 'readonly'> }>
}> = [
  {
    group: 'Operación',
    items: [
      { label: 'Ventas y POS', roles: { superadmin: 'full', admin: 'full', tecnico: 'none', cajero: 'full' } },
      { label: 'Órdenes de trabajo', roles: { superadmin: 'full', admin: 'full', tecnico: 'full', cajero: 'none' } },
      { label: 'Asignar y reasignar técnico', roles: { superadmin: 'full', admin: 'full', tecnico: 'none', cajero: 'none' } },
      { label: 'Configurar fidelidad de clientes', roles: { superadmin: 'full', admin: 'full', tecnico: 'none', cajero: 'none' } },
      { label: 'Evidencias fotográficas', roles: { superadmin: 'full', admin: 'full', tecnico: 'partial', cajero: 'none' } },
      { label: 'Clientes', roles: { superadmin: 'full', admin: 'full', tecnico: 'full', cajero: 'full' } },
      { label: 'Inventario', roles: { superadmin: 'full', admin: 'partial', tecnico: 'readonly', cajero: 'readonly' } },
      { label: 'Compras y proveedores', roles: { superadmin: 'full', admin: 'full', tecnico: 'none', cajero: 'none' } },
      { label: 'Caja y turnos', roles: { superadmin: 'full', admin: 'full', tecnico: 'none', cajero: 'full' } },
      { label: 'Reportes brutos y margen', roles: { superadmin: 'full', admin: 'partial', tecnico: 'none', cajero: 'none' } },
      { label: 'Utilidad neta y balance', roles: { superadmin: 'full', admin: 'none', tecnico: 'none', cajero: 'none' } }
    ]
  },
  {
    group: 'Seguridad y administración',
    items: [
      { label: 'Personal técnico y cajeros', roles: { superadmin: 'full', admin: 'full', tecnico: 'none', cajero: 'none' } },
      { label: 'Diccionarios y catálogos', roles: { superadmin: 'full', admin: 'full', tecnico: 'none', cajero: 'none' } },
      { label: 'Crear o modificar admins', roles: { superadmin: 'full', admin: 'none', tecnico: 'none', cajero: 'none' } },
      { label: 'Cuenta raíz', roles: { superadmin: 'full', admin: 'none', tecnico: 'none', cajero: 'none' } },
      { label: 'Anulación de facturas', roles: { superadmin: 'full', admin: 'partial', tecnico: 'none', cajero: 'none' } },
      { label: 'Auditoría', roles: { superadmin: 'full', admin: 'none', tecnico: 'none', cajero: 'none' } },
      { label: 'Backup', roles: { superadmin: 'full', admin: 'partial', tecnico: 'none', cajero: 'none' } },
      { label: 'Restaurar backup', roles: { superadmin: 'full', admin: 'none', tecnico: 'none', cajero: 'none' } },
      { label: 'Purga / reinicio', roles: { superadmin: 'full', admin: 'none', tecnico: 'none', cajero: 'none' } },
      { label: 'Datos legales y fiscales', roles: { superadmin: 'full', admin: 'readonly', tecnico: 'none', cajero: 'none' } },
      { label: 'Claves de IA / API', roles: { superadmin: 'full', admin: 'none', tecnico: 'none', cajero: 'none' } }
    ]
  }
]
