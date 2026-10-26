import type { LucideIcon } from 'lucide-react'

export type Role = 'superadmin' | 'admin' | 'tecnico' | 'cajero'

export type ModuleKey =
  | 'dashboard'
  | 'pos'
  | 'orders'
  | 'inventory'
  | 'customers'
  | 'purchases'
  | 'cash'
  | 'reports'
  | 'audit'
  | 'settings'

export type Capability =
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
  | 'authorizeNoCharge'
  | 'viewAudit'
  | 'viewFullAudit'
  | 'exportAudit'
  | 'useAI'
  | 'applyDiscount'
  | 'manageEvidence'
  | 'voidEvidence'
  | 'verifyEvidence'
  | 'exportEvidence'

export type ProductCategory =
  | 'Almacenamiento'
  | 'Memoria'
  | 'Periféricos'
  | 'Repuestos'
  | 'Componentes'
  | 'Accesorios'
  | 'Insumos'
  | 'Servicios'

export interface Product {
  id: string
  name: string
  sku: string
  barcode: string
  category: ProductCategory
  location: string
  stock: number
  minStock: number
  /** El backend lo omite para roles sin permiso de costos. */
  cost?: number
  price: number
  warrantyDays: number
  serials: string[]
  icon: LucideIcon
  iconKey?: string
  tone: string
  service?: boolean
}

export type StockStatus = 'in' | 'low' | 'out'

export interface Customer {
  id: string
  name: string
  documentType: 'CC' | 'NIT' | 'Pasaporte'
  document: string
  phone: string
  email: string
  address: string
  purchases: number
  orders: number
  openOrders?: number
  lastVisit: string
  isFinalConsumer?: boolean
}

export type WorkOrderStatus =
  | 'recibido'
  | 'diagnostico'
  | 'aprobacion'
  | 'reparacion'
  | 'pruebas'
  | 'listo'
  | 'entregado'
  | 'no_reparado'

export type DeviceCategory = 'laptop' | 'pc_torre' | 'celular' | 'consola' | 'impresora' | 'otro'

export type PowerState = 'enciende' | 'no_enciende' | 'enciende_se_apaga' | 'sin_prueba'

export type LockType = 'sin_bloqueo' | 'patron' | 'pin' | 'contrasena' | 'cuenta' | 'otro'

export type IntakeConditionKey =
  | 'screenDamage'
  | 'caseDamage'
  | 'hingeDamage'
  | 'missingScrews'
  | 'liquidDamage'
  | 'previousRepair'

export type IntakeConditions = Partial<Record<IntakeConditionKey, boolean>>

export interface TechnicalSheet {
  os?: string
  cpu?: string
  gpu?: string
  ram?: string
  storage?: string
  battery?: string
}

export interface LegalSnapshot {
  version: string
  acceptedAt: string
  abandonmentDays: number
  warrantyDays: number
  shortClauses: string[]
  fullClauses: string[]
}

export interface WorkOrderIntake {
  category: DeviceCategory
  categoryLabel: string
  powerState: PowerState
  conditions: IntakeConditions
  conditionNotes: string
  screenCondition?: string
  internalComponents?: string
  includesExternalDrives?: boolean
  accessories: string[]
  accessoriesNote?: string
  lockType: LockType
  lockNote?: string
  customerAuthorizesAccess: boolean
  customerWithheldCredentials: boolean
  estimate: number
  diagnosticFee: number
  technicalSheet?: TechnicalSheet
  receivedBy: string
  receivedAt: string
  legal: LegalSnapshot
}

export type EvidenceCategory = 'general' | 'pantalla' | 'carcasa' | 'serial' | 'accesorios' | 'otro'
export type EvidenceStage = 'ingreso' | 'reparacion'
export type EvidenceSource = 'archivo' | 'camara'
export type EvidenceStatus = 'activa' | 'anulada'

export interface EvidenceInput {
  dataUrl: string
  thumbnailDataUrl?: string
  category?: EvidenceCategory
  note?: string
  source?: EvidenceSource
  width?: number
  height?: number
}

