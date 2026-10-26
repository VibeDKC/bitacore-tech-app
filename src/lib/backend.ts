import {
  Cable,
  Cpu,
  FlaskConical,
  HardDrive,
  MemoryStick,
  Mouse,
  Package,
  SprayCan,
  Wrench,
  type LucideIcon
} from 'lucide-react'
import type {
  AppUser,
  AuditEvent,
  BackupRecord,
  CashCurrentResponse,
  CashSession,
  ChartPoint,
  Customer,
  DashboardData,
  EvidenceInput,
  EvidenceStage,
  Invoice,
  LegalConfig,
  Payment,
  PaymentMethod,
  Product,
  Purchase,
  ReportData,
  SaleReceipt,
  SettingsData,
  StockMovement,
  Supplier,
  TechnicianOption,
  WorkOrder
} from '@/types'
import type { AuthSession } from '@/types'
import type { BitacoreBridge } from '@/types/ipc'

declare global {
  interface Window {
    bitacoretech?: BitacoreBridge
  }
}

export class ApiError extends Error {
  code: string

  constructor(message: string, code = 'UNKNOWN') {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

const TOKEN_KEY = 'bitacoretech.session.token'
const REMEMBER_KEY = 'bitacoretech.session.remember'

function storage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(REMEMBER_KEY) === '0' ? window.sessionStorage : window.localStorage
  } catch {
    return null
  }
}

function readStoredToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

let authToken: string | null = readStoredToken()

export function getAuthToken() {
  return authToken
}

export function setAuthToken(token: string | null, remember = true) {
  authToken = token
  try {
    if (!token) {
      localStorage.removeItem(TOKEN_KEY)
      sessionStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(REMEMBER_KEY)
      return
    }
    const target = remember ? localStorage : sessionStorage
    const other = remember ? sessionStorage : localStorage
    other.removeItem(TOKEN_KEY)
    target.setItem(TOKEN_KEY, token)
    localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0')
  } catch {
    // El token vive en memoria si el almacenamiento no está disponible.
  }
}

export function hasBridge() {
  return typeof window !== 'undefined' && Boolean(window.bitacoretech)
}

export async function rpc<T>(command: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!window.bitacoretech) {
    throw new ApiError(
      'El puente de Electron no está disponible. Abre la aplicación con npm run dev o el ejecutable de BitacoreTech.',
      'NO_BRIDGE'
    )
  }
  const body = authToken ? { ...payload, __token: authToken } : payload
  const response = await window.bitacoretech.rpc<T>(command, body)
  if (!response.ok) throw new ApiError(response.error.message, response.error.code)
  return response.data
}

const productIcons: Record<string, LucideIcon> = {
  'hard-drive': HardDrive,
  'memory-stick': MemoryStick,
  mouse: Mouse,
  wrench: Wrench,
  cpu: Cpu,
  cable: Cable,
  'spray-can': SprayCan,
  'flask-conical': FlaskConical,
  package: Package
}

type ApiProduct = Omit<Product, 'icon'>

export function hydrateProduct(product: ApiProduct): Product {
  return { ...product, icon: productIcons[product.iconKey ?? 'package'] ?? Package }
}

function hydrateProducts(products: ApiProduct[]): Product[] {
  return products.map(hydrateProduct)
}

export interface LoginResult extends AuthSession {}

export interface SetupStatus {
  setupRequired: boolean
  hasUsers: boolean
}

export interface SetupInput {
  name: string
  username: string
  password: string
  email?: string
  businessName?: string
  demo?: boolean
}

export interface SessionInfo {
  user: AuthSession['user']
  displayUser: AuthSession['displayUser']
  role: AuthSession['role']
  actualRole: AuthSession['actualRole']
  canPreviewRoles: boolean
  expiresAt: string
  roleLabel: string
}

export interface CustomerDetail {
  customer: Customer
  orders: WorkOrder[]
  invoices: Invoice[]
}

export interface OrderItemInput {
  id: string
  type: 'servicio' | 'repuesto'
  description: string
  quantity: number
  unitPrice: number
  productId?: string | null
}

export interface SettleInput {
  id: string
  method?: PaymentMethod
  received?: number
  noCharge?: boolean
  exceptionReason?: string
  reference?: string
}

