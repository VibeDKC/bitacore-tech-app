import type { LucideIcon } from 'lucide-react'
import type { ModuleKey } from './modules'
import type { CatalogSyncStatus, ProductPromotion } from './promotions'

export * from './dictionaries'
export * from './messages'
export * from './modules'
export * from './promotions'

export type Role = 'superadmin' | 'admin' | 'tecnico' | 'cajero'

export type Capability =
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
  | 'collectReceivables'
  | 'manageLoyalty'
  | 'authorizeNoCharge'
  | 'authorizeCredit'
  | 'viewAudit'
  | 'viewFullAudit'
  | 'exportAudit'
  | 'useAI'
  | 'applyDiscount'
  | 'managePromotions'
  | 'publishCatalog'
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

export type ProductRotation = 'rotativo' | 'no_rotativo' | 'prueba'

export interface Product {
  id: string
  name: string
  sku: string
  barcode: string
  supplierSku: string
  /** Nombre del nodo activo de inventory_category. */
  category: string
  location: string
  condition?: string
  origin?: string
  stock: number
  minStock: number
  /** El backend lo omite para roles sin permiso de costos. */
  cost?: number
  price: number
  imageUrl?: string | null
  imageThumbnailUrl?: string | null
  imageUpdatedAt?: string | null
  warrantyDays: number
  serials: string[]
  alertEnabled: boolean
  publishWeb: boolean
  promotion?: ProductPromotion | null
  rotation: ProductRotation
  icon: LucideIcon
  iconKey?: string
  tone: string
  service?: boolean
  serviceType?: string | null
}

export type StockStatus = 'in' | 'low' | 'out'

export interface CustomerPhone {
  id?: string
  phone: string
  label: string
  isPrimary: boolean
}

export interface Customer {
  id: string
  name: string
  documentType: 'CC' | 'NIT' | 'Pasaporte'
  document: string
  documentDv?: string
  documentMissing?: boolean
  phone: string
  phones?: CustomerPhone[]
  phoneWarning?: string
  email: string
  address: string
  purchases: number
  orders: number
  openOrders?: number
  lastVisit: string
  isFinalConsumer?: boolean
  isForeignDocument?: boolean
  loyaltyActive?: boolean
  loyaltyDiscountType?: 'percent' | 'amount'
  loyaltyDiscountValue?: number
  loyaltyValidUntil?: string | null
  loyaltyNotes?: string
  creditEnabled?: boolean
  creditLimit: number
  creditDays: number
}