export interface WorkOrderEvidence {
  id: string
  orderId: string
  category: EvidenceCategory
  note: string | null
  stage: EvidenceStage
  status: EvidenceStatus
  source: EvidenceSource
  filename: string
  mimeType: string
  size: number
  width: number | null
  height: number | null
  sha256: string
  capturedAt: string
  capturedByName: string
  createdAt: string
  voidedAt: string | null
  voidedByName: string | null
  voidReason: string | null
  verifiedAt: string | null
  verifiedByName: string | null
  url: string
  thumbnailUrl: string
  path: string
  thumbnailPath: string
}

export interface Settlement {
  status: 'pagado' | 'exento'
  amount: number
  method?: PaymentMethod
  paidAt: string
  invoiceNumber?: string
  exceptionReason?: string
}

export interface Payment {
  id: string
  number: string
  kind: 'anticipo' | 'saldo' | 'venta'
  method: PaymentMethod
  amount: number
  received: number | null
  change: number
  reference?: string | null
  isException?: boolean
  exceptionReason?: string | null
  createdAt: string
  createdByName: string
}

export interface WorkOrderItem {
  id: string
  type: 'servicio' | 'repuesto'
  description: string
  quantity: number
  unitPrice: number
}

export interface TimelineEvent {
  id: string
  status: WorkOrderStatus
  title: string
  description: string
  user: string
  date: string
  state: 'done' | 'current' | 'pending'
}

export interface WorkOrder {
  id: string
  number: string
  customerId: string
  customerName: string
  equipmentType: string
  brand: string
  model: string
  serial: string
  accessories: string
  physicalCondition: string
  reportedIssue: string
  diagnosis: string
  status: WorkOrderStatus
  technician: string
  technicianId?: string | null
  createdAt: string
  promisedAt: string
  deliveredAt?: string
  items: WorkOrderItem[]
  timeline: TimelineEvent[]
  notes?: string
  intake?: WorkOrderIntake
  settlement?: Settlement
  payments?: Payment[]
  paidAmount?: number
  balance?: number
  total?: number
  invoiceNumber?: string
  invoiceStatus?: string
  evidence?: WorkOrderEvidence[]
  evidenceCount?: number
  evidenceBytes?: number
  evidenceSetHash?: string | null
  evidenceVerified?: boolean
}

export type PaymentMethod = 'Efectivo' | 'Transferencia' | 'Tarjeta' | 'Mixto'

export interface Invoice {
  id: string
  number: string
  type?: 'venta' | 'orden'
  customerId?: string
  customerName: string
  orderId?: string | null
  date: string
  subtotal?: number
  discountPercent?: number
  discount?: number
  total: number
  method: PaymentMethod
  status: 'activa' | 'anulada'
  items: number
  notes?: string | null
  createdAt?: string
}

export interface CashMovement {
  id: string
  type: 'ingreso' | 'egreso' | 'venta'
  method: PaymentMethod
  amount: number
  reason: string
  user: string
  time: string
}

export interface CashSession {
  id: string
  user: string
  role: string
  openedAt: string
  initialAmount: number
  status: 'abierto' | 'cerrado'
  closedAt?: string | null
  counted?: number | null
  difference?: number | null
  expected: number
  cashSales: number
  digitalSales: number
  income: number
  expenses: number
  sales: number
  movements: CashMovement[]
  notes?: string | null
}

export interface CashCurrentResponse {
  current: CashSession | null
  lastClosed: CashSession | null
  movements: CashMovement[]
}

export interface AuditEvent {
  id: string
  time: string
  user: string
  role: string
  action: string
  entity: string
  entityName?: string
  entityId?: string | null
  detail: string
  hash: string
  prevHash: string
}

export interface NotificationItem {
  id: string
  title: string
  description: string
  time: string
  tone: 'warning' | 'success' | 'info' | 'danger'
}

export interface ChartPoint {
  month: string
  income: number
  expenses: number
}

export interface TopProduct {
  product: Product
  units: number
  revenue: number
  margin: number
}

export interface CartLine {
  product: Product
  quantity: number
}

export interface DashboardStat {
  label: string
  value: string
  change: number
  hint: string
  tone: 'brand' | 'success' | 'warning' | 'danger'
  icon: LucideIcon
}

