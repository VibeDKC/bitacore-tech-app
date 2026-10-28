export const MODULE_KEYS = [
  'dashboard',
  'pos',
  'orders',
  'inventory',
  'customers',
  'purchases',
  'cash',
  'receivables',
  'reports',
  'audit',
  'promotions',
  'settings'
] as const

export type ModuleKey = (typeof MODULE_KEYS)[number]

export const MODULE_LABELS: Record<ModuleKey, string> = {
  dashboard: 'Panel',
  pos: 'Ventas / POS',
  orders: 'Órdenes de trabajo',
  inventory: 'Inventario',
  customers: 'Clientes',
  purchases: 'Compras y proveedores',
  cash: 'Caja',
  receivables: 'Cartera',
  reports: 'Reportes',
  audit: 'Auditoría',
  promotions: 'Promociones',
  settings: 'Configuración'
}