export interface Equipment {
  id: string
  customerId: string
  category: string
  categoryLabel: string
  equipmentType: string
  brand: string
  model: string
  serial: string
  accessories: string
  technicalSheet?: Record<string, unknown> | null
  notes?: string | null
  createdAt: string
  updatedAt: string
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

export interface TechnicalSheetCpu {
  brand?: string
  family?: string
  model?: string
  notVisible?: boolean
}

export type GpuKind = '' | 'none' | 'integrated' | 'dedicated'

export interface TechnicalSheetGpu {
  type?: GpuKind
  brand?: string
  model?: string
  vram?: string
  notVisible?: boolean
}

export interface TechnicalSheetRamModule {
  id: string
  type?: string
  capacity?: string
  speed?: string
  brand?: string
}

export interface TechnicalSheetStorageDrive {
  id: string
  type?: string
  capacity?: string
  speed?: string
  model?: string
  /** Valores anteriores a 1.8.0: Bueno, Regular, Crítico o No evaluado. */
  health?: string
  /** Salud medida por benchmark, entre 0 y 100. */
  healthPercent?: number
  healthNotApplicable?: boolean
}

export interface TechnicalSheetLegacy {
  os?: string
  cpu?: string
  gpu?: string
  ram?: string
  storage?: string
  battery?: string
}

export interface TechnicalSheet {
  os?: string
  osNotVisible?: boolean
  cpu?: TechnicalSheetCpu
  gpu?: TechnicalSheetGpu
  ramModules?: TechnicalSheetRamModule[]
  ramNotVisible?: boolean
  storageDrives?: TechnicalSheetStorageDrive[]
  storageNotVisible?: boolean
  battery?: string
  batteryNotVisible?: boolean
  notes?: string
  /** Modelos o componentes que no aparecen en los diccionarios. */
  other?: string
  /** Datos de las OT creadas antes de 1.6.0. */
  legacy?: TechnicalSheetLegacy
}

export interface LegalSnapshot {
  version: string
  acceptedAt: string
  abandonmentDays: number
  warrantyDays: number
  shortClauses: string[]
  fullClauses: string[]
  /** Copia histórica de la ficha técnica aceptada al ingreso. */
  technicalSheet?: TechnicalSheet
}

export interface WorkOrderIntake {
  category: DeviceCategory
  categoryLabel: string
  customBuild?: boolean
  alias?: string
  powerState: PowerState
  conditions: IntakeConditions
  conditionNotes: string
  screenCondition?: string
  /** Campo legado de OTs anteriores a 1.8.0; ya no se captura. */
  internalComponents?: string
  includesExternalDrives?: boolean
  /** Motivo de ingreso: falla puntual o un servicio de mantenimiento. */
  serviceKind?: 'falla' | 'mantenimiento'
  serviceType?: string
  serviceDetail?: string
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
  status: 'pagado' | 'exento' | 'credito'
  amount: number
  method?: PaymentMethod | 'Crédito'
  paidAt: string
  invoiceNumber?: string
  exceptionReason?: string
  creditAuthorizedBy?: string | null
}

export interface PaymentReceipt {
  url: string
  filename: string
  mimeType: string
  size: number
  uploadedAt?: string
  uploadedByName?: string | null
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
  incomeAccountId?: string | null
  incomeAccountName?: string | null
  isException?: boolean
  exceptionReason?: string | null
  createdAt: string
  createdByName: string
  receipt?: PaymentReceipt | null
}

export interface WorkOrderItem {
  id: string
  type: 'servicio' | 'repuesto'
  description: string
  quantity: number
  unitPrice: number
  /** Solo aplica a repuestos vinculados a un producto del inventario. */
  warrantyDays: number
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

export interface WorkOrderAssignment {
  id: string
  fromUserId: string | null
  fromName: string | null
  toUserId: string
  toName: string
  reason: string
  assignedBy: string
  assignedByName: string
  createdAt: string
}

export interface TechnicianOption {
  id: string
  name: string
}

export interface WorkOrderWarranty {
  days: number
  startsAt: string
  until: string
  daysLeft: number
  status: 'vigente' | 'por_vencer' | 'vencida'
}

export interface WorkOrderAbandonment {
  days: number
  at: string
  daysLeft: number
  atRisk: boolean
}

export interface WorkOrder {
  id: string
  number: string
  trackingCode?: string | null
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
  equipmentId?: string | null
  equipment?: Equipment | null
  createdAt: string
  promisedAt: string
  deliveredAt?: string
  items: WorkOrderItem[]
  timeline: TimelineEvent[]
  assignments?: WorkOrderAssignment[]
  notes?: string
  intake?: WorkOrderIntake
  settlement?: Settlement
  payments?: Payment[]
  paidAmount?: number
  balance?: number
  total?: number
  invoiceNumber?: string
  invoiceStatus?: string
  hasCredentials?: boolean
  credentialsUpdatedAt?: string | null
  credentialsViewCount?: number
  evidence?: WorkOrderEvidence[]
  evidenceCount?: number
  evidenceBytes?: number
  evidenceSetHash?: string | null
  evidenceVerified?: boolean
  warranty?: WorkOrderWarranty | null
  abandonment?: WorkOrderAbandonment | null
}

export type PaymentMethod = 'Efectivo' | 'Transferencia' | 'Tarjeta' | 'Mixto'

export interface Invoice {
  id: string
  number: string
  type?: 'venta' | 'ot'
  customerId?: string
  customerName: string
  orderId?: string | null
  date: string
  subtotal?: number
  discountPercent?: number
  discountType?: 'percent' | 'amount'
  discountValue?: number
  discount?: number
  total: number
  method: PaymentMethod
  status: 'activa' | 'anulada'
  items: number
  lines?: Array<{
    id: string
    description: string
    quantity: number
    unitPrice: number
    originalUnitPrice?: number
    promotionName?: string | null
    promotionDiscount?: number
    lineTotal: number
    note?: string | null
    itemType?: 'producto' | 'servicio'
  }>
  received?: number
  change?: number
  notes?: string | null
  createdAt?: string
  createdByName?: string
  createdByRole?: string
  dueDate?: string | null
  creditAuthorized?: boolean
  incomeAccountName?: string | null
  paymentId?: string | null
  paymentReceipt?: PaymentReceipt | null
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
  carryOver?: number
}

export interface CashTransfer {
  id: string
  cashSessionId: string
  accountId: string
  accountName: string
  requestedAmount: number
  approvedAmount: number | null
  status: 'pendiente' | 'aprobado' | 'rechazado'
  requestedBy: string
  requestedByName: string
  approvedBy?: string | null
  approvedByName?: string | null
  approvedAt?: string | null
  rejectionReason?: string | null
  notes?: string | null
  createdAt: string
  canApprove: boolean
}

export interface CashCurrentResponse {
  current: CashSession | null
  lastClosed: CashSession | null
  movements: CashMovement[]
  pendingTransfers?: CashTransfer[]
  myTransfers?: CashTransfer[]
  incomeAccount?: {
    id: string
    name: string
    responsibleUserId?: string | null
    responsibleUserName?: string | null
  } | null
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
  note?: string
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
  nitDv?: string
  isForeignNit?: boolean
  contact: string
  phone: string
  category: string
  purchases: number
}

export interface Purchase {
  id: string
  number: string
  supplierId?: string
  supplier: string
  supplierNit?: string
  supplierNitDv?: string
  date: string
  items: number
  subtotal: number
  iva: number
  discount: number
  adjustment: number
  total: number
  status: 'recibida' | 'pendiente'
  paymentStatus: 'pagada' | 'pendiente' | 'parcial'
  paymentMethod: string
  paymentAccount?: string | null
  paymentAccountId?: string | null
  paid: number
  balance: number
  dueDate?: string | null
  createdByName?: string
  createdByRole?: string
  linkedIncomeAccountName?: string | null
  payments: SupplierPayment[]
  notes?: string | null
  ai?: {
    provider?: string
    model?: string
    extractedAt?: string
    confidence?: number
    extractionHash?: string
    warnings?: string[]
    [key: string]: unknown
  } | null
  lines?: Array<{
    id: string
    productId: string | null
    description: string
    quantity: number
    unitPrice: number
    ivaRate: number
    iva: number
    unitPriceWithTax: number
    supplierSku: string
    serialText: string
    lineTotal: number
  }>
}

export interface SupplierPayment {
  id: string
  amount: number
  method: string
  paymentAccount?: string | null
  paymentAccountId?: string | null
  date: string
  notes?: string | null
  createdByName?: string | null
}

export interface AiInvoiceCostChange {
  previousCost: number
  previousPrice: number
  newCost: number
  marginPercent: number
  suggestedPrice: number
}

export interface AiInvoiceLineDraft {
  id: string
  description: string
  quantity: number
  unitCost: number
  ivaRate: number
  unitCostWithTax: number
  confidence: number
  productId: string | null
  productName: string | null
  productSku: string | null
  supplierSku: string
  serialText: string
  skuSugerido: string
  skuSource: 'producto' | 'ia' | 'local' | 'ajustado' | 'sin-sku'
  skuWarning: string | null
  matchConfidence: number
  warnings: string[]
  costChange: AiInvoiceCostChange | null
}

export interface AiModelOption {
  id: string
  displayName: string
  description?: string
  inputTokenLimit?: number
  outputTokenLimit?: number
}

export interface AiModelAttempt {
  model: string
  code: string
  message: string
  retryAfterSeconds?: number
}

export interface AiInvoiceDraft {
  supplier: {
    name: string
    nit: string
    supplierId: string | null
    matchedName: string | null
    match: 'exact' | 'name' | 'none'
    confidence: number
  }
  invoice: {
    number: string
    date: string
    currency: string
    paymentMethod?: string
    paymentCondition?: 'contado' | 'credito'
    confidence: number
  }
  lines: AiInvoiceLineDraft[]
  subtotal: number
  discount: number
  iva: number
  calculatedTotal: number
  realTotal: number
  difference: number
  duplicate: boolean
  duplicatePurchaseId: string | null
  warnings: string[]
  ai: {
    provider: string
    model: string
    requestedModel?: string
    fallbackUsed?: boolean
    attempts?: AiModelAttempt[]
    extractedAt: string
    confidence: number
    extractionHash: string
    warnings: string[]
  }
  source: {
    name: string
    mimeType: string
    size: number
  }
}

export interface PurchaseReviewNewProduct {
  name: string
  sku: string
  supplierSku?: string
  category: string
  location: string
  condition?: string
  origin?: string
  price: number
  warrantyDays?: number
}

export interface PurchaseReviewLineInput {
  description: string
  quantity: number
  unitCost: number
  ivaRate: number
  productId?: string | null
  newProduct?: PurchaseReviewNewProduct | null
  supplierSku?: string
  serialText?: string
  sellPrice?: number | null
  updatePrice?: boolean
}

export interface PurchaseReviewInput {
  supplierId: string
  number: string
  date: string
  lines: PurchaseReviewLineInput[]
  discount: number
  realTotal: number
  updatePrices?: boolean
  duplicateConfirmed?: boolean
  paymentCondition?: 'contado' | 'credito'
  paymentMethod?: string
  paymentAccountId?: string
  initialPayment?: number
  dueDate?: string | null
  notes?: string
  aiMetadata?: Record<string, unknown> | null
}

export interface AiTestResult {
  ok: boolean
  model: string
  latencyMs: number
  message: string
}

export interface AiModelListResult {
  models: AiModelOption[]
  fetchedAt: string
}

export interface LegalConfig {
  businessName: string
  nit: string
  nitDv?: string
  foreignNit?: string
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
  photoUrl?: string | null
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
  permissions: Capability[]
  modules: ModuleKey[]
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
  personalPerformance: {
    sellerInvoices: number
    sellerSales: number
    technicianOrders: number
    technicianSales: number
  }
  notifications: NotificationItem[]
}

export interface ReportTopProduct {
  name: string
  units: number
  revenue: number
  margin: number | null
  marginPercent: number | null
}

export interface SalesByUserRow {
  userId: string
  name: string
  role: string
  invoices: number
  sales: number
  cost: number | null
  margin: number | null
  marginPercent: number | null
  averageTicket: number
}

export interface TechnicianRevenueRow {
  userId: string
  name: string
  role: string
  orders: number
  sales: number
  services: number
  parts: number
  cost: number | null
  margin: number | null
}

export interface PurchasesByUserRow {
  userId: string
  name: string
  role: string
  purchases: number
  items: number
  total: number
  iva: number
  estimatedMargin: number | null
  lastPurchaseAt: string | null
}

export interface AccountSummaryRow {
  accountName: string
  income: number
  expenses: number
  balance: number
  entries: number
}

export interface ReportData {
  period: 'hoy' | '7d' | '30d' | 'ano'
  salesTotal: number
  salesPos: number
  salesOt: number
  invoiceCount: number
  invoiceCountPos: number
  invoiceCountOt: number
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
  salesByUser: SalesByUserRow[]
  technicianRevenue: TechnicianRevenueRow[]
  purchasesByUser: PurchasesByUserRow[]
  accountSummary: AccountSummaryRow[]
  purchaseTrackingEnabled: boolean
  invoices: Invoice[]
  payments: Payment[]
  permissions: { grossMargin: boolean; netProfit: boolean }
}

export interface ReceivableRow {
  invoiceId: string
  invoiceNumber: string
  orderId: string
  orderNumber: string
  customerId: string
  customerName: string
  customerPhone: string
  total: number
  paid: number
  balance: number
  createdAt: string
  deliveredAt: string | null
  dueDate: string
  daysOverdue: number
  creditDays: number
  creditAuthorizedBy: string | null
  status: 'al_dia' | 'por_vencer' | 'vencida'
  bucket: 'al_dia' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90'
}

export interface ReceivablesSummary {
  total: number
  overdue: number
  dueSoon: number
  current: number
  count: number
  overdueCount: number
  dueSoonCount: number
  aging: {
    d1_30: number
    d31_60: number
    d61_90: number
    d90: number
  }
}

export interface ReceivablesData {
  generatedAt: string
  summary: ReceivablesSummary
  rows: ReceivableRow[]
}

export interface ReceivableDetail extends ReceivableRow {
  payments: Payment[]
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
    provider?: string
    model: string
    fallbackModels?: string[]
    autoFallback?: boolean
    modelCatalog?: AiModelOption[]
    catalogUpdatedAt?: string | null
    configured?: boolean
    keyFingerprint?: string
  }
  security: { strictSessions: boolean; sessionHours: number }
  business: {
    timezone: string
    currency: string
    locale: string
    invoicePrefix: string
    orderPrefix: string
  }
  equipment: { qrEnabled: boolean }
  payments: { requireReceiptForDigital: boolean }
  messages: { initial: string; ready: string }
  tracking: { purchasesByUser: boolean }
  catalog: CatalogSyncStatus
  backup: { passwordConfigured: boolean }
  rolePermissions: Array<{ role: Role; capability: Capability; allowed: boolean }>
  roleModules: Array<{ role: Role; module: ModuleKey; allowed: boolean }>
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
  documentType?: string | null
  document?: string | null
  phone?: string | null
  address?: string | null
  photoUrl?: string | null
  permissionOverrides?: Array<{ capability: Capability; allowed: boolean; reason?: string }>
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
  lines: Array<{
    productId?: string | null
    name: string
    quantity: number
    price: number
    originalPrice?: number
    promotionName?: string | null
    promotionDiscount?: number
    lineTotal: number
    note?: string | null
  }>
}