export interface Supplier {
  id: string
  name: string
  nit: string
  contact: string
  phone: string
  category: string
  purchases: number
}

export interface Purchase {
  id: string
  number: string
  supplier: string
  date: string
  items: number
  subtotal: number
  iva: number
  total: number
  status: 'recibida' | 'pendiente'
}

export interface LegalConfig {
  businessName: string
  nit: string
  phone: string
  address: string
  city: string
  email: string
  version: string
  updatedAt: string
  abandonmentDays: number
  warrantyDays: number
  shortClauses: string[]
  fullClauses: string[]
}

export interface AuthUser {
  id: string
  username: string
  name: string
  email: string
  accountRole: Role
}

export interface AuthSession {
  token: string
  user: AuthUser
  displayUser: AuthUser
  role: Role
  actualRole: Role
  canPreviewRoles: boolean
  expiresAt: string
  roleLabel: string
}

export interface StockSummary {
  in: number
  low: number
  out: number
}

export interface DashboardStats {
  salesToday: number
  invoicesToday: number
  openOrders: number
  diagnosticOrders: number
  readyOrders: number
  lowStock: number
  cashExpected: number
}

export interface TechnicianStats {
  name: string
  total: number
  open: number
  closed: number
  load: number
}

export interface DashboardData {
  stats: DashboardStats
  products: Product[]
  orders: WorkOrder[]
  cashSession: CashSession | null
  stockSummary: StockSummary
  chartData: ChartPoint[]
  technicianStats: TechnicianStats[]
  notifications: NotificationItem[]
}

export interface ReportTopProduct {
  name: string
  units: number
  revenue: number
  margin: number | null
  marginPercent: number | null
}

export interface ReportData {
  period: 'hoy' | '7d' | '30d' | 'ano'
  salesTotal: number
  invoiceCount: number
  avgTicket: number
  grossMargin: number | null
  grossMarginPercent: number | null
  netProfit: number | null
  expenses: number
  ivaSoportado: number
  purchasesTotal: number
  chartData: ChartPoint[]
  paymentData: Array<{ name: string; value: number; color: string }>
  categoryData: Array<{ name: string; value: number; color: string }>
  topProducts: ReportTopProduct[]
  technicianStats: TechnicianStats[]
  invoices: Invoice[]
  payments: Payment[]
  permissions: { grossMargin: boolean; netProfit: boolean }
}

export interface StatusSetting {
  status: WorkOrderStatus
  label: string
  shortLabel: string
  description: string
  tone: string
  position: number
  isTerminal: boolean
  requiresPayment: boolean
  isCancel: boolean
}

export interface SettingsData {
  legal: LegalConfig
  print: {
    defaultFormat: string
    autoPrint: boolean
    showLogo: boolean
    showTermsOnReceipt: boolean
    paperWidth: number
  }
  ai: {
    enabled: boolean
    diagnosis: boolean
    summary: boolean
    anomalies: boolean
    model: string
    configured?: boolean
    keyFingerprint?: string
  }
  security: { strictSessions: boolean; sessionHours: number; rememberDays: number }
  business: {
    timezone: string
    currency: string
    locale: string
    invoicePrefix: string
    orderPrefix: string
  }
  statuses: StatusSetting[]
}

export interface AppUser {
  id: string
  name: string
  username: string
  email: string
  role: Role
  roleLabel: string
  status: string
  active: boolean
  lastAccess: string
  protected: boolean
  createdAt: string
}

export type BackupFormat = 'folder' | 'db'

export interface BackupRecord {
  id: string
  name: string
  date: string
  size: number | string
  author: string
  sha256: string
  path: string
  format?: BackupFormat
  orders?: number
  evidenceCount?: number
  evidenceBytes?: number
  version?: string
  databaseHash?: string
}

export interface StockMovement {
  id: string
  type: string
  quantity: number
  detail: string
  reference?: string | null
  user: string
  date: string
}

export interface SaleReceipt {
  number: string
  total: number
  method: PaymentMethod
  received: number
  change: number
  customerName: string
  lines: Array<{ productId: string; name: string; quantity: number; price: number; lineTotal: number }>
}