export interface PosSaleInput {
  customerId: string
  lines: Array<{ productId: string; quantity: number }>
  method: PaymentMethod
  discountPercent?: number
  received?: number
  reference?: string
}

export interface NewOrderInput {
  customerId: string
  deviceCategory: string
  categoryLabel: string
  equipmentType: string
  brand: string
  model: string
  serial: string
  accessories: string
  physicalCondition: string
  reportedIssue: string
  technicianId?: string
  technician?: string
  promisedAt: string
  notes?: string
  intake: Record<string, unknown>
  evidence?: EvidenceInput[]
}

export const api = {
  auth: {
    status() {
      return rpc<SetupStatus>('auth.status')
    },
    setup(input: SetupInput) {
      return rpc<LoginResult>('auth.setup', input as unknown as Record<string, unknown>)
    },
    login(username: string, password: string, remember = true) {
      return rpc<LoginResult>('auth.login', { username, password, remember })
    },
    session() {
      return rpc<SessionInfo>('auth.session')
    },
    logout() {
      return rpc<{ ok: boolean }>('auth.logout')
    },
    previewRole(role: string) {
      return rpc<SessionInfo>('auth.previewRole', { role })
    },
    changePassword(currentPassword: string, newPassword: string) {
      return rpc<{ updated: boolean }>('auth.changePassword', { currentPassword, newPassword })
    }
  },
  dashboard: {
    async get() {
      const data = await rpc<Omit<DashboardData, 'products'> & { products: ApiProduct[] }>('dashboard.get')
      return { ...data, products: hydrateProducts(data.products) }
    },
    badges() {
      return rpc<{ openOrders: number; lowStock: number }>('dashboard.badges')
    }
  },
  notifications: {
    list() {
      return rpc<DashboardData['notifications']>('notifications.list')
    }
  },
  customers: {
    list() {
      return rpc<Customer[]>('customers.list')
    },
    create(input: {
      name: string
      document: string
      documentType: string
      phone?: string
      email?: string
      address?: string
    }) {
      return rpc<Customer>('customers.create', input as unknown as Record<string, unknown>)
    },
    detail(id: string) {
      return rpc<CustomerDetail>('customers.detail', { id })
    }
  },
  inventory: {
    async list() {
      return hydrateProducts(await rpc<ApiProduct[]>('inventory.list'))
    },
    movements(productId: string) {
      return rpc<StockMovement[]>('inventory.movements', { productId })
    },
    async create(input: Record<string, unknown>) {
      return hydrateProduct(await rpc<ApiProduct>('inventory.create', input))
    },
    async adjust(productId: string, quantity: number, reason: string) {
      return hydrateProduct(await rpc<ApiProduct>('inventory.adjust', { productId, quantity, reason }))
    }
  },
  orders: {
    technicians() {
      return rpc<TechnicianOption[]>('orders.technicians')
    },
    list() {
      return rpc<WorkOrder[]>('orders.list')
    },
    get(id: string) {
      return rpc<WorkOrder>('orders.get', { id })
    },
    create(input: NewOrderInput) {
      return rpc<WorkOrder>('orders.create', input as unknown as Record<string, unknown>)
    },
    reassignTechnician(id: string, technicianId: string, reason: string) {
      return rpc<WorkOrder>('orders.reassignTechnician', { id, technicianId, reason })
    },
    update(id: string, input: { diagnosis?: string; notes?: string; promisedAt?: string }) {
      return rpc<WorkOrder>('orders.update', { id, ...input })
    },
    transition(id: string, status: string, input: { diagnosis?: string; reason?: string } = {}) {
      return rpc<WorkOrder>('orders.transition', { id, status, ...input })
    },
    addItem(id: string, item: Omit<OrderItemInput, 'id'>) {
      return rpc<WorkOrder>('orders.addItem', { id, ...item })
    },
    addPayment(id: string, input: { amount: number; method: PaymentMethod; reference?: string }) {
      return rpc<WorkOrder>('orders.addPayment', { id, ...input })
    },
    settle(input: SettleInput) {
      return rpc<WorkOrder>('orders.settle', input as unknown as Record<string, unknown>)
    }
  },
  evidence: {
    add(orderId: string, images: EvidenceInput[], stage: EvidenceStage = 'reparacion') {
      return rpc<WorkOrder>('evidence.add', { orderId, images, stage })
    },
    void(id: string, reason: string) {
      return rpc<WorkOrder>('evidence.void', { id, reason })
    },
    verify(id: string) {
      return rpc<WorkOrder>('evidence.verify', { id })
    },
    export(orderId: string) {
      return rpc<{
        filename: string
        mimeType: string
        base64: string
        size: number
        count: number
        sha256: string
      }>('evidence.export', { orderId })
    }
  },
  pos: {
    sell(input: PosSaleInput) {
      return rpc<{ invoice: Invoice; receipt: SaleReceipt }>('pos.sell', input as unknown as Record<string, unknown>)
    }
  },
  invoices: {
    list() {
      return rpc<Invoice[]>('invoices.list')
    },
    annul(id: string, reason: string) {
      return rpc<Invoice>('invoices.annul', { id, reason })
    }
  },
  cash: {
    current() {
      return rpc<CashCurrentResponse>('cash.current')
    },
    open(initialAmount: number) {
      return rpc<CashSession>('cash.open', { initialAmount })
    },
    addMovement(input: { type: 'ingreso' | 'egreso'; method: PaymentMethod; amount: number; reason: string }) {
      return rpc<CashSession>('cash.addMovement', input as unknown as Record<string, unknown>)
    },
    close(counted: number, notes?: string) {
      return rpc<CashSession>('cash.close', { counted, notes })
    }
  },
  purchases: {
    list() {
      return rpc<{ purchases: Purchase[]; suppliers: Supplier[] }>('purchases.list')
    },
    suppliers() {
      return rpc<Supplier[]>('suppliers.list')
    },
    create(input: Record<string, unknown>) {
      return rpc<Purchase>('purchases.create', input)
    }
  },
  suppliers: {
    create(input: { name: string; nit?: string; contact?: string; phone?: string; category?: string }) {
      return rpc<Supplier>('suppliers.create', input as unknown as Record<string, unknown>)
    },
    update(id: string, input: { name?: string; nit?: string; contact?: string; phone?: string; category?: string; active?: boolean }) {
      return rpc<Supplier>('suppliers.update', { id, ...input })
    }
  },
  reports: {
    summary(period: 'hoy' | '7d' | '30d' | 'ano') {
      return rpc<ReportData>('reports.summary', { period })
    }
  },
  audit: {
    list() {
      return rpc<AuditEvent[]>('audit.list')
    },
    verify() {
      return rpc<{ valid: boolean; brokenAt: string | null; checked: number }>('audit.verify')
    }
  },
  settings: {
    get() {
      return rpc<SettingsData>('settings.get')
    },
    updateSection(section: 'print' | 'ai' | 'security' | 'business', value: Record<string, unknown>) {
      return rpc<SettingsData>('settings.updateSection', { section, value })
    }
  },
  legal: {
    get() {
      return rpc<LegalConfig>('legal.get')
    },
    update(input: Partial<LegalConfig>) {
      return rpc<LegalConfig>('legal.update', input as Record<string, unknown>)
    }
  },
  users: {
    list() {
      return rpc<AppUser[]>('users.list')
    },
    create(input: Record<string, unknown>) {
      return rpc<AppUser>('users.create', input)
    },
    update(id: string, input: Record<string, unknown>) {
      return rpc<AppUser>('users.update', { id, ...input })
    }
  },
  backups: {
    list() {
      return rpc<BackupRecord[]>('backups.list')
    },
    create() {
      return rpc<{ backup: BackupRecord; backups: BackupRecord[] }>('backups.create')
    },
    restore(id: string) {
      return rpc<{ restored: boolean; safetyBackup: string; requiresReload: boolean; format?: 'folder' | 'db' }>('backups.restore', { id })
    },
    purge(confirmation: string, password: string) {
      return rpc<{ purged: boolean; backup: BackupRecord; requiresReload: boolean }>('backups.purge', { confirmation, password })
    }
  },
  appInfo() {
    return window.bitacoretech?.appInfo()
  }
}

export function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Ocurrió un error inesperado.'
}

export type ChartDataPoint = ChartPoint
