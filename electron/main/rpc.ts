import fs from 'node:fs'
import path from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { dialog, safeStorage } from 'electron'
import { z } from 'zod'
import type { Database } from './database'
import {
  BACKUP_DATABASE_FILENAME,
  BACKUP_FOLDER,
  EVIDENCE_FOLDER,
  closeDatabase,
  db as activeDb,
  getBackupPath,
  getEvidencePath,
  openDatabase
} from './database'
import { DEFAULT_LEGAL, DEFAULT_SETTINGS, STATUS_CONFIG, type LegalConfig } from './defaults'
import {
  cleanupEvidenceFiles,
  evidenceDto,
  evidenceSetHash,
  insertEvidenceRows,
  prepareEvidenceFiles,
  resolveEvidenceFile
} from './evidence'
import { createZip } from './zip'
import {
  auditDto,
  cashMovementDto,
  cashSessionDto,
  customerDto,
  equipmentDto,
  invoiceDto,
  money,
  orderDto,
  paymentDto,
  productDto,
  toCents
} from './mappers'
import {
  ALL_CAPABILITIES,
  ROOT_ONLY_CAPABILITIES,
  RpcError,
  can,
  capabilitiesForRole,
  requireCapability,
  requireModule,
  roleLabel,
  type BackendCapability
} from './permissions'
import { hashPassword, newToken, sha256, sha256Bytes, verifyPassword } from './security'
import { calculateNitDv, isValidNit, normalizeNit } from './nit'
import { runDemoSeed, type SeedOwner } from './seed'
import { generateDiagnosticReport, type ReportMode } from './diagnosticReport'
import { DICTIONARY_TYPES, type DictionaryType } from '@shared/index'

type Payload = Record<string, any>

interface Session {
  token: string
  tokenHash: string
  userId: string
  userName: string
  username: string
  email: string
  photoPath: string | null
  actualRole: string
  role: string
  expiresAt: string
}

interface Runtime {
  userDataPath: string
  version: string
}

const roleLabels: Record<string, string> = {
  superadmin: 'Propietario',
  admin: 'Administrador',
  tecnico: 'Técnico',
  cajero: 'Cajero'
}

const simulatedIdentity: Record<string, { username: string; name: string; email: string }> = {
  admin: { username: 'andrea.salazar', name: 'Andrea Salazar', email: 'andrea@bitacoretech.co' },
  tecnico: { username: 'julian.velez', name: 'Julián Vélez', email: 'julian@bitacoretech.co' },
  cajero: { username: 'camila.restrepo', name: 'Camila Restrepo', email: 'camila@bitacoretech.co' }
}

const loginAttempts = new Map<string, { fails: number; blockedUntil: number }>()
const STATUS_FLOW = ['recibido', 'diagnostico', 'aprobacion', 'reparacion', 'pruebas', 'listo', 'entregado']

function fail(message: string, code = 'BAD_REQUEST'): never {
  throw new RpcError(message, code)
}

function schema<T>(value: unknown, validator: z.ZodType<T>): T {
  const parsed = validator.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    fail(issue?.message || 'Datos inválidos')
  }
  return parsed.data
}

function text(value: unknown, field: string, min = 1, max = 2000) {
  if (typeof value !== 'string') fail(`${field} es obligatorio`)
  const trimmed = value.trim()
  if (trimmed.length < min) fail(`${field} es obligatorio`)
  if (trimmed.length > max) fail(`${field} es demasiado largo`)
  return trimmed
}

function numberValue(value: unknown, field: string, options: { min?: number; max?: number; integer?: boolean } = {}) {
  const parsed = typeof value === 'string' ? Number(value.replace(/[^0-9.-]/g, '')) : Number(value)
  if (!Number.isFinite(parsed)) fail(`${field} debe ser numérico`)
  if (options.min !== undefined && parsed < options.min) fail(`${field} no puede ser menor a ${options.min}`)
  if (options.max !== undefined && parsed > options.max) fail(`${field} no puede ser mayor a ${options.max}`)
  if (options.integer && !Number.isInteger(parsed)) fail(`${field} debe ser entero`)
  return parsed
}

function isoDate(value: unknown, field: string) {
  const raw = text(value, field)
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) fail(`${field} no contiene una fecha válida`)
  return date.toISOString()
}

function currentSession() {
  return activeDb()
}

function getLegal(db: Database): LegalConfig {
  return db.getSetting<LegalConfig>('legal_config', DEFAULT_LEGAL)
}

function resolveClause(value: string, config: LegalConfig) {
  return value.replace(/\{\{dias\}\}/g, String(config.abandonmentDays)).replace(/\{\{garantia\}\}/g, String(config.warrantyDays))
}

function createSnapshot(db: Database, acceptedAt: string) {
  const config = getLegal(db)
  return {
    version: config.version,
    acceptedAt,
    abandonmentDays: config.abandonmentDays,
    warrantyDays: config.warrantyDays,
    shortClauses: config.shortClauses.map((clause) => resolveClause(clause, config)),
    fullClauses: config.fullClauses.map((clause) => resolveClause(clause, config))
  }
}

function baseSession(db: Database, row: any) {
  return {
    userId: row.user_id,
    userName: row.name,
    username: row.username,
    email: row.email ?? '',
    photoPath: row.photo_path ?? null,
    actualRole: row.role,
    role: row.effective_role,
    expiresAt: row.expires_at
  }
}

function resolveSession(db: Database, token: string): Session {
  if (!token) fail('Sesión requerida', 'UNAUTHENTICATED')
  const tokenHash = sha256(token)
  const row = db.get<any>(
    `SELECT s.token_hash, s.user_id, s.effective_role, s.expires_at,
            u.name, u.username, u.email, u.role, u.photo_path
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND u.active = 1`,
    tokenHash
  )
  if (!row) fail('La sesión expiró. Inicia sesión nuevamente.', 'UNAUTHENTICATED')
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.run('DELETE FROM sessions WHERE token_hash = ?', tokenHash)
    fail('La sesión expiró. Inicia sesión nuevamente.', 'UNAUTHENTICATED')
  }
  const base = baseSession(db, row)
  return { ...base, token, tokenHash } as Session
}

function displayUser(session: Session) {
  if (session.role === session.actualRole || session.actualRole !== 'superadmin') {
    return {
      id: session.userId,
      username: session.username,
      name: session.userName,
      email: session.email,
      accountRole: session.actualRole,
      photoUrl: session.photoPath
    }
  }
  const identity = simulatedIdentity[session.role]
  if (!identity) {
    return {
      id: session.userId,
      username: session.username,
      name: session.userName,
      email: session.email,
      accountRole: session.role,
      photoUrl: null
    }
  }
  return { id: `preview_${session.role}`, ...identity, accountRole: session.role, photoUrl: null }
}

function sessionResponse(session: Session) {
  const db = currentSession()
  const permissions = effectiveCapabilities(
    db,
    session.userId,
    session.role,
    session.role !== session.actualRole
  )
  return {
    user: {
      id: session.userId,
      username: session.username,
      name: session.actualRole === 'superadmin' ? session.userName : displayUser(session).name,
      email: session.email,
      accountRole: session.actualRole,
      photoUrl: session.actualRole === 'superadmin' ? session.photoPath : displayUser(session).photoUrl ?? null
    },
    displayUser: displayUser(session),
    role: session.role,
    actualRole: session.actualRole,
    canPreviewRoles: session.actualRole === 'superadmin',
    expiresAt: session.expiresAt,
    roleLabel: roleLabels[session.role],
    permissions
  }
}

function actionIdentity(session: Session) {
  const user = displayUser(session)
  return { userId: session.userId, userName: user.name, role: roleLabel(session.role as any) }
}

function audit(db: Database, session: Session, action: string, entity: string, detail: string, entityId?: string | null) {
  const identity = actionIdentity(session)
  return db.appendAudit({
    userId: identity.userId,
    userName: identity.userName,
    role: identity.role,
    action,
    entity,
    entityId,
    detail
  })
}

function requireModuleAccess(session: Session, module: string) {
  requireModule(session.role as any, module)
}

function effectiveCapabilities(db: Database, userId: string, role: string, preview = false) {
  const roleRows = db.all<{ capability: string; allowed: number }>(
    'SELECT capability, allowed FROM role_permissions WHERE role = ?',
    role
  )
  const granted = new Set(
    roleRows.length
      ? roleRows.filter((row) => row.allowed).map((row) => row.capability as BackendCapability)
      : capabilitiesForRole(role as any)
  )
  if (!preview) {
    for (const row of db.all<{ capability: string; allowed: number }>(
      'SELECT capability, allowed FROM user_permission_overrides WHERE user_id = ?',
      userId
    )) {
      if (row.allowed) granted.add(row.capability as BackendCapability)
      else granted.delete(row.capability as BackendCapability)
    }
  }
  return ALL_CAPABILITIES.filter((capability) => granted.has(capability))
}

function hasCapability(db: Database, session: Session, capability: BackendCapability) {
  if (session.role !== session.actualRole) {
    const previewRole = db.get<{ allowed: number }>(
      'SELECT allowed FROM role_permissions WHERE role = ? AND capability = ?',
      session.role,
      capability
    )
    if (previewRole) return Boolean(previewRole.allowed)
    return capabilitiesForRole(session.role as any).includes(capability)
  }
  const override = db.get<{ allowed: number }>(
    'SELECT allowed FROM user_permission_overrides WHERE user_id = ? AND capability = ?',
    session.userId,
    capability
  )
  if (override) return Boolean(override.allowed)
  const rolePermission = db.get<{ allowed: number }>(
    'SELECT allowed FROM role_permissions WHERE role = ? AND capability = ?',
    session.role,
    capability
  )
  if (rolePermission) return Boolean(rolePermission.allowed)
  return can(session.role as any, capability)
}

function requireCap(session: Session, capability: BackendCapability) {
  if (!hasCapability(currentSession(), session, capability)) {
    throw new RpcError(
      `Tu rol (${roleLabel(session.role as any)}) no tiene permiso para esta acción.`,
      'FORBIDDEN'
    )
  }
}

function canSession(session: Session, capability: BackendCapability) {
  return hasCapability(currentSession(), session, capability)
}

function normalizeUserPhoto(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/i.test(value)) {
    fail('La foto debe ser una imagen PNG, JPEG o WebP.')
  }
  if (value.length > 500_000) fail('La foto es demasiado grande; usa una imagen de máximo 350 KB.')
  return value
}

function applyPermissionOverrides(
  db: Database,
  session: Session,
  userId: string,
  targetRole: string,
  permissions: unknown
) {
  if (!Array.isArray(permissions)) return
  if (targetRole === 'superadmin') fail('La cuenta raíz no admite permisos especiales.', 'FORBIDDEN')
  const actorCapabilities = new Set(
    effectiveCapabilities(db, session.userId, session.role, session.role !== session.actualRole)
  )
  const parsed = permissions.map((item: any) => {
    const capability = schema(item?.capability, z.string().min(1).max(80)) as BackendCapability
    if (!ALL_CAPABILITIES.includes(capability)) fail(`Permiso desconocido: ${capability}`)
    if (typeof item?.allowed !== 'boolean') fail('Cada permiso debe indicar allow o deny.')
    if (session.actualRole !== 'superadmin') {
      if (ROOT_ONLY_CAPABILITIES.includes(capability)) {
        fail(`El permiso ${capability} es exclusivo del propietario.`, 'FORBIDDEN')
      }
      if (item.allowed && !actorCapabilities.has(capability)) {
        fail('No puedes conceder un permiso que tu propia cuenta no tiene.', 'FORBIDDEN')
      }
    }
    return {
      capability,
      allowed: item.allowed ? 1 : 0,
      reason: typeof item.reason === 'string' ? item.reason.slice(0, 300) : null
    }
  })
  db.run('DELETE FROM user_permission_overrides WHERE user_id = ?', userId)
  const now = new Date().toISOString()
  for (const item of parsed) {
    db.run(
      `INSERT INTO user_permission_overrides
        (user_id, capability, allowed, reason, granted_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      userId,
      item.capability,
      item.allowed,
      item.reason,
      session.userId,
      now,
      now
    )
  }
}

function currentCashSession(db: Database) {
  return db.get<any>("SELECT * FROM cash_sessions WHERE status = 'abierto' ORDER BY opened_at DESC LIMIT 1")
}

function requireCashSession(db: Database) {
  const session = currentCashSession(db)
  if (!session) fail('No hay un turno de caja abierto. Abre caja antes de registrar dinero.', 'CASH_CLOSED')
  return session
}

function recordCash(
  db: Database,
  session: Session,
  options: {
    type: 'ingreso' | 'egreso' | 'venta'
    method: 'Efectivo' | 'Transferencia' | 'Tarjeta' | 'Mixto'
    amountCents: number
    reason: string
    referenceType?: string
    referenceId?: string
    createdAt?: string
    sessionId?: string | null
  }
) {
  const cashSession = requireCashSession(db)
  db.run(
    `INSERT INTO cash_movements
      (id, session_id, type, method, amount_cents, reason, reference_type, reference_id, user_id, user_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    `cash_${sha256(`${Date.now()}|${Math.random()}`).slice(0, 20)}`,
    options.sessionId === undefined ? cashSession.id : options.sessionId,
    options.type,
    options.method,
    options.amountCents,
    options.reason,
    options.referenceType ?? null,
    options.referenceId ?? null,
    session.userId,
    displayUser(session).name,
    options.createdAt ?? new Date().toISOString()
  )
}

function getOrderOrFail(db: Database, id: string) {
  const row = db.get<any>(
    `SELECT w.*, c.name AS customer_name
     FROM work_orders w JOIN customers c ON c.id = w.customer_id
     WHERE w.id = ? OR w.number = ?`,
    id,
    id
  )
  if (!row) fail('Orden de trabajo no encontrada', 'NOT_FOUND')
  return row
}

function canManageOrderCredentials(session: Session, row: any) {
  if (session.actualRole === 'admin' || session.actualRole === 'superadmin') return true
  return session.actualRole === 'tecnico' && row.technician_id === session.userId
}

function requireCredentialAccess(session: Session, row: any) {
  if (!canManageOrderCredentials(session, row)) {
    fail('Solo el técnico asignado, un administrador o el propietario pueden acceder a las credenciales.', 'FORBIDDEN')
  }
}

function encryptCredentials(payload: any, kind: string) {
  if (!safeStorage.isEncryptionAvailable()) {
    fail('El almacén seguro de Windows no está disponible; no se pueden guardar credenciales.')
  }
  const secret = text(payload?.secret, 'Contraseña del equipo', 1, 500)
  const username =
    typeof payload?.username === 'string' && payload.username.trim()
      ? payload.username.trim().slice(0, 120)
      : ''
  const note =
    typeof payload?.note === 'string' && payload.note.trim() ? payload.note.trim().slice(0, 500) : ''
  return safeStorage.encryptString(JSON.stringify({ kind, username, secret, note })).toString('base64')
}

function writeOrderCredentials(
  db: Database,
  session: Session,
  orderId: string,
  orderNumber: string,
  kind: string,
  payload: any
) {
  const encrypted = encryptCredentials(payload, kind)
  const now = new Date().toISOString()
  const actorName = displayUser(session).name
  db.run(
    `INSERT INTO work_order_credentials
      (id, work_order_id, payload_encrypted, created_by, created_by_name, created_at,
       updated_by, updated_by_name, updated_at, view_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(work_order_id) DO UPDATE SET
       payload_encrypted = excluded.payload_encrypted,
       updated_by = excluded.updated_by,
       updated_by_name = excluded.updated_by_name,
       updated_at = excluded.updated_at`,
    `cred_${sha256(`${orderId}|${Date.now()}`).slice(0, 20)}`,
    orderId,
    encrypted,
    session.userId,
    actorName,
    now,
    session.userId,
    actorName,
    now
  )
  audit(db, session, 'Credenciales de equipo guardadas', 'Orden de trabajo', `${orderNumber} · ${kind}`, orderId)
}

function purgeOrderCredentials(db: Database, session: Session, orderId: string, orderNumber: string, reason: string) {
  const row = db.get<any>('SELECT id FROM work_order_credentials WHERE work_order_id = ?', orderId)
  if (!row) return
  db.run('DELETE FROM work_order_credentials WHERE work_order_id = ?', orderId)
  audit(db, session, 'Credenciales de equipo eliminadas', 'Orden de trabajo', `${orderNumber} · ${reason}`, orderId)
}

function technicianOptions(db: Database) {
  return db.all<{ id: string; name: string }>(
    "SELECT id, name FROM users WHERE active = 1 AND role IN ('tecnico', 'admin') ORDER BY role = 'tecnico' DESC, name ASC"
  )
}

function getEvidenceOrFail(db: Database, id: string) {
  const row = db.get<any>(
    `SELECT e.*, w.number AS order_number
     FROM work_order_evidence e JOIN work_orders w ON w.id = e.work_order_id
     WHERE e.id = ?`,
    id
  )
  if (!row) fail('Evidencia fotográfica no encontrada', 'NOT_FOUND')
  return row
}

function evidenceBytesForOrder(db: Database, orderId: string) {
  return (
    db.get<{ total: number }>(
      "SELECT COALESCE(SUM(size_bytes), 0) AS total FROM work_order_evidence WHERE work_order_id = ? AND status = 'activa'",
      orderId
    )?.total ?? 0
  )
}

function orderItemsTotal(db: Database, orderId: string) {
  return (
    db.get<{ total: number }>(
      'SELECT COALESCE(SUM(unit_price_cents * quantity), 0) AS total FROM work_order_items WHERE work_order_id = ?',
      orderId
    )?.total ?? 0
  )
}

function orderPaidTotal(db: Database, orderId: string) {
  return db.get<{ total: number }>('SELECT COALESCE(SUM(amount_cents), 0) AS total FROM payments WHERE order_id = ?', orderId)?.total ?? 0
}

function loyaltyDiscountFor(customer: any) {
  if (!customer?.loyalty_active) return null
  if (customer.loyalty_valid_until) {
    const until = new Date(`${customer.loyalty_valid_until}T23:59:59`).getTime()
    if (Number.isFinite(until) && until < Date.now()) return null
  }
  const type = customer.loyalty_discount_type === 'amount' ? 'amount' : 'percent'
  const value = Number(customer.loyalty_discount_value ?? 0)
  if (!Number.isFinite(value) || value <= 0) return null
  return { type: type as 'percent' | 'amount', value, source: 'loyalty' as const }
}

function resolveSaleDiscount(
  customer: any,
  payload: Payload,
  session: Session,
  subtotalCents: number
) {
  const loyalty = loyaltyDiscountFor(customer)
  if (loyalty) return loyalty
  const type = schema(payload?.discountType ?? 'percent', z.enum(['percent', 'amount']))
  const rawValue =
    payload?.discountValue !== undefined
      ? numberValue(payload.discountValue, 'Descuento', { min: 0 })
      : numberValue(payload?.discountPercent ?? 0, 'Descuento', { min: 0, max: 100 })
  if (type === 'percent' && rawValue > 100) fail('El descuento no puede superar el 100 %.')
  if (rawValue > 0) requireCap(session, 'applyDiscount')
  return { type, value: rawValue, source: rawValue > 0 ? ('manual' as const) : ('none' as const) }
}

function discountCentsFor(type: 'percent' | 'amount', value: number, subtotalCents: number) {
  const cents = type === 'percent' ? Math.round((subtotalCents * value) / 100) : toCents(value)
  return Math.min(Math.max(cents, 0), subtotalCents)
}

function assertDiscountFloor(
  lines: Array<{ name: string; quantity: number; unitPriceCents: number; unitCostCents: number; isService?: boolean }>,
  subtotalCents: number,
  discountCents: number
) {
  if (!discountCents || !subtotalCents) return
  for (const line of lines) {
    if (line.isService) continue
    const lineTotal = line.unitPriceCents * line.quantity
    const allocated = Math.round((discountCents * lineTotal) / subtotalCents)
    const net = lineTotal - allocated
    const cost = line.unitCostCents * line.quantity
    if (net < cost) {
      fail(
        `El descuento deja ${line.name} por debajo del costo de compra. Ajusta el descuento o requiere autorización del propietario.`,
        'DISCOUNT_BELOW_COST'
      )
    }
  }
}

function createOrderInvoice(
  db: Database,
  session: Session,
  order: any,
  subtotalCents: number,
  totalCents: number,
  method: string,
  isException = false,
  exceptionReason = '',
  discount: { type: 'percent' | 'amount'; value: number; cents: number } = {
    type: 'percent',
    value: 0,
    cents: 0
  }
) {
  const number = db.invoiceNumber()
  const id = `inv_${sha256(`${order.id}|${number}`).slice(0, 20)}`
  const name = displayUser(session).name
  db.run(
    `INSERT INTO invoices
      (id, number, type, customer_id, customer_name, order_id, subtotal_cents, discount_percent, discount_type,
       discount_value, discount_cents, total_cents, payment_method, status, notes, created_by, created_at)
     VALUES (?, ?, 'ot', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'activa', ?, ?, ?)`,
    id,
    number,
    order.customer_id,
    order.customer_name,
    order.id,
    subtotalCents,
    discount.type === 'percent' ? discount.value : 0,
    discount.type,
    discount.value,
    discount.cents,
    totalCents,
    isException ? null : method,
    isException ? `Excepción: ${exceptionReason} · Autorizado por ${name}` : null,
    session.userId,
    new Date().toISOString()
  )
  const items = db.all<any>('SELECT * FROM work_order_items WHERE work_order_id = ? ORDER BY rowid ASC', order.id)
  if (items.length) {
    for (const item of items) {
      db.run(
        `INSERT INTO invoice_items
          (id, invoice_id, product_id, description, quantity, unit_price_cents, unit_cost_cents, line_total_cents, item_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `ii_${sha256(`${id}|${item.id}`).slice(0, 20)}`,
        id,
        item.product_id,
        item.description,
        item.quantity,
        item.unit_price_cents,
        item.unit_cost_cents,
        Math.round(item.unit_price_cents * item.quantity),
        item.type
      )
    }
  } else if (totalCents > 0) {
    db.run(
      `INSERT INTO invoice_items
        (id, invoice_id, product_id, description, quantity, unit_price_cents, unit_cost_cents, line_total_cents, item_type)
       VALUES (?, ?, NULL, 'Presupuesto de ingreso aprobado', 1, ?, 0, ?, 'servicio')`,
      `ii_${sha256(id).slice(0, 20)}`,
      id,
      totalCents,
      totalCents
    )
  }
  return { id, number }
}

function getInvoiceRow(db: Database, id: string) {
  return db.get<any>('SELECT * FROM invoices WHERE id = ? OR number = ?', id, id)
}

function legalPublic(db: Database) {
  return getLegal(db)
}

function settingsData(db: Database) {
  return {
    legal: getLegal(db),
    print: db.getSetting('print_config', DEFAULT_SETTINGS.print),
    ai: db.getSetting('ai_config', DEFAULT_SETTINGS.ai),
    security: db.getSetting('security_config', DEFAULT_SETTINGS.security),
    business: db.getSetting('business_config', DEFAULT_SETTINGS.business),
    equipment: db.getSetting('equipment_config', DEFAULT_SETTINGS.equipment),
    messages: db.getSetting('messages_config', DEFAULT_SETTINGS.messages),
    backup: { passwordConfigured: backupPasswordConfigured(db) },
    rolePermissions: db
      .all<{ role: string; capability: string; allowed: number }>(
        'SELECT role, capability, allowed FROM role_permissions ORDER BY role ASC, capability ASC'
      )
      .map((row) => ({ role: row.role, capability: row.capability, allowed: Boolean(row.allowed) })),
    statuses: db.all<any>('SELECT * FROM order_status_config ORDER BY position ASC').map((row) => ({
      status: row.status,
      label: row.label,
      shortLabel: row.short_label,
      description: row.description,
      tone: row.tone,
      position: row.position,
      isTerminal: Boolean(row.is_terminal),
      requiresPayment: Boolean(row.requires_payment),
      isCancel: Boolean(row.is_cancel)
    }))
  }
}

function userDto(db: Database, row: any) {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    email: row.email,
    role: row.role,
    roleLabel: roleLabels[row.role],
    status: row.active ? 'Activa' : 'Inactiva',
    active: Boolean(row.active),
    lastAccess: row.last_login_at ?? 'Sin acceso',
    protected: Boolean(row.is_protected),
    createdAt: row.created_at,
    documentType: row.document_type ?? null,
    document: row.document ?? null,
    phone: row.phone ?? null,
    address: row.address ?? null,
    photoUrl: row.photo_path ?? null,
    permissionOverrides: db
      .all<{ capability: string; allowed: number; reason: string | null }>(
        'SELECT capability, allowed, reason FROM user_permission_overrides WHERE user_id = ? ORDER BY capability ASC',
        row.id
      )
      .map((item) => ({
        capability: item.capability,
        allowed: Boolean(item.allowed),
        reason: item.reason ?? ''
      }))
  }
}

function listUsers(db: Database, viewerRole: string) {
  const rows = db.all<any>('SELECT * FROM users ORDER BY is_protected DESC, created_at ASC')
  return rows
    .filter((row) => viewerRole === 'superadmin' || row.role !== 'superadmin')
    .map((row) => userDto(db, row))
}

const DICTIONARY_TYPE_VALUES = DICTIONARY_TYPES.map((item) => item.value) as [DictionaryType, ...DictionaryType[]]

function supportsCustomBuild(category: string) {
  return category === 'pc_torre' || category === 'otro'
}

function customBuildSerial(seed: string) {
  return `ARM-${sha256(seed).slice(0, 8).toUpperCase()}`
}

function dictionaryUsageCount(db: Database, row: any) {
  if (row.type === 'inventory_category') {
    return Number(db.get<{ count: number }>('SELECT COUNT(*) AS count FROM products WHERE category = ?', row.name)?.count ?? 0)
  }
  if (row.type === 'inventory_location') {
    return Number(db.get<{ count: number }>('SELECT COUNT(*) AS count FROM products WHERE location = ?', row.name)?.count ?? 0)
  }
  if (row.type === 'supplier_category') {
    return Number(db.get<{ count: number }>('SELECT COUNT(*) AS count FROM suppliers WHERE category = ?', row.name)?.count ?? 0)
  }
  if (row.type === 'service_type') {
    return Number(db.get<{ count: number }>('SELECT COUNT(*) AS count FROM products WHERE service_type = ?', row.name)?.count ?? 0)
  }
  if (row.type === 'device_type') {
    return Number(
      db.get<{ count: number }>('SELECT COUNT(*) AS count FROM work_orders WHERE category_label = ?', row.name)?.count ?? 0
    )
  }
  return 0
}

function dictionaryNodeDto(db: Database, row: any) {
  return {
    id: row.id,
    parentId: row.parent_id ?? null,
    type: row.type,
    code: row.code ?? null,
    name: row.name,
    sortOrder: Number(row.sort_order),
    active: Boolean(row.active),
    system: Boolean(row.system),
    usageCount: dictionaryUsageCount(db, row),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function dictionaryDescendants(db: Database, id: string) {
  return db
    .all<{ id: string }>(
      `WITH RECURSIVE descendants(id) AS (
         SELECT id FROM dictionary_nodes WHERE parent_id = ?
         UNION ALL
         SELECT node.id FROM dictionary_nodes node JOIN descendants parent ON node.parent_id = parent.id
       )
       SELECT id FROM descendants`,
      id
    )
    .map((item) => item.id)
}

function supplierDto(db: Database, row: any) {
  const purchases = db.get<{ count: number }>('SELECT COUNT(*) AS count FROM purchases WHERE supplier_id = ?', row.id)?.count ?? 0
  return {
    id: row.id,
    name: row.name,
    nit: row.nit,
    nitDv: !row.is_foreign_nit && row.nit && row.nit !== '—' ? calculateNitDv(row.nit) : undefined,
    isForeignNit: Boolean(row.is_foreign_nit),
    contact: row.contact,
    phone: row.phone,
    category: row.category,
    purchases: Number(purchases)
  }
}

function purchaseDto(db: Database, row: any) {
  const supplier = db.get<{ name: string; nit: string; is_foreign_nit: number }>(
    'SELECT name, nit, is_foreign_nit FROM suppliers WHERE id = ?',
    row.supplier_id
  )
  const supplierNitDv =
    supplier && !supplier.is_foreign_nit && supplier.nit && supplier.nit !== '—'
      ? calculateNitDv(supplier.nit)
      : undefined
  const lines = db
    .all<any>('SELECT * FROM purchase_items WHERE purchase_id = ? ORDER BY rowid ASC', row.id)
    .map((line) => ({
      id: line.id,
      productId: line.product_id ?? null,
      description: line.description,
      quantity: Number(line.quantity),
      unitPrice: money(line.unit_price_cents),
      lineTotal: money(Number(line.unit_price_cents) * Number(line.quantity))
    }))
  return {
    id: row.id,
    number: row.number,
    supplierId: row.supplier_id,
    supplier: supplier?.name ?? 'Proveedor',
    supplierNit: supplier?.nit ?? '—',
    supplierNitDv,
    date: row.purchase_date,
    items: row.item_count,
    subtotal: money(row.subtotal_cents),
    iva: money(row.iva_cents),
    total: money(row.total_cents),
    status: row.status,
    notes: row.notes ?? null,
    lines
  }
}

function parsePeriod(value: string) {
  const now = new Date()
  if (value === 'hoy') {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    return start
  }
  if (value === '7d') return new Date(now.getTime() - 7 * 86400000)
  if (value === 'ano') return new Date(now.getFullYear(), 0, 1)
  return new Date(now.getTime() - 30 * 86400000)
}

function monthlyChartData(db: Database) {
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  const now = new Date()
  const points: Array<{ month: string; income: number; expenses: number }> = []
  for (let offset = 11; offset >= 0; offset -= 1) {
    const start = new Date(now.getFullYear(), now.getMonth() - offset, 1)
    const end = new Date(now.getFullYear(), now.getMonth() - offset + 1, 1)
    const startIso = start.toISOString()
    const endIso = end.toISOString()
    const income =
      db.get<{ total: number }>(
        "SELECT COALESCE(SUM(total_cents), 0) AS total FROM invoices WHERE status = 'activa' AND datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?)",
        startIso,
        endIso
      )?.total ?? 0
    const purchases =
      db.get<{ total: number }>(
        'SELECT COALESCE(SUM(total_cents), 0) AS total FROM purchases WHERE purchase_date >= ? AND purchase_date < ?',
        startIso.slice(0, 10),
        endIso.slice(0, 10)
      )?.total ?? 0
    const expenses =
      db.get<{ total: number }>(
        "SELECT COALESCE(SUM(amount_cents), 0) AS total FROM cash_movements WHERE type = 'egreso' AND datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?)",
        startIso,
        endIso
      )?.total ?? 0
    points.push({
      month: months[start.getMonth()],
      income: money(income),
      expenses: money(purchases + expenses)
    })
  }
  return points
}

function reportData(db: Database, session: Session, period: string) {
  const start = parsePeriod(period)
  const invoices = db.all<any>(
    "SELECT * FROM invoices WHERE status = 'activa' AND datetime(created_at) >= datetime(?) ORDER BY created_at DESC",
    start.toISOString()
  )
  const invoiceIds = invoices.map((invoice) => invoice.id)
  const payments = db.all<any>(
    "SELECT * FROM payments WHERE datetime(created_at) >= datetime(?)",
    start.toISOString()
  )
  const expenses = db.all<any>(
    "SELECT * FROM cash_movements WHERE type = 'egreso' AND datetime(created_at) >= datetime(?)",
    start.toISOString()
  )
  const purchases = db.all<any>(
    "SELECT * FROM purchases WHERE datetime(purchase_date) >= datetime(?)",
    start.toISOString()
  )
  let cogsCents = 0
  let items: any[] = []
  if (invoiceIds.length) {
    const placeholders = invoiceIds.map(() => '?').join(',')
    items = db.all<any>(`SELECT * FROM invoice_items WHERE invoice_id IN (${placeholders})`, ...invoiceIds)
    cogsCents = items.reduce((sum, item) => sum + Number(item.unit_cost_cents) * Number(item.quantity), 0)
  }
  const salesCents = invoices.reduce((sum, invoice) => sum + Number(invoice.total_cents), 0)
  const grossCents = salesCents - cogsCents
  const expenseCents = expenses.reduce((sum, movement) => sum + Number(movement.amount_cents), 0)
  const netCents = grossCents - expenseCents
  const ivaCents = purchases.reduce((sum, purchase) => sum + Number(purchase.iva_cents), 0)
  const purchaseCents = purchases.reduce((sum, purchase) => sum + Number(purchase.total_cents), 0)
  const canGross = canSession(session, 'viewGrossMargin')
  const canNet = canSession(session, 'viewNetProfit')

  const methods = ['Efectivo', 'Tarjeta', 'Transferencia', 'Mixto']
  const colors = ['#12B76A', '#6C5CE7', '#0EA5E9', '#F79009']
  const paymentData = methods
    .map((method, index) => ({
      name: method,
      value: invoices
        .filter((invoice) => invoice.payment_method === method)
        .reduce((sum, invoice) => sum + Number(invoice.total_cents), 0) / 100,
      color: colors[index]
    }))
    .filter((item) => item.value > 0)

  const topMap = new Map<string, { name: string; units: number; revenue: number; cost: number }>()
  for (const item of items) {
    const current = topMap.get(item.description) ?? { name: item.description, units: 0, revenue: 0, cost: 0 }
    current.units += Number(item.quantity)
    current.revenue += Number(item.line_total_cents)
    current.cost += Number(item.unit_cost_cents) * Number(item.quantity)
    topMap.set(item.description, current)
  }
  const topProducts = [...topMap.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)
    .map((row) => ({
      name: row.name,
      units: row.units,
      revenue: money(row.revenue),
      margin: canGross ? money(row.revenue - row.cost) : null,
      marginPercent: canGross && row.revenue > 0 ? Math.round(((row.revenue - row.cost) / row.revenue) * 100) : null
    }))

  const categoryMap = new Map<string, number>()
  for (const item of items) {
    let category = 'Servicios'
    if (item.product_id) {
      const product = db.get<{ category: string }>('SELECT category FROM products WHERE id = ?', item.product_id)
      category = product?.category ?? 'Otros'
    }
    categoryMap.set(category, (categoryMap.get(category) ?? 0) + Number(item.line_total_cents))
  }
  const categoryColors = ['#6C5CE7', '#0EA5E9', '#12B76A', '#F79009', '#98A2B3', '#F04438']
  const categoryData = [...categoryMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, cents], index) => ({ name, value: money(cents), color: categoryColors[index % categoryColors.length] }))

  const workOrders = db.all<any>('SELECT * FROM work_orders ORDER BY created_at DESC')
  const techMap = new Map<string, { total: number; open: number; closed: number }>()
  for (const order of workOrders) {
    const tech = db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', order.technician_id)?.name ?? 'Sin asignar'
    const current = techMap.get(tech) ?? { total: 0, open: 0, closed: 0 }
    current.total += 1
    if (['entregado', 'no_reparado'].includes(order.status)) current.closed += 1
    else current.open += 1
    techMap.set(tech, current)
  }
  const technicianStats = [...techMap.entries()].map(([name, stats]) => ({
    name,
    total: stats.total,
    open: stats.open,
    closed: stats.closed,
    load: Math.round((stats.open / Math.max(stats.total, 1)) * 100)
  }))

  const chartData = monthlyChartData(db)

  return {
    period,
    salesTotal: money(salesCents),
    invoiceCount: invoices.length,
    avgTicket: invoices.length ? money(Math.round(salesCents / invoices.length)) : 0,
    grossMargin: canGross ? money(grossCents) : null,
    grossMarginPercent: canGross && salesCents ? Math.round((grossCents / salesCents) * 1000) / 10 : null,
    netProfit: canNet ? money(netCents) : null,
    expenses: money(expenseCents),
    ivaSoportado: money(ivaCents),
    purchasesTotal: money(purchaseCents),
    chartData,
    paymentData,
    categoryData,
    topProducts,
    technicianStats,
    invoices: invoices.slice(0, 50).map((invoice) => invoiceDto(db, invoice)),
    payments: payments.slice(0, 50).map(paymentDto),
    permissions: { grossMargin: canGross, netProfit: canNet }
  }
}

function requireCapabilitySoft(role: string, capability: BackendCapability) {
  return can(role as any, capability)
}
function notificationData(db: Database) {
  const low = db.get<{ count: number }>(
    'SELECT COUNT(*) AS count FROM products WHERE active = 1 AND is_service = 0 AND alert_enabled = 1 AND stock > 0 AND stock <= min_stock'
  )?.count ?? 0
  const out = db.get<{ count: number }>(
    'SELECT COUNT(*) AS count FROM products WHERE active = 1 AND is_service = 0 AND alert_enabled = 1 AND stock <= 0'
  )?.count ?? 0
  const ready = db.get<{ count: number }>("SELECT COUNT(*) AS count FROM work_orders WHERE status = 'listo'")?.count ?? 0
  const pending = db.get<{ count: number }>("SELECT COUNT(*) AS count FROM purchases WHERE status = 'pendiente'")?.count ?? 0
  const cash = currentCashSession(db)
  const data: any[] = []
  if (low + out > 0) {
    data.push({
      id: 'stock',
      title: `Stock bajo en ${low + out} producto${low + out === 1 ? '' : 's'}`,
      description: `${out} agotado${out === 1 ? '' : 's'} y ${low} en mínimo. Revisa el inventario.`,
      time: 'Ahora',
      tone: low + out > 2 ? 'danger' : 'warning'
    })
  }
  if (ready > 0) {
    data.push({
      id: 'ready',
      title: `${ready} equipo${ready === 1 ? '' : 's'} listo${ready === 1 ? '' : 's'} para entrega`,
      description: 'Hay OTs listas esperando retiro y cobro.',
      time: 'Ahora',
      tone: 'success'
    })
  }
  if (cash) {
    data.push({
      id: 'cash',
      title: 'Turno de caja abierto',
      description: `${cash.opened_by_name} inició turno con ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(cash.initial_cents) / 100)} de base.`,
      time: 'Ahora',
      tone: 'info'
    })
  }
  if (pending > 0) {
    data.push({
      id: 'purchases',
      title: `${pending} compra${pending === 1 ? '' : 's'} pendiente${pending === 1 ? '' : 's'}`,
      description: 'Confirma la recepción para actualizar inventario.',
      time: 'Ahora',
      tone: 'warning'
    })
  }
  return data
}

function walkFiles(root: string, prefix = '') {
  const files: Array<{ relative: string; absolute: string; size: number }> = []
  if (!fs.existsSync(root)) return files
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const relative = prefix ? path.join(prefix, entry.name) : entry.name
    const absolute = path.join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolute, relative))
    } else if (entry.isFile()) {
      files.push({ relative: relative.replace(/\\/g, '/'), absolute, size: fs.statSync(absolute).size })
    }
  }
  return files
}

function manifestSummary(folder: string) {
  try {
    const manifestPath = path.join(folder, 'manifest.json')
    if (!fs.existsSync(manifestPath)) return null
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    return {
      orders: Number(raw.orderCount ?? raw.orders?.length ?? 0),
      evidenceCount: Number(raw.evidence?.activeCount ?? raw.evidence?.rows?.filter((item: any) => item.status === 'activa').length ?? 0),
      evidenceBytes: Number(raw.evidence?.activeBytes ?? 0),
      version: String(raw.appVersion ?? raw.version ?? ''),
      databaseHash: String(raw.database?.sha256 ?? '')
    }
  } catch {
    return null
  }
}

async function createBackup(db: Database, runtime: Runtime, session?: Session) {
  const backupDir = getBackupPath(runtime.userDataPath)
  fs.mkdirSync(backupDir, { recursive: true })
  const createdAt = new Date().toISOString()
  const stamp = createdAt.replace(/[:.]/g, '-')
  const folderName = `bitacoretech-${stamp}`
  const folder = path.join(backupDir, folderName)
  if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true, force: true })

  try {
    fs.mkdirSync(folder, { recursive: true })
    const databaseTarget = path.join(folder, BACKUP_DATABASE_FILENAME)
    const escaped = databaseTarget.replace(/'/g, "''")
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    db.exec(`VACUUM INTO '${escaped}'`)

    const evidenceSource = getEvidencePath(runtime.userDataPath)
    const evidenceTarget = path.join(folder, EVIDENCE_FOLDER)
    fs.mkdirSync(evidenceTarget, { recursive: true })
    if (fs.existsSync(evidenceSource)) {
      fs.cpSync(evidenceSource, evidenceTarget, { recursive: true, force: true })
    }

    const evidenceRows = db.all<any>(
      `SELECT e.*, w.number AS order_number, w.customer_id, c.name AS customer_name
       FROM work_order_evidence e
       JOIN work_orders w ON w.id = e.work_order_id
       JOIN customers c ON c.id = w.customer_id
       ORDER BY e.captured_at ASC, e.rowid ASC`
    )
    const evidenceFiles = walkFiles(evidenceTarget)
    const activeRows = evidenceRows.filter((row) => row.status === 'activa')
    const activeBytes = activeRows.reduce((sum, row) => sum + Number(row.size_bytes ?? 0), 0)
    const databaseBytes = fs.readFileSync(databaseTarget)
    const databaseHash = sha256Bytes(databaseBytes)
    const orderCount =
      db.get<{ count: number }>('SELECT COUNT(*) AS count FROM work_orders')?.count ?? 0
    const manifest = {
      app: 'BitacoreTech Taller & POS',
      formatVersion: 1,
      appVersion: runtime.version,
      createdAt,
      database: {
        filename: BACKUP_DATABASE_FILENAME,
        size: databaseBytes.length,
        sha256: databaseHash
      },
      orderCount,
      evidence: {
        activeCount: activeRows.length,
        activeBytes,
        setHash: evidenceSetHash(evidenceRows),
        rows: evidenceRows.map((row) => ({
          id: row.id,
          orderId: row.work_order_id,
          orderNumber: row.order_number,
          customerName: row.customer_name,
          category: row.category,
          note: row.note,
          stage: row.stage,
          status: row.status,
          source: row.source,
          filename: row.filename,
          path: row.path,
          size: Number(row.size_bytes),
          sha256: row.sha256,
          capturedAt: row.captured_at,
          capturedByName: row.captured_by_name,
          verifiedAt: row.verified_at,
          verifiedByName: row.verified_by_name,
          voidedAt: row.voided_at,
          voidedByName: row.voided_by_name,
          voidReason: row.void_reason
        })),
        files: evidenceFiles.map((file) => ({
          path: file.relative,
          size: file.size,
          sha256: sha256Bytes(fs.readFileSync(file.absolute))
        }))
      },
      disclaimer:
        'Respaldo completo de BitacoreTech: base de datos, evidencias fotográficas y manifiesto de integridad. Conserve esta carpeta como soporte de reclamos.'
    }
    const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8')
    fs.writeFileSync(path.join(folder, 'manifest.json'), manifestBuffer)
    const totalSize =
      databaseBytes.length +
      evidenceFiles.reduce((sum, file) => sum + file.size, 0) +
      manifestBuffer.length
    const id = `bk_${sha256(`${folderName}|${Date.now()}`).slice(0, 20)}`
    db.run(
      `INSERT INTO backups (id, filename, path, size_bytes, sha256, format, created_by, created_by_name, created_at)
       VALUES (?, ?, ?, ?, ?, 'folder', ?, ?, ?)`,
      id,
      folderName,
      folder,
      totalSize,
      databaseHash,
      session?.userId ?? null,
      session ? displayUser(session).name : 'Sistema',
      createdAt
    )
    return {
      id,
      name: folderName,
      path: folder,
      size: totalSize,
      hash: databaseHash,
      format: 'folder' as const,
      createdAt,
      orderCount,
      evidenceCount: activeRows.length,
      evidenceBytes: activeBytes
    }
  } catch (error) {
    try {
      if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true, force: true })
    } catch {
      // La limpieza no oculta el error original.
    }
    throw error
  }
}

function getBackupPassword(db: Database): string | null {
  const stored = db.getSetting<{ encrypted?: string } | null>('backup_password', null)
  if (!stored?.encrypted) return null
  try {
    return safeStorage.decryptString(Buffer.from(stored.encrypted, 'base64'))
  } catch {
    return null
  }
}

function backupPasswordConfigured(db: Database) {
  const stored = db.getSetting<{ encrypted?: string } | null>('backup_password', null)
  return Boolean(stored?.encrypted)
}

function encryptBackupPayload(data: Buffer, password: string) {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = scryptSync(password, salt, 32)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from('BTBK1', 'ascii'), salt, iv, tag, ciphertext])
}

function decryptBackupPayload(data: Buffer, password: string) {
  if (data.subarray(0, 5).toString('ascii') !== 'BTBK1') {
    fail('El archivo no es un respaldo BitacoreTech válido.')
  }
  const salt = data.subarray(5, 21)
  const iv = data.subarray(21, 33)
  const tag = data.subarray(33, 49)
  const ciphertext = data.subarray(49)
  const key = scryptSync(password, salt, 32)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    fail('La contraseña del respaldo no es correcta o el archivo está dañado.', 'INVALID_PASSWORD')
  }
}

function backupList(db: Database, viewerRole = 'superadmin') {
  return db
    .all<any>(
      `SELECT b.*, u.role AS author_role
       FROM backups b LEFT JOIN users u ON u.id = b.created_by
       ORDER BY b.created_at DESC`
    )
    .map((row) => {
    const format = row.format === 'folder' ? 'folder' : 'db'
    const summary = format === 'folder' ? manifestSummary(String(row.path)) : null
    return {
      id: row.id,
      name: row.filename,
      date: row.created_at,
      size: row.size_bytes,
      author:
        viewerRole !== 'superadmin' && row.author_role === 'superadmin'
          ? 'Cuenta raíz'
          : row.created_by_name,
      sha256: row.sha256,
      path: row.path,
      format,
      orders: summary?.orders ?? undefined,
      evidenceCount: summary?.evidenceCount ?? undefined,
      evidenceBytes: summary?.evidenceBytes ?? undefined,
      version: summary?.version ?? undefined,
      databaseHash: summary?.databaseHash ?? (format === 'db' ? row.sha256 : undefined)
    }
  })
}

function issueSession(db: Database, user: any) {
  const sessionToken = newToken()
  const tokenHash = sha256(sessionToken)
  const security = db.getSetting<any>('security_config', DEFAULT_SETTINGS.security)
  const hours = security.sessionHours ?? 12
  const expires = new Date(Date.now() + hours * 3600_000).toISOString()
  db.run(
    'INSERT INTO sessions (token_hash, user_id, effective_role, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    tokenHash,
    user.id,
    user.role,
    new Date().toISOString(),
    expires
  )
  db.run('UPDATE users SET last_login_at = ? WHERE id = ?', new Date().toISOString(), user.id)
  return { token: sessionToken, expires }
}

function sessionPayload(db: Database, user: any, token: string, expires: string) {
  const profile = {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    accountRole: user.role,
    photoUrl: user.photo_path ?? null
  }
  return {
    token,
    user: profile,
    displayUser: profile,
    role: user.role,
    actualRole: user.role,
    canPreviewRoles: user.role === 'superadmin',
    expiresAt: expires,
    roleLabel: roleLabels[user.role],
    permissions: effectiveCapabilities(db, user.id, user.role)
  }
}

async function restoreBackupRecord(db: Database, runtime: Runtime, session: Session, backup: any) {
  if (!fs.existsSync(backup.path)) fail('El archivo del respaldo no existe en este equipo.')
  const format = backup.format === 'folder' ? 'folder' : 'db'
  const sourceDatabase =
    format === 'folder' ? path.join(String(backup.path), BACKUP_DATABASE_FILENAME) : String(backup.path)
  if (!fs.existsSync(sourceDatabase)) fail('El respaldo no contiene una base de datos válida.')
  const sourceEvidence = path.join(String(backup.path), EVIDENCE_FOLDER)
  if (format === 'folder' && !fs.existsSync(sourceEvidence)) {
    fail('El respaldo completo no contiene la carpeta de evidencias.')
  }
  const safety = await createBackup(db, runtime, session)
  closeDatabase()
  const wal = `${db.path}-wal`
  const shm = `${db.path}-shm`
  if (fs.existsSync(wal)) fs.rmSync(wal, { force: true })
  if (fs.existsSync(shm)) fs.rmSync(shm, { force: true })
  try {
    fs.copyFileSync(sourceDatabase, db.path)
    const currentEvidence = getEvidencePath(runtime.userDataPath)
    if (fs.existsSync(currentEvidence)) fs.rmSync(currentEvidence, { recursive: true, force: true })
    if (format === 'folder') {
      fs.cpSync(sourceEvidence, currentEvidence, { recursive: true, force: true })
    } else {
      fs.mkdirSync(currentEvidence, { recursive: true })
    }
  } catch (error) {
    try {
      openDatabase(runtime.userDataPath)
    } catch {
      // El error original describe la restauración fallida.
    }
    throw error
  }
  const restored = openDatabase(runtime.userDataPath)
  const credentialsRestored = Number(
    restored.get<{ count: number }>('SELECT COUNT(*) AS count FROM work_order_credentials')?.count ?? 0
  )
  if (credentialsRestored > 0) {
    restored.run('DELETE FROM work_order_credentials')
    restored.appendAudit({
      userId: session.userId,
      userName: displayUser(session).name,
      role: roleLabel(session.role as any),
      action: 'Credenciales descartadas por restauración',
      entity: 'Respaldo',
      entityId: backup.id,
      detail: `${credentialsRestored} credenciales cifradas descartadas para evitar dependencia del equipo de origen.`
    })
  }
  restored.run(
    `INSERT OR REPLACE INTO backups
      (id, filename, path, size_bytes, sha256, format, created_by, created_by_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    safety.id,
    safety.name,
    safety.path,
    safety.size,
    safety.hash,
    safety.format ?? 'folder',
    session.userId,
    displayUser(session).name,
    safety.createdAt
  )
  restored.appendAudit({
    userId: session.userId,
    userName: displayUser(session).name,
    role: roleLabel(session.role as any),
    action: 'Restauración de backup',
    entity: 'Respaldo',
    entityId: backup.id,
    detail: `${format === 'folder' ? 'Respaldo completo (base + evidencias)' : 'Respaldo legado solo de base'} ${backup.filename} restaurado. Se generó copia previa ${safety.name}.`
  })
  return { restored: true, safetyBackup: safety.name, requiresReload: true, format }
}

export async function handleRpc(command: string, payload: Payload, token: string | undefined, runtime: Runtime): Promise<any> {
  if (command === 'app.info') {
    return { version: runtime.version, platform: process.platform, currency: 'COP', locale: 'es-CO' }
  }

  if (command === 'auth.status') {
    const db = currentSession()
    const users = db.count('users')
    return { setupRequired: users === 0, hasUsers: users > 0 }
  }

  if (command === 'auth.setup') {
    const db = currentSession()
    if (db.count('users') > 0) fail('La aplicación ya está configurada.', 'ALREADY_SETUP')
    const name = text(payload?.name, 'Nombre del propietario', 3, 160)
    const username = text(payload?.username, 'Usuario', 3, 60).toLowerCase()
    if (!/^[a-z0-9._-]+$/.test(username)) {
      fail('El usuario solo puede tener letras, números, punto, guion y guion bajo.')
    }
    const password = text(payload?.password, 'Contraseña', 8, 200)
    const email = typeof payload?.email === 'string' && payload.email.trim()
      ? payload.email.trim().slice(0, 200)
      : '—'
    const businessName = typeof payload?.businessName === 'string' && payload.businessName.trim()
      ? payload.businessName.trim().slice(0, 160)
      : DEFAULT_LEGAL.businessName
    const demo = Boolean(payload?.demo)
    const owner: SeedOwner = { id: 'u1', username, name, email, password }

    db.tx(() => {
      if (demo) runDemoSeed(db, owner)
      if (db.count('users') === 0) {
        db.run(
          `INSERT INTO users (id, username, name, email, role, password_hash, active, is_protected, created_at, created_by)
           VALUES (?, ?, ?, ?, 'superadmin', ?, 1, 1, ?, NULL)`,
          owner.id,
          owner.username,
          owner.name,
          owner.email,
          hashPassword(owner.password),
          new Date().toISOString()
        )
      } else {
        // El seed demo ya creó u1; se asegura que use las credenciales elegidas.
        db.run(
          `UPDATE users
           SET username = ?, name = ?, email = ?, password_hash = ?, role = 'superadmin', active = 1, is_protected = 1
           WHERE id = ?`,
          owner.username,
          owner.name,
          owner.email,
          hashPassword(owner.password),
          owner.id
        )
      }

      const legal = db.getSetting<any>('legal_config', DEFAULT_LEGAL)
      const updatedAt = new Date().toISOString()
      const nextLegal = { ...legal, businessName, updatedAt }
      db.setSetting('legal_config', nextLegal)
      db.run(
        'INSERT OR REPLACE INTO legal_versions (id, version, config_json, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
        'legal_setup',
        nextLegal.version,
        JSON.stringify(nextLegal),
        owner.id,
        updatedAt
      )

      db.appendAudit({
        userId: owner.id,
        userName: owner.name,
        role: 'Propietario',
        action: 'Configuración inicial',
        entity: 'Sistema',
        detail: `Propietario ${owner.username} creado. Negocio: ${businessName}.${demo ? ' Datos de demostración cargados.' : ''}`
      })
      db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('setup_completed', '1')")
    })

    const created = db.get<any>('SELECT * FROM users WHERE id = ?', owner.id)
    if (!created) fail('No se pudo crear la cuenta del propietario.', 'INTERNAL_ERROR')
    const issued = issueSession(db, created)
    const sessionLike = {
      token: issued.token,
      tokenHash: sha256(issued.token),
      userId: created.id,
      userName: created.name,
      username: created.username,
      email: created.email ?? '',
      actualRole: 'superadmin',
      role: 'superadmin',
      expiresAt: issued.expires
    } as Session
    try {
      await createBackup(db, runtime, sessionLike)
    } catch (error) {
      console.error('[BitacoreTech] No se pudo crear el respaldo inicial', error)
    }
    return sessionPayload(db, created, issued.token, issued.expires)
  }

  if (command === 'auth.login') {
    const db = currentSession()
    if (db.count('users') === 0) {
      fail('La aplicación aún no está configurada. Crea la cuenta del propietario.', 'SETUP_REQUIRED')
    }
    const username = text(payload?.username, 'Usuario', 3, 80).toLowerCase()
    const password = typeof payload?.password === 'string' ? payload.password : ''
    if (!password) fail('La contraseña es obligatoria')

    const attempts = loginAttempts.get(username)
    if (attempts && attempts.blockedUntil > Date.now()) {
      fail('Demasiados intentos fallidos. Espera un minuto antes de reintentar.', 'LOCKED')
    }

    const user = db.get<any>('SELECT * FROM users WHERE username = ? COLLATE NOCASE', username)
    const matches = Boolean(user?.active) && verifyPassword(password, user.password_hash)
    if (!matches) {
      const current = loginAttempts.get(username) ?? { fails: 0, blockedUntil: 0 }
      current.fails += 1
      if (current.fails >= 5) {
        current.fails = 0
        current.blockedUntil = Date.now() + 60_000
      }
      loginAttempts.set(username, current)
      db.appendAudit({
        userId: user?.id ?? null,
        userName: user?.name ?? username,
        role: user?.role ?? 'desconocido',
        action: 'Intento de acceso fallido',
        entity: 'Sesión',
        detail: `Usuario ${username}.`
      })
      fail('Usuario o contraseña incorrectos.', 'INVALID_CREDENTIALS')
    }

    loginAttempts.delete(username)
    const issued = issueSession(db, user)
    db.appendAudit({
      userId: user.id,
      userName: user.name,
      role: roleLabel(user.role as any),
      action: 'Inicio de sesión',
      entity: 'Sesión',
      detail: `Acceso correcto para ${user.username}.`
    })
    return sessionPayload(db, user, issued.token, issued.expires)
  }

  if (command === 'auth.session') {
    const db = currentSession()
    const session = resolveSession(db, token ?? '')
    return sessionResponse(session)
  }

  if (!token) fail('Sesión requerida', 'UNAUTHENTICATED')
  const db = currentSession()
  const session = resolveSession(db, token)

  if (command === 'auth.logout') {
    db.run('DELETE FROM sessions WHERE token_hash = ?', session.tokenHash)
    audit(db, session, 'Cierre de sesión', 'Sesión', 'El usuario cerró su sesión.')
    return { ok: true }
  }

  if (command === 'auth.previewRole') {
    if (session.actualRole !== 'superadmin') fail('Solo la cuenta raíz puede previsualizar roles.', 'FORBIDDEN')
    const role = schema(payload?.role, z.enum(['superadmin', 'admin', 'tecnico', 'cajero']))
    db.run('UPDATE sessions SET effective_role = ? WHERE token_hash = ?', role, session.tokenHash)
    const refreshed = { ...session, role }
    audit(db, refreshed, 'Cambio de vista de rol', 'Sesión', `Vista previa cambiada a ${roleLabel(role)}.`)
    return sessionResponse(refreshed)
  }

  if (command === 'auth.changePassword') {
    const user = db.get<any>('SELECT * FROM users WHERE id = ?', session.userId)
    if (!user) fail('La sesión ya no es válida.', 'UNAUTHENTICATED')
    const currentPassword = typeof payload?.currentPassword === 'string' ? payload.currentPassword : ''
    if (!currentPassword || !verifyPassword(currentPassword, user.password_hash)) {
      fail('La contraseña actual no es correcta.', 'INVALID_CREDENTIALS')
    }
    const newPassword = text(payload?.newPassword, 'Nueva contraseña', 8, 200)
    db.tx(() => {
      db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(newPassword), user.id)
      audit(db, session, 'Cambio de contraseña', 'Usuario', `${user.name} actualizó su contraseña.`, user.id)
    })
    return { updated: true }
  }

  switch (command) {
    case 'dashboard.badges': {
      requireModuleAccess(session, 'dashboard')
      const open = db.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM work_orders WHERE status NOT IN ('entregado','no_reparado')"
      )
      const low = db.get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM products WHERE active = 1 AND is_service = 0 AND alert_enabled = 1 AND stock <= min_stock'
      )
      return {
        openOrders: Number(open?.count ?? 0),
        lowStock: Number(low?.count ?? 0)
      }
    }

    case 'dashboard.get': {
      requireModuleAccess(session, 'dashboard')
      const products = db
        .all<any>('SELECT * FROM products WHERE active = 1 ORDER BY name ASC')
        .map((row) => productDto(db, row, canSession(session, 'viewCosts')))
      const orders = db
        .all<any>(
          `SELECT w.*, c.name AS customer_name FROM work_orders w JOIN customers c ON c.id = w.customer_id
           ORDER BY w.created_at DESC`
        )
        .map((row) => orderDto(db, row))
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const todayInvoices = db.all<any>(
        "SELECT * FROM invoices WHERE status = 'activa' AND created_at >= ?",
        today.toISOString()
      )
      const stockSummary = { in: 0, low: 0, out: 0 }
      const alertStock = { low: 0, out: 0 }
      for (const product of products) {
        if (product.service) continue
        if (product.stock <= 0) {
          stockSummary.out += 1
          if (product.alertEnabled) alertStock.out += 1
        } else if (product.stock <= product.minStock) {
          stockSummary.low += 1
          if (product.alertEnabled) alertStock.low += 1
        } else {
          stockSummary.in += 1
        }
      }
      const report = reportData(db, session, '30d')
      const open = orders.filter((order: any) => !['entregado', 'no_reparado'].includes(order.status))
      const cash = currentCashSession(db)
      return {
        stats: {
          salesToday: money(todayInvoices.reduce((sum, invoice) => sum + Number(invoice.total_cents), 0)),
          invoicesToday: todayInvoices.length,
          openOrders: open.length,
          diagnosticOrders: orders.filter((order: any) => order.status === 'diagnostico').length,
          readyOrders: orders.filter((order: any) => order.status === 'listo').length,
          lowStock: alertStock.low + alertStock.out,
          cashExpected: cash ? cashSessionDto(db, cash).expected : 0
        },
        products,
        orders,
        cashSession: cash ? cashSessionDto(db, cash) : null,
        stockSummary,
        chartData: report.chartData,
        technicianStats: report.technicianStats,
        notifications: notificationData(db)
      }
    }

    case 'notifications.list': {
      return notificationData(db)
    }

    case 'customers.list': {
      requireModuleAccess(session, 'customers')
      return db
        .all<any>('SELECT * FROM customers ORDER BY is_final_consumer ASC, name ASC')
        .map((row) => customerDto(db, row))
    }

    case 'customers.create': {
      requireModuleAccess(session, 'customers')
      const name = text(payload?.name, 'Nombre', 2, 160)
      const documentType = schema(payload?.documentType ?? 'CC', z.enum(['CC', 'NIT', 'Pasaporte']))
      const isForeignDocument = Boolean(payload?.isForeignDocument)
      let document = text(payload?.document, 'Documento', 3, 40)
      if (documentType === 'NIT' && !isForeignDocument) {
        const digits = normalizeNit(document)
        if (document !== digits) fail('El NIT debe contener solo números, sin puntos ni espacios.')
        const dv = typeof payload?.documentDv === 'string' ? payload.documentDv.trim() : calculateNitDv(digits)
        if (!isValidNit(digits, dv)) fail('El dígito de verificación del NIT no es válido.')
        document = digits
      }
      const existing = db.get<any>('SELECT id, name FROM customers WHERE document = ?', document)
      if (existing) fail(`Ya existe un cliente con ese documento: ${existing.name}`, 'DUPLICATE')
      const id = `cust_${sha256(`${document}|${Date.now()}`).slice(0, 20)}`
      const nowIso = new Date().toISOString()
      db.tx(() => {
        db.run(
          `INSERT INTO customers
            (id, name, document_type, document, phone, email, address, is_final_consumer, is_foreign_document,
             loyalty_active, loyalty_discount_type, loyalty_discount_value, loyalty_valid_until, loyalty_notes,
             created_at, updated_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 'percent', 0, NULL, NULL, ?, ?, ?)`,
          id,
          name,
          documentType,
          document,
          text(payload?.phone ?? '—', 'Teléfono', 1, 80) || '—',
          text(payload?.email ?? '—', 'Correo', 1, 160) || '—',
          text(payload?.address ?? 'Sin dirección', 'Dirección', 1, 240) || 'Sin dirección',
          isForeignDocument ? 1 : 0,
          nowIso,
          nowIso,
          session.userId
        )
        audit(
          db,
          session,
          'Creación de cliente',
          'Cliente',
          `${name} · ${documentType} ${document}${isForeignDocument ? ' · documento extranjero' : ''}`,
          id
        )
      })
      return customerDto(db, db.get<any>('SELECT * FROM customers WHERE id = ?', id))
    }

    case 'customers.update': {
      requireModuleAccess(session, 'customers')
      const id = text(payload?.id, 'Cliente', 1, 80)
      const row = db.get<any>('SELECT * FROM customers WHERE id = ?', id)
      if (!row) fail('Cliente no encontrado', 'NOT_FOUND')
      const updates: string[] = []
      const params: any[] = []
      if (typeof payload?.name === 'string') {
        updates.push('name = ?')
        params.push(text(payload.name, 'Nombre', 2, 160))
      }
      if (typeof payload?.phone === 'string') {
        updates.push('phone = ?')
        params.push(payload.phone.trim() || '—')
      }
      if (typeof payload?.email === 'string') {
        updates.push('email = ?')
        params.push(payload.email.trim() || '—')
      }
      if (typeof payload?.address === 'string') {
        updates.push('address = ?')
        params.push(payload.address.trim() || 'Sin dirección')
      }
      const documentType = payload?.documentType
        ? schema(payload.documentType, z.enum(['CC', 'NIT', 'Pasaporte']))
        : row.document_type
      const isForeignDocument =
        payload?.isForeignDocument === undefined ? Boolean(row.is_foreign_document) : Boolean(payload.isForeignDocument)
      if (payload?.documentType !== undefined || payload?.document !== undefined || payload?.isForeignDocument !== undefined) {
        let document = typeof payload?.document === 'string' ? payload.document.trim() : row.document
        if (documentType === 'NIT' && !isForeignDocument) {
          const digits = normalizeNit(document)
          if (document !== digits) fail('El NIT debe contener solo números, sin puntos ni espacios.')
          const dv = typeof payload?.documentDv === 'string' ? payload.documentDv.trim() : calculateNitDv(digits)
          if (!isValidNit(digits, dv)) fail('El dígito de verificación del NIT no es válido.')
          document = digits
        }
        const duplicate = db.get<any>('SELECT id, name FROM customers WHERE document = ? AND id <> ?', document, id)
        if (duplicate) fail(`Ya existe un cliente con ese documento: ${duplicate.name}`, 'DUPLICATE')
        updates.push('document_type = ?', 'document = ?', 'is_foreign_document = ?')
        params.push(documentType, document, isForeignDocument ? 1 : 0)
      }
      const loyaltyFields = [
        'loyaltyActive',
        'loyaltyDiscountType',
        'loyaltyDiscountValue',
        'loyaltyValidUntil',
        'loyaltyNotes'
      ]
      const touchesLoyalty = loyaltyFields.some((key) => payload?.[key] !== undefined)
      if (touchesLoyalty) {
        requireCap(session, 'manageLoyalty')
        if (payload?.loyaltyActive !== undefined) {
          updates.push('loyalty_active = ?')
          params.push(payload.loyaltyActive ? 1 : 0)
        }
        if (payload?.loyaltyDiscountType !== undefined) {
          const type = schema(payload.loyaltyDiscountType, z.enum(['percent', 'amount']))
          updates.push('loyalty_discount_type = ?')
          params.push(type)
        }
        if (payload?.loyaltyDiscountValue !== undefined) {
          const type =
            payload?.loyaltyDiscountType ??
            (updates.includes('loyalty_discount_type = ?') ? params[params.length - 1] : row.loyalty_discount_type)
          const value = numberValue(
            payload.loyaltyDiscountValue,
            'Descuento de fidelidad',
            type === 'percent' ? { min: 0, max: 100 } : { min: 0 }
          )
          updates.push('loyalty_discount_value = ?')
          params.push(value)
        }
        if (payload?.loyaltyValidUntil !== undefined) {
          updates.push('loyalty_valid_until = ?')
          params.push(typeof payload.loyaltyValidUntil === 'string' && payload.loyaltyValidUntil.trim() ? payload.loyaltyValidUntil.trim() : null)
        }
        if (payload?.loyaltyNotes !== undefined) {
          updates.push('loyalty_notes = ?')
          params.push(typeof payload.loyaltyNotes === 'string' ? payload.loyaltyNotes.slice(0, 500) : null)
        }
      }
      if (!updates.length) fail('No hay cambios para guardar')
      updates.push('updated_at = ?')
      params.push(new Date().toISOString(), id)
      db.tx(() => {
        db.run(`UPDATE customers SET ${updates.join(', ')} WHERE id = ?`, ...params)
        audit(
          db,
          session,
          touchesLoyalty ? 'Actualización de fidelidad' : 'Actualización de cliente',
          'Cliente',
          touchesLoyalty
            ? `${row.name} · fidelidad ${payload?.loyaltyActive === false ? 'desactivada' : 'actualizada'}`
            : `${row.name} actualizado`,
          id
        )
      })
      return customerDto(db, db.get<any>('SELECT * FROM customers WHERE id = ?', id))
    }

    case 'equipment.list': {
      requireModuleAccess(session, 'customers')
      const customerId = text(payload?.customerId, 'Cliente', 1, 80)
      return db
        .all<any>('SELECT * FROM equipment WHERE customer_id = ? ORDER BY updated_at DESC', customerId)
        .map(equipmentDto)
    }

    case 'equipment.qrEnabled': {
      requireModuleAccess(session, 'customers')
      return Boolean(db.getSetting<any>('equipment_config', DEFAULT_SETTINGS.equipment)?.qrEnabled)
    }

    case 'equipment.create': {
      requireModuleAccess(session, 'orders')
      requireCap(session, 'createOrder')
      const customerId = text(payload?.customerId, 'Cliente', 1, 80)
      const customer = db.get<any>('SELECT * FROM customers WHERE id = ?', customerId)
      if (!customer) fail('Cliente no encontrado', 'NOT_FOUND')
      const category = String(payload?.category ?? 'otro').slice(0, 40)
      const customBuild = Boolean(payload?.customBuild)
      if (customBuild && !supportsCustomBuild(category)) {
        fail('El modo de equipo armado solo aplica a PC Torre u Otro.')
      }
      const alias = customBuild ? text(payload?.alias ?? payload?.model, 'Alias del equipo', 2, 120) : null
      const brand = customBuild ? 'Armado' : text(payload?.brand, 'Marca', 1, 80)
      const model = customBuild ? String(alias) : text(payload?.model, 'Modelo', 1, 120)
      const serial = customBuild
        ? customBuildSerial(`${customerId}|${model}|${Date.now()}|${Math.random()}`)
        : text(payload?.serial ?? 'Sin serial', 'Serial', 1, 120)
      if (!customBuild) {
        const duplicate = db.get<any>(
          `SELECT id FROM equipment
           WHERE customer_id = ? AND serial = ? COLLATE NOCASE AND brand = ? COLLATE NOCASE AND model = ? COLLATE NOCASE`,
          customerId,
          serial,
          brand,
          model
        )
        if (duplicate) fail('Ya existe un equipo con ese serial para este cliente.', 'DUPLICATE')
      }
      const id = `eq_${sha256(`${customerId}|${serial}|${Date.now()}`).slice(0, 20)}`
      const nowIso = new Date().toISOString()
      const technicalSheet =
        payload?.technicalSheet && typeof payload.technicalSheet === 'object'
          ? JSON.stringify(payload.technicalSheet)
          : null
      db.tx(() => {
        db.run(
          `INSERT INTO equipment
            (id, customer_id, category, category_label, equipment_type, brand, model, serial, accessories,
             technical_sheet_json, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          customerId,
          category,
          String(payload?.categoryLabel ?? 'Equipo').slice(0, 80),
          String(payload?.equipmentType ?? payload?.categoryLabel ?? 'Equipo').slice(0, 80),
          brand,
          model,
          serial,
          typeof payload?.accessories === 'string' ? payload.accessories.slice(0, 1000) : 'Sin accesorios',
          technicalSheet,
          typeof payload?.notes === 'string' ? payload.notes.slice(0, 1000) : null,
          nowIso,
          nowIso
        )
        audit(db, session, 'Creación de equipo', 'Equipo', `${customer.name} · ${brand} ${model} · ${serial}`, id)
      })
      return equipmentDto(db.get<any>('SELECT * FROM equipment WHERE id = ?', id))
    }

    case 'equipment.update': {
      requireModuleAccess(session, 'orders')
      requireCap(session, 'createOrder')
      const id = text(payload?.id, 'Equipo', 1, 80)
      const row = db.get<any>('SELECT * FROM equipment WHERE id = ?', id)
      if (!row) fail('Equipo no encontrado', 'NOT_FOUND')
      const updates: string[] = []
      const params: any[] = []
      let ownershipChanged = false
      let ownershipDetail = ''
      const customBuildUpdate = payload?.customBuild === true
      if (customBuildUpdate) {
        const nextCategory =
          payload?.category !== undefined ? String(payload.category).slice(0, 40) : row.category
        if (!supportsCustomBuild(nextCategory)) {
          fail('El modo de equipo armado solo aplica a PC Torre u Otro.')
        }
        const alias = text(payload?.alias ?? payload?.model, 'Alias del equipo', 2, 120)
        const serial =
          row.brand === 'Armado' && String(row.serial).startsWith('ARM-')
            ? row.serial
            : customBuildSerial(`${row.customer_id}|${alias}|${Date.now()}|${Math.random()}`)
        updates.push('brand = ?', 'model = ?', 'serial = ?')
        params.push('Armado', alias, serial)
      }
      if (payload?.customerId !== undefined && payload.customerId !== row.customer_id) {
        requireCap(session, 'manageStaff')
        const customer = db.get<any>('SELECT * FROM customers WHERE id = ?', payload.customerId)
        if (!customer) fail('Cliente destino no encontrado', 'NOT_FOUND')
        const reason = text(payload?.reason, 'Motivo de la corrección', 3, 500)
        updates.push('customer_id = ?')
        params.push(payload.customerId)
        ownershipChanged = true
        ownershipDetail = `${row.brand} ${row.model} · ${row.serial} · ${reason}`
      }
      for (const [key, column, max] of [
        ['category', 'category', 40],
        ['categoryLabel', 'category_label', 80],
        ['equipmentType', 'equipment_type', 80],
        ['brand', 'brand', 80],
        ['model', 'model', 120],
        ['serial', 'serial', 120],
        ['accessories', 'accessories', 1000],
        ['notes', 'notes', 1000]
      ] as const) {
        if (customBuildUpdate && (key === 'brand' || key === 'model' || key === 'serial')) continue
        if (payload?.[key] !== undefined) {
          updates.push(`${column} = ?`)
          params.push(String(payload[key]).slice(0, max))
        }
      }
      if (payload?.technicalSheet !== undefined) {
        updates.push('technical_sheet_json = ?')
        params.push(payload.technicalSheet && typeof payload.technicalSheet === 'object' ? JSON.stringify(payload.technicalSheet) : null)
      }
      if (!updates.length) fail('No hay cambios para guardar')
      updates.push('updated_at = ?')
      params.push(new Date().toISOString(), id)
      db.tx(() => {
        db.run(`UPDATE equipment SET ${updates.join(', ')} WHERE id = ?`, ...params)
        if (ownershipChanged) {
          db.appendAudit({
            userId: session.userId,
            userName: displayUser(session).name,
            role: roleLabel(session.role as any),
            action: 'Corrección de propietario de equipo',
            entity: 'Equipo',
            entityId: id,
            detail: ownershipDetail
          })
        } else {
          audit(db, session, 'Actualización de equipo', 'Equipo', `${row.brand} ${row.model} · ${row.serial}`, id)
        }
      })
      return equipmentDto(db.get<any>('SELECT * FROM equipment WHERE id = ?', id))
    }

    case 'customers.detail': {
      requireModuleAccess(session, 'customers')
      const id = text(payload?.id, 'Cliente', 1, 80)
      const customer = db.get<any>('SELECT * FROM customers WHERE id = ?', id)
      if (!customer) fail('Cliente no encontrado', 'NOT_FOUND')
      const orders = db
        .all<any>(
          `SELECT w.*, c.name AS customer_name FROM work_orders w JOIN customers c ON c.id = w.customer_id
           WHERE w.customer_id = ? ORDER BY w.created_at DESC LIMIT 50`,
          id
        )
        .map((row) => orderDto(db, row))
      const invoices = db
        .all<any>('SELECT * FROM invoices WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50', id)
        .map((row) => invoiceDto(db, row))
      const equipment = db
        .all<any>('SELECT * FROM equipment WHERE customer_id = ? ORDER BY updated_at DESC', id)
        .map(equipmentDto)
      return { customer: customerDto(db, customer), orders, invoices, equipment }
    }

    case 'inventory.list': {
      requireModuleAccess(session, 'inventory')
      return db
        .all<any>('SELECT * FROM products WHERE active = 1 ORDER BY name ASC')
        .map((row) => productDto(db, row, canSession(session, 'viewCosts')))
    }

    case 'inventory.movements': {
      requireModuleAccess(session, 'inventory')
      const productId = text(payload?.productId, 'Producto', 1, 80)
      return db
        .all<any>('SELECT * FROM stock_movements WHERE product_id = ? ORDER BY created_at DESC LIMIT 30', productId)
        .map((row) => ({
          id: row.id,
          type: row.type,
          quantity: Number(row.quantity),
          detail: row.reason,
          reference: row.reference_id,
          user: row.user_name,
          date: row.created_at
        }))
    }

    case 'inventory.create': {
      requireModuleAccess(session, 'inventory')
      requireCap(session, 'editInventory')
      const name = text(payload?.name, 'Nombre', 2, 160)
      const sku = text(payload?.sku, 'SKU', 2, 60)
      if (db.get<any>('SELECT id FROM products WHERE sku = ?', sku)) fail('Ya existe un producto con ese SKU', 'DUPLICATE')
      const price = numberValue(payload?.price, 'Precio', { min: 1 })
      const cost = numberValue(payload?.cost ?? 0, 'Costo', { min: 0 })
      const stock = numberValue(payload?.stock ?? 0, 'Stock', { min: 0 })
      const minStock = numberValue(payload?.minStock ?? 0, 'Stock mínimo', { min: 0 })
      const rotation = schema(payload?.rotation ?? 'rotativo', z.enum(['rotativo', 'no_rotativo', 'prueba']))
      const alertEnabled = payload?.alertEnabled === undefined ? rotation === 'rotativo' : Boolean(payload.alertEnabled)
      const service = Boolean(payload?.service)
      const serviceType =
        service && typeof payload?.serviceType === 'string' && payload.serviceType.trim()
          ? text(payload.serviceType, 'Tipo de servicio', 1, 80)
          : null
      if (serviceType) {
        const serviceNode = db.get<any>(
          "SELECT id FROM dictionary_nodes WHERE type = 'service_type' AND name = ? COLLATE NOCASE AND active = 1",
          serviceType
        )
        if (!serviceNode) fail('Selecciona un tipo de servicio activo del diccionario.')
      }
      const id = `prod_${sha256(`${sku}|${Date.now()}`).slice(0, 20)}`
      const barcode = String(payload?.barcode ?? `LOCAL${Date.now().toString().slice(-9)}`).slice(0, 60)
      const nowIso = new Date().toISOString()
      db.tx(() => {
        db.run(
          `INSERT INTO products
            (id, name, sku, barcode, category, location, stock, min_stock, cost_cents, price_cents,
             warranty_days, is_service, service_type, alert_enabled, rotation, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          id,
          name,
          sku,
          barcode,
          text(payload?.category ?? 'Repuestos', 'Categoría', 2, 80),
          text(payload?.location ?? 'Bodega A', 'Ubicación', 2, 80),
          stock,
          minStock,
          toCents(cost),
          toCents(price),
          Math.max(0, Math.round(numberValue(payload?.warrantyDays ?? 0, 'Garantía', { min: 0 }))),
          service ? 1 : 0,
          serviceType,
          alertEnabled ? 1 : 0,
          rotation,
          nowIso,
          nowIso
        )
        if (stock > 0) {
          db.run(
            `INSERT INTO stock_movements
              (id, product_id, type, quantity, unit_cost_cents, reason, reference_type, reference_id, user_id, user_name, created_at)
             VALUES (?, ?, 'carga_inicial', ?, ?, 'Stock inicial', 'product', ?, ?, ?, ?)`,
            `sm_${Date.now()}`,
            id,
            stock,
            toCents(cost),
            id,
            session.userId,
            displayUser(session).name,
            nowIso
          )
        }
        audit(db, session, 'Creación de producto', 'Producto', `${name} · SKU ${sku}`, id)
      })
      return productDto(db, db.get<any>('SELECT * FROM products WHERE id = ?', id), true)
    }

    case 'inventory.update': {
      requireModuleAccess(session, 'inventory')
      requireCap(session, 'editInventory')
      if (!['admin', 'superadmin'].includes(session.actualRole)) {
        fail('Solo administradores y el propietario pueden editar referencias de inventario.', 'FORBIDDEN')
      }
      const productId = text(payload?.id, 'Producto', 1, 80)
      const product = db.get<any>('SELECT * FROM products WHERE id = ?', productId)
      if (!product) fail('Producto no encontrado', 'NOT_FOUND')
      const updates: string[] = []
      const params: any[] = []
      const changed: string[] = []
      if (payload?.name !== undefined) {
        updates.push('name = ?')
        params.push(text(payload.name, 'Nombre', 2, 160))
        changed.push('nombre')
      }
      if (payload?.sku !== undefined) {
        const sku = text(payload.sku, 'SKU', 2, 60)
        const duplicate = db.get<any>('SELECT id FROM products WHERE sku = ? AND id <> ?', sku, productId)
        if (duplicate) fail('Ya existe un producto con ese SKU', 'DUPLICATE')
        updates.push('sku = ?')
        params.push(sku)
        changed.push('SKU')
      }
      if (payload?.barcode !== undefined) {
        updates.push('barcode = ?')
        params.push(text(payload.barcode, 'Código de barras', 1, 60))
        changed.push('código de barras')
      }
      if (payload?.category !== undefined) {
        updates.push('category = ?')
        params.push(text(payload.category, 'Categoría', 2, 80))
        changed.push('categoría')
      }
      if (payload?.location !== undefined) {
        updates.push('location = ?')
        params.push(text(payload.location, 'Ubicación', 2, 80))
        changed.push('ubicación')
      }
      if (payload?.minStock !== undefined) {
        updates.push('min_stock = ?')
        params.push(numberValue(payload.minStock, 'Stock mínimo', { min: 0 }))
        changed.push('stock mínimo')
      }
      if (payload?.cost !== undefined) {
        updates.push('cost_cents = ?')
        params.push(toCents(numberValue(payload.cost, 'Costo', { min: 0 })))
        changed.push('costo')
      }
      if (payload?.price !== undefined) {
        updates.push('price_cents = ?')
        params.push(toCents(numberValue(payload.price, 'Precio', { min: 1 })))
        changed.push('precio')
      }
      if (payload?.warrantyDays !== undefined) {
        updates.push('warranty_days = ?')
        params.push(Math.max(0, Math.round(numberValue(payload.warrantyDays, 'Garantía', { min: 0 }))))
        changed.push('garantía')
      }
      let nextService = Boolean(product.is_service)
      if (payload?.service !== undefined) {
        nextService = Boolean(payload.service)
        updates.push('is_service = ?')
        params.push(nextService ? 1 : 0)
        changed.push(nextService ? 'marcado como servicio' : 'marcado como producto')
        if (!nextService) {
          updates.push('service_type = NULL')
          changed.push('tipo de servicio retirado')
        }
      }
      if (payload?.serviceType !== undefined && nextService) {
        const rawServiceType =
          typeof payload.serviceType === 'string' && payload.serviceType.trim()
            ? text(payload.serviceType, 'Tipo de servicio', 1, 80)
            : null
        if (rawServiceType) {
          if (rawServiceType !== (product.service_type ?? null)) {
            const serviceNode = db.get<any>(
              "SELECT id FROM dictionary_nodes WHERE type = 'service_type' AND name = ? COLLATE NOCASE AND active = 1",
              rawServiceType
            )
            if (!serviceNode) fail('Selecciona un tipo de servicio activo del diccionario.')
          }
          updates.push('service_type = ?')
          params.push(rawServiceType)
          changed.push('tipo de servicio')
        } else {
          updates.push('service_type = NULL')
          changed.push('tipo de servicio retirado')
        }
      }
      if (payload?.rotation !== undefined) {
        const rotation = schema(payload.rotation, z.enum(['rotativo', 'no_rotativo', 'prueba']))
        updates.push('rotation = ?')
        params.push(rotation)
        changed.push('rotación')
      }
      if (payload?.alertEnabled !== undefined) {
        updates.push('alert_enabled = ?')
        params.push(payload.alertEnabled ? 1 : 0)
        changed.push(payload.alertEnabled ? 'alerta activada' : 'alerta desactivada')
      }
      if (payload?.active !== undefined) {
        updates.push('active = ?')
        params.push(payload.active ? 1 : 0)
        changed.push(payload.active ? 'reactivación' : 'desactivación')
      }
      if (!updates.length) fail('No hay cambios para guardar')
      updates.push('updated_at = ?')
      params.push(new Date().toISOString())
      db.tx(() => {
        db.run(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`, ...params, productId)
        audit(
          db,
          session,
          'Actualización de producto',
          'Producto',
          `${product.name} · ${changed.join(', ')}`,
          productId
        )
      })
      return productDto(db, db.get<any>('SELECT * FROM products WHERE id = ?', productId), canSession(session, 'viewCosts'))
    }

    case 'inventory.adjust': {
      requireModuleAccess(session, 'inventory')
      requireCap(session, 'editInventory')
      const productId = text(payload?.productId, 'Producto', 1, 80)
      const product = db.get<any>('SELECT * FROM products WHERE id = ? AND active = 1', productId)
      if (!product) fail('Producto no encontrado', 'NOT_FOUND')
      const delta = numberValue(payload?.quantity, 'Cantidad', { min: -100000, max: 100000 })
      if (!delta) fail('La cantidad no puede ser cero')
      const reason = text(payload?.reason, 'Motivo', 2, 200)
      if (Number(product.stock) + delta < 0) fail('El ajuste dejaría el stock en negativo')
      db.tx(() => {
        db.run('UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?', delta, new Date().toISOString(), productId)
        db.run(
          `INSERT INTO stock_movements
            (id, product_id, type, quantity, unit_cost_cents, reason, reference_type, reference_id, user_id, user_name, created_at)
           VALUES (?, ?, 'ajuste', ?, ?, ?, 'adjustment', ?, ?, ?, ?)`,
          `sm_${Date.now()}`,
          productId,
          delta,
          product.cost_cents,
          reason,
          `adj_${Date.now()}`,
          session.userId,
          displayUser(session).name,
          new Date().toISOString()
        )
        audit(
          db,
          session,
          'Ajuste de inventario',
          'Producto',
          `${product.name} · ${delta > 0 ? '+' : ''}${delta} unidades · ${reason}`,
          productId
        )
      })
      return productDto(db, db.get<any>('SELECT * FROM products WHERE id = ?', productId), true)
    }

    case 'orders.technicians': {
      requireModuleAccess(session, 'orders')
      return technicianOptions(db)
    }

    case 'orders.list': {
      requireModuleAccess(session, 'orders')
      return db
        .all<any>(
          `SELECT w.*, c.name AS customer_name FROM work_orders w JOIN customers c ON c.id = w.customer_id
           ORDER BY w.created_at DESC`
        )
        .map((row) => orderDto(db, row))
    }

    case 'orders.get': {
      requireModuleAccess(session, 'orders')
      return orderDto(db, getOrderOrFail(db, text(payload?.id, 'Orden', 1, 80)))
    }

    case 'orders.diagnosticReport': {
      requireModuleAccess(session, 'orders')
      requireCap(session, 'diagnoseOrder')
      const row = getOrderOrFail(db, text(payload?.id, 'Orden', 1, 80))
      const mode = schema(payload?.mode ?? 'initial', z.enum(['initial', 'delivery'])) as ReportMode
      if (mode === 'delivery' && !['listo', 'entregado'].includes(row.status)) {
        fail('El reporte de entrega está disponible cuando la OT está Lista para entrega o Entregada.')
      }
      const generatedBy = displayUser(session).name
      const result = await generateDiagnosticReport({
        db,
        userDataPath: runtime.userDataPath,
        order: row,
        mode,
        generatedBy
      })
      audit(
        db,
        session,
        mode === 'delivery' ? 'Reporte de entrega generado' : 'Reporte inicial de diagnóstico generado',
        'Orden de trabajo',
        `${row.number} · ${result.fileName}${result.whatsappOpened ? ' · WhatsApp abierto' : ' · sin WhatsApp'}`,
        row.id
      )
      return result
    }

    case 'orders.setCredentials': {
      requireModuleAccess(session, 'orders')
      requireCap(session, 'diagnoseOrder')
      const row = getOrderOrFail(db, text(payload?.id, 'Orden', 1, 80))
      if (['entregado', 'no_reparado'].includes(row.status)) fail('La OT ya está cerrada; no admite credenciales.')
      requireCredentialAccess(session, row)
      if (typeof payload?.secret !== 'string' || !payload.secret.trim()) {
        fail('Escribe la contraseña, PIN o patrón del equipo.')
      }
      const intake = (() => {
        try {
          return JSON.parse(row.intake_json ?? '{}')
        } catch {
          return {}
        }
      })()
      db.tx(() => {
        writeOrderCredentials(db, session, row.id, row.number, String(intake.lockType ?? 'otro'), payload)
      })
      return orderDto(db, getOrderOrFail(db, row.id))
    }

    case 'orders.revealCredentials': {
      requireModuleAccess(session, 'orders')
      requireCap(session, 'diagnoseOrder')
      const row = getOrderOrFail(db, text(payload?.id, 'Orden', 1, 80))
      requireCredentialAccess(session, row)
      const credential = db.get<any>('SELECT * FROM work_order_credentials WHERE work_order_id = ?', row.id)
      if (!credential) fail('La OT no tiene credenciales guardadas.', 'NOT_FOUND')
      let parsed: any
      try {
        parsed = JSON.parse(safeStorage.decryptString(Buffer.from(String(credential.payload_encrypted), 'base64')))
      } catch {
        fail('No se pudo descifrar la credencial. Puede pertenecer a otro equipo o usuario de Windows.')
      }
      const nowIso = new Date().toISOString()
      const actorName = displayUser(session).name
      db.tx(() => {
        db.run(
          `UPDATE work_order_credentials
           SET last_viewed_at = ?, last_viewed_by = ?, last_viewed_by_name = ?, view_count = view_count + 1
           WHERE work_order_id = ?`,
          nowIso,
          session.userId,
          actorName,
          row.id
        )
        audit(
          db,
          session,
          'Consulta de credenciales del equipo',
          'Orden de trabajo',
          `${row.number} · vista ${Number(credential.view_count) + 1}`,
          row.id
        )
      })
      const updated = db.get<any>('SELECT updated_at, view_count FROM work_order_credentials WHERE work_order_id = ?', row.id)
      return {
        kind: String(parsed?.kind ?? 'otro'),
        username: String(parsed?.username ?? ''),
        secret: String(parsed?.secret ?? ''),
        note: String(parsed?.note ?? ''),
        updatedAt: updated?.updated_at ?? credential.updated_at,
        viewCount: Number(updated?.view_count ?? 1)
      }
    }

    case 'orders.deleteCredentials': {
      requireModuleAccess(session, 'orders')
      requireCap(session, 'diagnoseOrder')
      const row = getOrderOrFail(db, text(payload?.id, 'Orden', 1, 80))
      requireCredentialAccess(session, row)
      db.tx(() => {
        db.run('DELETE FROM work_order_credentials WHERE work_order_id = ?', row.id)
        audit(db, session, 'Credenciales de equipo eliminadas', 'Orden de trabajo', `${row.number} · eliminación manual`, row.id)
      })
      return orderDto(db, getOrderOrFail(db, row.id))
    }

    case 'evidence.add': {
      requireModuleAccess(session, 'orders')
      requireCap(session, 'manageEvidence')
      const order = getOrderOrFail(db, text(payload?.orderId, 'Orden', 1, 80))
      const stage = schema(payload?.stage ?? 'reparacion', z.enum(['ingreso', 'reparacion']))
      const capturedAt = new Date().toISOString()
      const prepared = prepareEvidenceFiles({
        userDataPath: runtime.userDataPath,
        orderId: order.id,
        actor: { userId: session.userId, userName: displayUser(session).name },
        images: payload?.images,
        stage,
        capturedAt,
        existingBytes: evidenceBytesForOrder(db, order.id)
      })
      try {
        db.tx(() => {
          insertEvidenceRows(db, prepared)
          audit(
            db,
            session,
            'Evidencias fotográficas agregadas',
            'Orden de trabajo',
            `${order.number} · ${prepared.length} foto${prepared.length === 1 ? '' : 's'} · etapa ${stage}`,
            order.id
          )
        })
      } catch (error) {
        cleanupEvidenceFiles(prepared)
        throw error
      }
      return orderDto(db, getOrderOrFail(db, order.id))
    }

    case 'evidence.void': {
      requireModuleAccess(session, 'orders')
      requireCap(session, 'voidEvidence')
      const evidence = getEvidenceOrFail(db, text(payload?.id, 'Evidencia', 1, 80))
      if (evidence.status === 'anulada') fail('La evidencia ya está anulada.')
      const reason = text(payload?.reason, 'Motivo de anulación', 5, 500)
      const nowIso = new Date().toISOString()
      const name = displayUser(session).name
      db.tx(() => {
        db.run(
          `UPDATE work_order_evidence
           SET status = 'anulada', voided_at = ?, voided_by = ?, voided_by_name = ?, void_reason = ?
           WHERE id = ?`,
          nowIso,
          session.userId,
          name,
          reason,
          evidence.id
        )
        audit(
          db,
          session,
          'Anulación de evidencia',
          'Evidencia',
          `${evidence.order_number} · ${evidence.filename} · ${reason}. El archivo se conserva para auditoría.`,
          evidence.id
        )
      })
      return orderDto(db, getOrderOrFail(db, evidence.work_order_id))
    }

    case 'evidence.verify': {
      requireModuleAccess(session, 'orders')
      requireCap(session, 'verifyEvidence')
      const evidence = getEvidenceOrFail(db, text(payload?.id, 'Evidencia', 1, 80))
      if (evidence.status === 'anulada') fail('No se puede verificar una evidencia anulada.')
      if (!evidence.verified_at) {
        const nowIso = new Date().toISOString()
        db.tx(() => {
          db.run(
            'UPDATE work_order_evidence SET verified_at = ?, verified_by = ?, verified_by_name = ? WHERE id = ?',
            nowIso,
            session.userId,
            displayUser(session).name,
            evidence.id
          )
          audit(
            db,
            session,
            'Verificación de evidencia',
            'Evidencia',
            `${evidence.order_number} · ${evidence.filename} · integridad confirmada`,
            evidence.id
          )
        })
      }
      return orderDto(db, getOrderOrFail(db, evidence.work_order_id))
    }

    case 'evidence.export': {
      requireModuleAccess(session, 'orders')
      requireCap(session, 'exportEvidence')
      const order = getOrderOrFail(db, text(payload?.orderId, 'Orden', 1, 80))
      const rows = db.all<any>(
        'SELECT * FROM work_order_evidence WHERE work_order_id = ? ORDER BY captured_at ASC, rowid ASC',
        order.id
      )
      if (!rows.length) fail('La OT no tiene evidencias fotográficas para exportar.')
      const exportedAt = new Date().toISOString()
      const activeRows = rows.filter((row) => row.status === 'activa')
      const entries: Array<{ name: string; data: Buffer }> = []
      const manifestRows = rows.map((row) => {
        let integrity: 'ok' | 'missing' | 'mismatch' = 'missing'
        let actualHash: string | null = null
        let size = Number(row.size_bytes)
        try {
          const absolute = resolveEvidenceFile(runtime.userDataPath, String(row.path))
          if (fs.existsSync(absolute)) {
            const bytes = fs.readFileSync(absolute)
            size = bytes.length
            actualHash = sha256Bytes(bytes)
            integrity = actualHash === row.sha256 ? 'ok' : 'mismatch'
            entries.push({ name: `evidencias/${row.filename}`, data: bytes })
          }
        } catch {
          integrity = 'missing'
        }
        return {
          id: row.id,
          category: row.category,
          note: row.note,
          stage: row.stage,
          status: row.status,
          source: row.source,
          filename: row.filename,
          path: row.path,
          size,
          sha256: row.sha256,
          actualSha256: actualHash,
          integrity,
          capturedAt: row.captured_at,
          capturedByName: row.captured_by_name,
          verifiedAt: row.verified_at,
          verifiedByName: row.verified_by_name,
          voidedAt: row.voided_at,
          voidedByName: row.voided_by_name,
          voidReason: row.void_reason
        }
      })
      let legalSnapshot: any = null
      try {
        legalSnapshot = order.intake_json ? JSON.parse(order.intake_json)?.legal ?? null : null
      } catch {
        legalSnapshot = null
      }
      const manifest = {
        app: 'BitacoreTech Taller & POS',
        formatVersion: 1,
        exportedAt,
        exportedBy: displayUser(session).name,
        order: {
          id: order.id,
          number: order.number,
          customerName: order.customer_name,
          equipmentType: order.equipment_type,
          brand: order.brand,
          model: order.model,
          serial: order.serial,
          status: order.status,
          createdAt: order.created_at,
          reportedIssue: order.reported_issue
        },
        legalSnapshot,
        evidence: {
          activeCount: activeRows.length,
          activeBytes: activeRows.reduce((sum, row) => sum + Number(row.size_bytes ?? 0), 0),
          setHash: evidenceSetHash(rows),
          rows: manifestRows
        },
        disclaimer:
          'Evidencias digitales del estado del equipo al ingreso y durante la reparación. No se imprimen ni se anexan al comprobante A4; este ZIP y su manifiesto sustentan reclamos.'
      }
      entries.unshift({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') })
      const zip = createZip(entries)
      const hash = sha256Bytes(zip)
      const filename = `${order.number.replace(/[^A-Za-z0-9_-]/g, '-')}-evidencias.zip`
      audit(
        db,
        session,
        'Exportación de evidencias',
        'Orden de trabajo',
        `${order.number} · ${activeRows.length} evidencias activas · ZIP ${hash.slice(0, 12)}…`,
        order.id
      )
      return {
        filename,
        mimeType: 'application/zip',
        base64: zip.toString('base64'),
        size: zip.length,
        count: activeRows.length,
        sha256: hash
      }
    }

    case 'orders.create': {
      requireModuleAccess(session, 'orders')
      requireCap(session, 'createOrder')
      const customerId = text(payload?.customerId, 'Cliente', 1, 80)
      const customer = db.get<any>('SELECT * FROM customers WHERE id = ?', customerId)
      if (!customer) fail('Selecciona un cliente válido')
      const intakeInput = payload?.intake && typeof payload.intake === 'object' ? payload.intake : {}
      const category = text(payload?.deviceCategory ?? intakeInput.category ?? 'otro', 'Categoría', 2, 40)
      const categoryLabel = text(payload?.categoryLabel ?? intakeInput.categoryLabel ?? 'Equipo', 'Tipo de equipo', 2, 80)
      const equipmentType = text(payload?.equipmentType ?? categoryLabel, 'Tipo de equipo', 2, 80)
      const customBuild = Boolean(payload?.customBuild ?? intakeInput.customBuild)
      if (customBuild && !supportsCustomBuild(category)) {
        fail('El modo de equipo armado solo aplica a PC Torre u Otro.')
      }
      const alias = customBuild ? text(payload?.alias ?? intakeInput.alias, 'Alias del equipo', 2, 120) : null
      const brand = customBuild ? 'Armado' : text(payload?.brand, 'Marca', 1, 80)
      const model = customBuild ? String(alias) : text(payload?.model, 'Modelo', 1, 120)
      const reportedIssue = text(payload?.reportedIssue, 'Falla reportada', 4, 3000)
      const nowIso = new Date().toISOString()
      const technicianName = typeof payload?.technician === 'string' ? payload.technician : ''
      const requestedTechnicianId = typeof payload?.technicianId === 'string' ? payload.technicianId : ''
      let technician: any = null
      if (requestedTechnicianId) {
        technician = db.get<any>(
          "SELECT * FROM users WHERE id = ? AND active = 1 AND role IN ('tecnico', 'admin')",
          requestedTechnicianId
        )
        if (!technician) fail('El técnico seleccionado no está activo.')
      } else if (technicianName) {
        technician = db.get<any>(
          "SELECT * FROM users WHERE name = ? AND active = 1 AND role IN ('tecnico', 'admin')",
          technicianName
        )
        if (!technician) fail('El técnico seleccionado no está activo.')
      }
      if (!technician && technicianOptions(db).length > 0) {
        fail('Selecciona un técnico para asignar la orden de trabajo.')
      }
      const requestedEquipmentId = typeof payload?.equipmentId === 'string' ? payload.equipmentId : ''
      let selectedEquipmentRow: any = null
      if (requestedEquipmentId) {
        selectedEquipmentRow = db.get<any>('SELECT * FROM equipment WHERE id = ? AND customer_id = ?', requestedEquipmentId, customerId)
        if (!selectedEquipmentRow) fail('El equipo seleccionado no pertenece al cliente.')
      }
      const id = `wo_${sha256(`${customerId}|${Date.now()}|${Math.random()}`).slice(0, 20)}`
      const number = db.orderNumber()
      const intake = {
        ...intakeInput,
        category,
        categoryLabel,
        customBuild: customBuild || undefined,
        alias: alias ?? undefined,
        estimate: Math.max(0, numberValue(intakeInput.estimate ?? 0, 'Presupuesto', { min: 0 })),
        diagnosticFee: Math.max(0, numberValue(intakeInput.diagnosticFee ?? 0, 'Diagnóstico', { min: 0 })),
        accessories: Array.isArray(intakeInput.accessories) ? intakeInput.accessories.slice(0, 40) : [],
        receivedBy: displayUser(session).name,
        receivedAt: nowIso,
        legal: createSnapshot(db, nowIso)
      }
      const physicalCondition = text(payload?.physicalCondition ?? 'Sin observaciones', 'Condición física', 1, 3000)
      const accessories = text(payload?.accessories ?? 'Sin accesorios', 'Accesorios', 1, 1000)
      const serial = customBuild
        ? selectedEquipmentRow?.brand === 'Armado'
          ? selectedEquipmentRow.serial
          : customBuildSerial(`${customerId}|${model}|${Date.now()}|${Math.random()}`)
        : text(payload?.serial ?? 'Sin serial', 'Serial', 1, 120)
      const promisedAt = isoDate(payload?.promisedAt, 'Fecha de promesa')
      const preparedEvidence = Array.isArray(payload?.evidence) && payload.evidence.length
        ? prepareEvidenceFiles({
            userDataPath: runtime.userDataPath,
            orderId: id,
            actor: { userId: session.userId, userName: displayUser(session).name },
            images: payload.evidence,
            stage: 'ingreso',
            capturedAt: nowIso,
            existingBytes: 0
          })
        : []
      try {
        db.tx(() => {
        let equipmentId = requestedEquipmentId
        if (equipmentId) {
          db.run('UPDATE equipment SET updated_at = ? WHERE id = ?', nowIso, equipmentId)
        } else {
          const existingEquipment = customBuild
            ? null
            : db.get<any>(
                `SELECT * FROM equipment
                 WHERE customer_id = ? AND serial = ? COLLATE NOCASE AND brand = ? COLLATE NOCASE AND model = ? COLLATE NOCASE
                 LIMIT 1`,
                customerId,
                serial,
                brand,
                model
              )
          if (existingEquipment) {
            equipmentId = existingEquipment.id
            db.run('UPDATE equipment SET updated_at = ? WHERE id = ?', nowIso, equipmentId)
          } else {
            equipmentId = `eq_${sha256(`${customerId}|${serial}|${Date.now()}`).slice(0, 20)}`
            db.run(
              `INSERT INTO equipment
                (id, customer_id, category, category_label, equipment_type, brand, model, serial, accessories,
                 technical_sheet_json, notes, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
              equipmentId,
              customerId,
              category,
              categoryLabel,
              equipmentType,
              brand,
              model,
              serial,
              accessories,
              intakeInput.technicalSheet && typeof intakeInput.technicalSheet === 'object'
                ? JSON.stringify(intakeInput.technicalSheet)
                : null,
              nowIso,
              nowIso
            )
            audit(
              db,
              session,
              'Creación de equipo',
              'Equipo',
              `${customer.name} · ${brand} ${model} · ${serial} · creado desde la OT`,
              equipmentId
            )
          }
        }
        db.run(
          `INSERT INTO work_orders
            (id, number, customer_id, equipment_id, device_category, category_label, equipment_type, brand, model, serial,
             accessories, physical_condition, reported_issue, diagnosis, status, technician_id, created_at,
             promised_at, notes, intake_json, received_by, created_by, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'recibido', ?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          number,
          customerId,
          equipmentId,
          category,
          categoryLabel,
          equipmentType,
          brand,
          model,
          serial,
          accessories,
          physicalCondition,
          reportedIssue,
          technician?.id ?? null,
          nowIso,
          promisedAt,
          typeof payload?.notes === 'string' ? payload.notes.slice(0, 3000) : null,
          JSON.stringify(intake),
          displayUser(session).name,
          session.userId,
          nowIso
        )
        if (
          payload?.credentials &&
          typeof payload.credentials === 'object' &&
          typeof payload.credentials.secret === 'string' &&
          payload.credentials.secret.trim()
        ) {
          writeOrderCredentials(db, session, id, number, String(intake.lockType ?? 'otro'), payload.credentials)
        }
        db.run(
          `INSERT INTO work_order_events
            (id, work_order_id, status, title, description, user_id, user_name, state, created_at)
           VALUES (?, ?, 'recibido', 'Equipo recibido', ?, ?, ?, 'current', ?)`,
          `evt_${Date.now()}`,
          id,
          preparedEvidence.length
            ? `Recepción, checklist de estado y comprobante de ingreso generado. ${preparedEvidence.length} evidencia${preparedEvidence.length === 1 ? '' : 's'} fotográfica${preparedEvidence.length === 1 ? '' : 's'} del estado del equipo registrada${preparedEvidence.length === 1 ? '' : 's'}.`
            : 'Recepción, checklist de estado y comprobante de ingreso generado. Sin evidencia fotográfica al ingreso.',
          session.userId,
          displayUser(session).name,
          nowIso
        )
        if (technician) {
          db.run(
            `INSERT INTO work_order_assignments
              (id, work_order_id, from_user_id, from_name, to_user_id, to_name, reason, assigned_by, assigned_by_name, created_at)
             VALUES (?, ?, NULL, NULL, ?, ?, 'Asignación inicial', ?, ?, ?)`,
            `asg_${sha256(`${id}|${technician.id}|${nowIso}`).slice(0, 20)}`,
            id,
            technician.id,
            technician.name,
            session.userId,
            displayUser(session).name,
            nowIso
          )
          db.run(
            `INSERT INTO work_order_events
              (id, work_order_id, status, title, description, user_id, user_name, state, created_at)
             VALUES (?, ?, 'recibido', 'Asignación de técnico', ?, ?, ?, 'done', ?)`,
            `evt_${Date.now()}_tech`,
            id,
            `OT asignada a ${technician.name}.`,
            session.userId,
            displayUser(session).name,
            nowIso
          )
        }
        if (preparedEvidence.length) insertEvidenceRows(db, preparedEvidence)
        audit(
          db,
          session,
          'Creación de OT',
          'Orden de trabajo',
          `${number} · ${customer.name} · ${brand} ${model} · ${preparedEvidence.length ? `${preparedEvidence.length} foto${preparedEvidence.length === 1 ? '' : 's'}` : 'sin evidencia fotográfica'}`,
          id
        )
        })
      } catch (error) {
        cleanupEvidenceFiles(preparedEvidence)
        throw error
      }
      return orderDto(db, getOrderOrFail(db, id))
    }

    case 'orders.reassignTechnician': {
      requireModuleAccess(session, 'orders')
      requireCap(session, 'assignTechnician')
      const row = getOrderOrFail(db, text(payload?.id, 'Orden', 1, 80))
      if (['entregado', 'no_reparado'].includes(row.status)) {
        fail('La OT ya está cerrada; no se puede reasignar.')
      }
      const technicianId = text(payload?.technicianId, 'Técnico', 1, 80)
      const technician = db.get<any>(
        "SELECT * FROM users WHERE id = ? AND active = 1 AND role IN ('tecnico', 'admin')",
        technicianId
      )
      if (!technician) fail('Selecciona un técnico activo.')
      if (row.technician_id === technician.id) fail('La OT ya está asignada a ese técnico.')
      const reason = text(payload?.reason, 'Motivo de la reasignación', 3, 500)
      const from = row.technician_id
        ? db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', row.technician_id)
        : null
      const now = new Date().toISOString()
      db.tx(() => {
        db.run('UPDATE work_orders SET technician_id = ?, updated_at = ? WHERE id = ?', technician.id, now, row.id)
        db.run(
          `INSERT INTO work_order_assignments
            (id, work_order_id, from_user_id, from_name, to_user_id, to_name, reason, assigned_by, assigned_by_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          `asg_${sha256(`${row.id}|${technician.id}|${Date.now()}`).slice(0, 20)}`,
          row.id,
          row.technician_id ?? null,
          from?.name ?? null,
          technician.id,
          technician.name,
          reason,
          session.userId,
          displayUser(session).name,
          now
        )
        db.run(
          `INSERT INTO work_order_events
            (id, work_order_id, status, title, description, user_id, user_name, state, created_at)
           VALUES (?, ?, ?, 'Reasignación de técnico', ?, ?, ?, 'done', ?)`,
          `evt_${Date.now()}`,
          row.id,
          row.status,
          `De ${from?.name ?? 'Sin asignar'} a ${technician.name}. Motivo: ${reason}`,
          session.userId,
          displayUser(session).name,
          now
        )
        audit(
          db,
          session,
          'Reasignación de técnico',
          'Orden de trabajo',
          `${row.number} · ${from?.name ?? 'Sin asignar'} → ${technician.name} · ${reason}`,
          row.id
        )
      })
      return orderDto(db, getOrderOrFail(db, row.id))
    }

    case 'orders.update': {
      requireModuleAccess(session, 'orders')
      const row = getOrderOrFail(db, text(payload?.id, 'Orden', 1, 80))
      if (['entregado', 'no_reparado'].includes(row.status)) fail('La OT ya está cerrada.')
      const updates: string[] = []
      const params: any[] = []
      if (typeof payload?.diagnosis === 'string') {
        requireCap(session, 'diagnoseOrder')
        updates.push('diagnosis = ?')
        params.push(payload.diagnosis.slice(0, 5000))
      }
      if (typeof payload?.notes === 'string') {
        requireCap(session, 'diagnoseOrder')
        updates.push('notes = ?')
        params.push(payload.notes.slice(0, 3000))
      }
      if (payload?.promisedAt) {
        requireCap(session, 'createOrder')
        updates.push('promised_at = ?')
        params.push(isoDate(payload.promisedAt, 'Fecha de promesa'))
      }
      if (!updates.length) fail('No hay cambios para guardar')
      updates.push('updated_at = ?')
      params.push(new Date().toISOString(), row.id)
      db.tx(() => {
        db.run(`UPDATE work_orders SET ${updates.join(', ')} WHERE id = ?`, ...params)
        audit(db, session, 'Actualización de OT', 'Orden de trabajo', `${row.number} · diagnóstico y notas actualizados`, row.id)
      })
      return orderDto(db, getOrderOrFail(db, row.id))
    }

    case 'orders.transition': {
      requireModuleAccess(session, 'orders')
      requireCap(session, 'diagnoseOrder')
      const row = getOrderOrFail(db, text(payload?.id, 'Orden', 1, 80))
      if (['entregado', 'no_reparado'].includes(row.status)) fail('La OT ya está cerrada.')
      const nextStatus = text(payload?.status, 'Estado', 2, 40)
      if (nextStatus === 'entregado') fail('La entrega se registra desde Cobrar y entregar para asegurar el pago.')
      if (nextStatus === 'no_reparado') {
        const reason = text(payload?.reason ?? 'Cierre manual de la OT', 'Motivo', 3, 500)
        db.tx(() => {
          db.run('UPDATE work_order_events SET state = ? WHERE work_order_id = ? AND state = ?', 'done', row.id, 'current')
          db.run(
            `INSERT INTO work_order_events (id, work_order_id, status, title, description, user_id, user_name, state, created_at)
             VALUES (?, ?, 'no_reparado', 'No reparado', ?, ?, ?, 'current', ?)`,
            `evt_${Date.now()}`,
            row.id,
            reason,
            session.userId,
            displayUser(session).name,
            new Date().toISOString()
          )
          db.run("UPDATE work_orders SET status = 'no_reparado', updated_at = ? WHERE id = ?", new Date().toISOString(), row.id)
          purgeOrderCredentials(db, session, row.id, row.number, 'Cierre como No reparado')
          audit(db, session, 'Cambio de estado OT', 'Orden de trabajo', `${row.number} · ${row.status} → No reparado · ${reason}`, row.id)
        })
        return orderDto(db, getOrderOrFail(db, row.id))
      }
      const statusConfig = db.get<any>('SELECT * FROM order_status_config WHERE status = ?', nextStatus)
      if (!statusConfig) fail('Estado de OT inválido')
      const currentIndex = STATUS_FLOW.indexOf(row.status)
      const nextIndex = STATUS_FLOW.indexOf(nextStatus)
      if (nextIndex <= currentIndex) fail('El estado solo puede avanzar en la secuencia del taller.')
      const diagnosis = typeof payload?.diagnosis === 'string' ? payload.diagnosis.slice(0, 5000) : row.diagnosis
      db.tx(() => {
        db.run('UPDATE work_order_events SET state = ? WHERE work_order_id = ? AND state = ?', 'done', row.id, 'current')
        db.run(
          `INSERT INTO work_order_events (id, work_order_id, status, title, description, user_id, user_name, state, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'current', ?)`,
          `evt_${Date.now()}`,
          row.id,
          nextStatus,
          statusConfig.short_label,
          statusConfig.description,
          session.userId,
          displayUser(session).name,
          new Date().toISOString()
        )
        db.run(
          'UPDATE work_orders SET status = ?, diagnosis = ?, updated_at = ? WHERE id = ?',
          nextStatus,
          diagnosis,
          new Date().toISOString(),
          row.id
        )
        audit(
          db,
          session,
          'Cambio de estado OT',
          'Orden de trabajo',
          `${row.number} · ${row.status} → ${statusConfig.short_label}`,
          row.id
        )
      })
      return orderDto(db, getOrderOrFail(db, row.id))
    }

    case 'orders.addItem': {
      requireModuleAccess(session, 'orders')
      if (!canSession(session, 'diagnoseOrder') && !canSession(session, 'createOrder')) {
        requireCap(session, 'diagnoseOrder')
      }
      const row = getOrderOrFail(db, text(payload?.id, 'Orden', 1, 80))
      if (['entregado', 'no_reparado'].includes(row.status)) fail('La OT ya está cerrada.')
      const type = schema(payload?.type, z.enum(['servicio', 'repuesto']))
      const description = text(payload?.description, 'Descripción', 2, 300)
      const quantity = numberValue(payload?.quantity ?? 1, 'Cantidad', { min: 0.01 })
      const unitPrice = numberValue(payload?.unitPrice, 'Valor', { min: 0 })
      const productId = typeof payload?.productId === 'string' && payload.productId ? payload.productId : null
      let unitCost = 0
      let product: any = null
      if (productId) {
        product = db.get<any>('SELECT * FROM products WHERE id = ? AND active = 1', productId)
        if (!product) fail('Producto no encontrado')
        unitCost = Number(product.cost_cents)
        if (!product.is_service && Number(product.stock) < quantity) fail(`Stock insuficiente de ${product.name}. Disponible: ${product.stock}`)
      }
      const nowIso = new Date().toISOString()
      const itemId = `woi_${Date.now()}`
      db.tx(() => {
        db.run(
          `INSERT INTO work_order_items
            (id, work_order_id, type, description, quantity, unit_price_cents, product_id, unit_cost_cents, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          itemId,
          row.id,
          type,
          description,
          quantity,
          toCents(unitPrice),
          productId,
          unitCost,
          nowIso
        )
        if (product && !product.is_service) {
          db.run('UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?', quantity, nowIso, product.id)
          db.run(
            `INSERT INTO stock_movements
              (id, product_id, type, quantity, unit_cost_cents, reason, reference_type, reference_id, user_id, user_name, created_at)
             VALUES (?, ?, 'consumo_ot', ?, ?, ?, 'work_order', ?, ?, ?, ?)`,
            `sm_${Date.now()}`,
            product.id,
            -Math.abs(quantity),
            unitCost,
            `Consumo en ${row.number}`,
            row.id,
            session.userId,
            displayUser(session).name,
            nowIso
          )
        }
        db.run('UPDATE work_orders SET updated_at = ? WHERE id = ?', nowIso, row.id)
        audit(
          db,
          session,
          'Ítem agregado a OT',
          'Orden de trabajo',
          `${row.number} · ${description} × ${quantity} · ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(unitPrice)}`,
          row.id
        )
      })
      return orderDto(db, getOrderOrFail(db, row.id))
    }

    case 'orders.addPayment': {
      requireModuleAccess(session, 'orders')
      requireCap(session, 'settleOrder')
      const row = getOrderOrFail(db, text(payload?.id, 'Orden', 1, 80))
      if (['entregado', 'no_reparado'].includes(row.status)) fail('La OT ya está cerrada; no admite anticipos.')
      const totalCents = orderItemsTotal(db, row.id) || toCents(JSON.parse(row.intake_json ?? '{}').estimate ?? 0)
      if (!totalCents) fail('Primero registra ítems o un presupuesto en la OT.')
      const paidCents = Number(orderPaidTotal(db, row.id))
      const balanceCents = totalCents - paidCents
      if (balanceCents <= 0) fail('La OT ya está pagada en su totalidad.')
      const amount = numberValue(payload?.amount, 'Valor del anticipo', { min: 0.01 })
      const amountCents = toCents(amount)
      if (amountCents > balanceCents) fail(`El anticipo supera el saldo pendiente (${money(balanceCents)}).`)
      const method = schema(payload?.method, z.enum(['Efectivo', 'Transferencia', 'Tarjeta', 'Mixto']))
      requireCashSession(db)
      const number = db.paymentNumber()
      const id = `pay_${sha256(`${row.id}|${number}|${Date.now()}`).slice(0, 20)}`
      const nowIso = new Date().toISOString()
      db.tx(() => {
        db.run(
          `INSERT INTO payments
            (id, number, kind, order_id, invoice_id, method, amount_cents, received_cents, change_cents, reference,
             is_exception, created_by, created_by_name, created_at)
           VALUES (?, ?, 'anticipo', ?, NULL, ?, ?, ?, 0, ?, 0, ?, ?, ?)`,
          id,
          number,
          row.id,
          method,
          amountCents,
          amountCents,
          typeof payload?.reference === 'string' ? payload.reference.slice(0, 160) : null,
          session.userId,
          displayUser(session).name,
          nowIso
        )
        recordCash(db, session, {
          type: 'ingreso',
          method,
          amountCents,
          reason: `Anticipo ${row.number} · ${row.customer_name}`,
          referenceType: 'payment',
          referenceId: id,
          createdAt: nowIso
        })
        audit(
          db,
          session,
          'Registro de pago',
          'Orden de trabajo',
          `${row.number} · anticipo ${number} · ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(amount)} · ${method}`,
          row.id
        )
      })
      return orderDto(db, getOrderOrFail(db, row.id))
    }

    case 'orders.settle': {
      requireModuleAccess(session, 'orders')
      requireCap(session, 'settleOrder')
      const row = getOrderOrFail(db, text(payload?.id, 'Orden', 1, 80))
      if (row.status === 'entregado') fail('La OT ya fue entregada y cerrada.')
      if (row.status !== 'listo') fail('La OT debe estar en estado Listo para entrega antes de cobrar y entregar.')
      const intake = JSON.parse(row.intake_json ?? '{}')
      const subtotalCents = orderItemsTotal(db, row.id) || toCents(intake.estimate ?? 0)
      const customer = db.get<any>('SELECT * FROM customers WHERE id = ?', row.customer_id)
      const noCharge = Boolean(payload?.noCharge)
      if (noCharge) {
        requireCap(session, 'authorizeNoCharge')
        if (Number(orderPaidTotal(db, row.id)) > 0) fail('No se puede entregar sin cobro una OT que ya tiene pagos registrados.')
      } else if (subtotalCents <= 0) {
        fail('No hay valores por cobrar. Agrega ítems, presupuesto o autoriza la entrega sin cobro.')
      }
      const discount = noCharge
        ? { type: 'percent' as const, value: 0, source: 'none' as const }
        : resolveSaleDiscount(customer, payload, session, subtotalCents)
      const discountCents = noCharge ? 0 : discountCentsFor(discount.type, discount.value, subtotalCents)
      const orderItemRows = db.all<any>('SELECT * FROM work_order_items WHERE work_order_id = ?', row.id)
      if (!noCharge) {
        assertDiscountFloor(
          orderItemRows.map((item) => ({
            name: item.description,
            quantity: Number(item.quantity),
            unitPriceCents: Number(item.unit_price_cents),
            unitCostCents: Number(item.unit_cost_cents),
            isService: item.type === 'servicio'
          })),
          subtotalCents,
          discountCents
        )
      }
      const totalCents = subtotalCents - discountCents
      const paidCents = Number(orderPaidTotal(db, row.id))
      const method = schema(payload?.method ?? 'Efectivo', z.enum(['Efectivo', 'Transferencia', 'Tarjeta', 'Mixto']))
      const exceptionReason = noCharge ? text(payload?.exceptionReason, 'Motivo de la excepción', 5, 500) : ''
      const balanceCents = Math.max(totalCents - paidCents, 0)
      const chargeCents = noCharge ? 0 : balanceCents
      const receivedCents = numberValue(payload?.received ?? money(chargeCents), 'Efectivo recibido', { min: 0 })
      const received = toCents(receivedCents)
      if (!noCharge && method === 'Efectivo' && received < chargeCents) fail('El efectivo recibido es menor al saldo por cobrar.')
      const changeCents = method === 'Efectivo' && !noCharge ? Math.max(received - chargeCents, 0) : 0
      const nowIso = new Date().toISOString()
      requireCashSession(db)
      let invoice: { id: string; number: string } | null = null
      db.tx(() => {
        invoice = createOrderInvoice(
          db,
          session,
          row,
          subtotalCents,
          totalCents,
          method,
          noCharge,
          exceptionReason,
          {
            type: discount.type as 'percent' | 'amount',
            value: discount.value,
            cents: discountCents
          }
        )
        if (!noCharge && chargeCents > 0) {
          const paymentNumber = db.paymentNumber()
          const paymentId = `pay_${sha256(`${row.id}|${paymentNumber}|${Date.now()}`).slice(0, 20)}`
          db.run(
            `INSERT INTO payments
              (id, number, kind, order_id, invoice_id, method, amount_cents, received_cents, change_cents, reference,
               is_exception, created_by, created_by_name, created_at)
             VALUES (?, ?, 'saldo', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
            paymentId,
            paymentNumber,
            row.id,
            invoice!.id,
            method,
            chargeCents,
            received,
            changeCents,
            typeof payload?.reference === 'string' ? payload.reference.slice(0, 160) : null,
            session.userId,
            displayUser(session).name,
            nowIso
          )
          recordCash(db, session, {
            type: 'venta',
            method,
            amountCents: chargeCents,
            reason: `Cobro ${invoice!.number} · ${row.number} · ${row.customer_name}`,
            referenceType: 'invoice',
            referenceId: invoice!.id,
            createdAt: nowIso
          })
        }
        db.run('UPDATE work_order_events SET state = ? WHERE work_order_id = ? AND state = ?', 'done', row.id, 'current')
        db.run(
          `INSERT INTO work_order_events (id, work_order_id, status, title, description, user_id, user_name, state, created_at)
           VALUES (?, ?, 'entregado', ?, ?, ?, ?, 'current', ?)`,
          `evt_${Date.now()}`,
          row.id,
          noCharge ? 'Entregado sin cobro' : 'Entregado y facturado',
          noCharge
            ? `Entrega autorizada sin cobro. Motivo: ${exceptionReason}.`
            : `Factura interna ${invoice!.number} por ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(money(totalCents))}.`,
          session.userId,
          displayUser(session).name,
          nowIso
        )
        db.run(
          "UPDATE work_orders SET status = 'entregado', delivered_at = ?, updated_at = ? WHERE id = ?",
          nowIso,
          nowIso,
          row.id
        )
        purgeOrderCredentials(db, session, row.id, row.number, 'Entrega al cliente')
        audit(
          db,
          session,
          noCharge ? 'Entrega sin cobro' : 'Cobro y entrega de OT',
          'Orden de trabajo',
          noCharge
            ? `${row.number} · sin cobro · ${exceptionReason}`
            : `${row.number} · ${invoice!.number} · ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(money(totalCents))} · saldo ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(money(chargeCents))}`,
          row.id
        )
      })
      return orderDto(db, getOrderOrFail(db, row.id))
    }

    case 'pos.sell': {
      requireModuleAccess(session, 'pos')
      requireCap(session, 'settleOrder')
      const customerId = text(payload?.customerId, 'Cliente', 1, 80)
      const customer = db.get<any>('SELECT * FROM customers WHERE id = ?', customerId)
      if (!customer) fail('Selecciona un cliente válido')
      const lines = schema(
        payload?.lines,
        z
          .array(
            z.object({
              productId: z.string().min(1),
              quantity: z.number().positive(),
              note: z.string().max(500).optional()
            })
          )
          .min(1)
      )
      const method = schema(payload?.method, z.enum(['Efectivo', 'Transferencia', 'Tarjeta', 'Mixto']))
      const prepared = lines.map((line) => {
        const product = db.get<any>('SELECT * FROM products WHERE id = ? AND active = 1', line.productId)
        if (!product) fail('Uno de los productos ya no existe')
        if (!product.is_service && Number(product.stock) < line.quantity) {
          fail(`Stock insuficiente de ${product.name}. Disponible: ${product.stock}`)
        }
        return {
          ...line,
          product,
          note: product.is_service ? line.note?.trim().slice(0, 500) || null : null
        }
      })
      const subtotalCents = prepared.reduce((sum, line) => sum + Number(line.product.price_cents) * line.quantity, 0)
      const discount = resolveSaleDiscount(customer, payload, session, subtotalCents)
      const discountCents = discountCentsFor(discount.type, discount.value, subtotalCents)
      assertDiscountFloor(
        prepared.map((line) => ({
          name: line.product.name,
          quantity: line.quantity,
          unitPriceCents: Number(line.product.price_cents),
          unitCostCents: Number(line.product.cost_cents),
          isService: Boolean(line.product.is_service)
        })),
        subtotalCents,
        discountCents
      )
      const discountPercent = discount.type === 'percent' ? discount.value : 0
      const totalCents = subtotalCents - discountCents
      if (totalCents <= 0) fail('El total de la venta debe ser mayor a cero')
      const received = toCents(numberValue(payload?.received ?? money(totalCents), 'Efectivo recibido', { min: 0 }))
      if (method === 'Efectivo' && received < totalCents) fail('El efectivo recibido es menor al total')
      const changeCents = method === 'Efectivo' ? Math.max(received - totalCents, 0) : 0
      requireCashSession(db)
      const number = db.invoiceNumber()
      const invoiceId = `inv_${sha256(`${number}|${Date.now()}`).slice(0, 20)}`
      const nowIso = new Date().toISOString()
      db.tx(() => {
        db.run(
          `INSERT INTO invoices
            (id, number, type, customer_id, customer_name, subtotal_cents, discount_percent, discount_type, discount_value,
             discount_cents, total_cents, payment_method, status, created_by, created_at)
           VALUES (?, ?, 'venta', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'activa', ?, ?)`,
          invoiceId,
          number,
          customer.id,
          customer.name,
          subtotalCents,
          discountPercent,
          discount.type,
          discount.value,
          discountCents,
          totalCents,
          method,
          session.userId,
          nowIso
        )
        for (const line of prepared) {
          db.run(
            `INSERT INTO invoice_items
              (id, invoice_id, product_id, description, quantity, unit_price_cents, unit_cost_cents, line_total_cents, item_type, note)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            `ii_${sha256(`${invoiceId}|${line.productId}`).slice(0, 20)}`,
            invoiceId,
            line.product.id,
            line.product.name,
            line.quantity,
            line.product.price_cents,
            line.product.cost_cents,
            Math.round(line.product.price_cents * line.quantity),
            line.product.is_service ? 'servicio' : 'producto',
            line.note
          )
          if (!line.product.is_service) {
            db.run('UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?', line.quantity, nowIso, line.product.id)
            db.run(
              `INSERT INTO stock_movements
                (id, product_id, type, quantity, unit_cost_cents, reason, reference_type, reference_id, user_id, user_name, created_at)
               VALUES (?, ?, 'venta', ?, ?, ?, 'invoice', ?, ?, ?, ?)`,
              `sm_${sha256(`${invoiceId}|${line.productId}`).slice(0, 20)}`,
              line.product.id,
              -Math.abs(line.quantity),
              line.product.cost_cents,
              `Venta ${number}`,
              invoiceId,
              session.userId,
              displayUser(session).name,
              nowIso
            )
          }
        }
        db.run(
          `INSERT INTO payments
            (id, number, kind, order_id, invoice_id, method, amount_cents, received_cents, change_cents, reference,
             is_exception, created_by, created_by_name, created_at)
           VALUES (?, ?, 'venta', NULL, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
          `pay_${sha256(`${invoiceId}|${Date.now()}`).slice(0, 20)}`,
          db.paymentNumber(),
          invoiceId,
          method,
          totalCents,
          received,
          changeCents,
          typeof payload?.reference === 'string' ? payload.reference.slice(0, 160) : null,
          session.userId,
          displayUser(session).name,
          nowIso
        )
        recordCash(db, session, {
          type: 'venta',
          method,
          amountCents: totalCents,
          reason: `Venta ${number} · ${customer.name}`,
          referenceType: 'invoice',
          referenceId: invoiceId,
          createdAt: nowIso
        })
        audit(
          db,
          session,
          'Venta POS',
          'Factura',
          `${number} · ${customer.name} · ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(money(totalCents))} · ${method}`,
          invoiceId
        )
      })
      const invoice = db.get<any>('SELECT * FROM invoices WHERE id = ?', invoiceId)
      return {
        invoice: invoiceDto(db, invoice),
        receipt: {
          number,
          total: money(totalCents),
          method,
          received: money(received),
          change: money(changeCents),
          customerName: customer.name,
          lines: prepared.map((line) => ({
            productId: line.product.id,
            name: line.product.name,
            quantity: line.quantity,
            price: money(line.product.price_cents),
            lineTotal: money(line.product.price_cents * line.quantity),
            note: line.note
          }))
        }
      }
    }

    case 'invoices.history': {
      requireModuleAccess(session, 'pos')
      const rows = db.all<any>('SELECT * FROM invoices ORDER BY created_at DESC LIMIT 500')
      return rows.map((row) => invoiceDto(db, row))
    }

    case 'invoices.list': {
      requireModuleAccess(session, 'reports')
      return db.all<any>('SELECT * FROM invoices ORDER BY created_at DESC').map((row) => invoiceDto(db, row))
    }

    case 'invoices.annul': {
      requireModuleAccess(session, 'reports')
      requireCap(session, 'annulInvoice')
      const invoice = getInvoiceRow(db, text(payload?.id, 'Factura', 1, 80))
      if (!invoice) fail('Factura no encontrada', 'NOT_FOUND')
      if (invoice.status === 'anulada') fail('La factura ya está anulada.')
      const reason = text(payload?.reason, 'Motivo', 5, 500)
      db.tx(() => {
        db.run(
          "UPDATE invoices SET status = 'anulada', annulled_at = ?, annulled_by = ?, annul_reason = ? WHERE id = ?",
          new Date().toISOString(),
          session.userId,
          reason,
          invoice.id
        )
        audit(db, session, 'Anulación de factura', 'Factura', `${invoice.number} · ${reason}`, invoice.id)
      })
      return invoiceDto(db, getInvoiceRow(db, invoice.id))
    }

    case 'cash.current': {
      requireModuleAccess(session, 'cash')
      const current = currentCashSession(db)
      if (current) return { current: cashSessionDto(db, current), lastClosed: null, movements: cashSessionDto(db, current).movements }
      const last = db.get<any>("SELECT * FROM cash_sessions WHERE status = 'cerrado' ORDER BY closed_at DESC LIMIT 1")
      return { current: null, lastClosed: last ? cashSessionDto(db, last) : null, movements: [] }
    }

    case 'cash.open': {
      requireModuleAccess(session, 'cash')
      requireCap(session, 'closeCash')
      if (currentCashSession(db)) fail('Ya hay un turno de caja abierto.')
      const initial = numberValue(payload?.initialAmount ?? 200000, 'Base inicial', { min: 0 })
      let id = db.nextSequence('cash_session', 184).toString()
      if (db.get<any>('SELECT id FROM cash_sessions WHERE id = ?', id)) {
        id = db.nextSequence('cash_session', Number(id) + 1).toString()
      }
      if (db.get<any>('SELECT id FROM cash_sessions WHERE id = ?', id)) fail('No se pudo generar un número de turno único.')
      const nowIso = new Date().toISOString()
      db.tx(() => {
        db.run(
          `INSERT INTO cash_sessions (id, opened_by, opened_by_name, opened_at, initial_cents, status)
           VALUES (?, ?, ?, ?, ?, 'abierto')`,
          id,
          session.userId,
          displayUser(session).name,
          nowIso,
          toCents(initial)
        )
        audit(db, session, 'Apertura de caja', 'Caja', `Turno #${id} · base ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(initial)}`)
      })
      return cashSessionDto(db, db.get<any>('SELECT * FROM cash_sessions WHERE id = ?', id))
    }

    case 'cash.addMovement': {
      requireModuleAccess(session, 'cash')
      requireCap(session, 'closeCash')
      const type = schema(payload?.type, z.enum(['ingreso', 'egreso']))
      const method = schema(payload?.method, z.enum(['Efectivo', 'Transferencia', 'Tarjeta', 'Mixto']))
      const amount = numberValue(payload?.amount, 'Valor', { min: 1 })
      const reason = text(payload?.reason, 'Motivo', 3, 240)
      requireCashSession(db)
      db.tx(() => {
        recordCash(db, session, {
          type,
          method,
          amountCents: toCents(amount),
          reason,
          referenceType: 'manual'
        })
        audit(
          db,
          session,
          'Movimiento de caja',
          'Caja',
          `${type === 'ingreso' ? 'Ingreso' : 'Egreso'} · ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(amount)} · ${reason}`
        )
      })
      const current = currentCashSession(db)
      return cashSessionDto(db, current)
    }

    case 'cash.close': {
      requireModuleAccess(session, 'cash')
      requireCap(session, 'closeCash')
      const cashSession = requireCashSession(db)
      const counted = numberValue(payload?.counted, 'Efectivo contado', { min: 0 })
      const notes = typeof payload?.notes === 'string' ? payload.notes.slice(0, 1000) : null
      const dto = cashSessionDto(db, cashSession)
      const expected = toCents(dto.expected)
      const countedCents = toCents(counted)
      const nowIso = new Date().toISOString()
      db.tx(() => {
        db.run(
          `UPDATE cash_sessions
           SET closed_by = ?, closed_by_name = ?, closed_at = ?, expected_cents = ?, counted_cents = ?,
               difference_cents = ?, status = 'cerrado', notes = ?
           WHERE id = ?`,
          session.userId,
          displayUser(session).name,
          nowIso,
          expected,
          countedCents,
          countedCents - expected,
          notes,
          cashSession.id
        )
        audit(
          db,
          session,
          'Cierre de caja',
          'Caja',
          `Turno #${cashSession.id} · esperado ${money(expected)} · contado ${money(countedCents)} · diferencia ${money(countedCents - expected)}`
        )
      })
      return cashSessionDto(db, db.get<any>('SELECT * FROM cash_sessions WHERE id = ?', cashSession.id))
    }

    case 'purchases.list': {
      requireModuleAccess(session, 'purchases')
      const suppliers = db.all<any>('SELECT * FROM suppliers WHERE active = 1 ORDER BY name ASC').map((row) => supplierDto(db, row))
      const purchases = db.all<any>('SELECT * FROM purchases ORDER BY purchase_date DESC').map((row) => purchaseDto(db, row))
      return { purchases, suppliers }
    }

    case 'suppliers.list': {
      requireModuleAccess(session, 'purchases')
      return db.all<any>('SELECT * FROM suppliers WHERE active = 1 ORDER BY name ASC').map((row) => supplierDto(db, row))
    }

    case 'suppliers.create': {
      requireModuleAccess(session, 'purchases')
      requireCap(session, 'createPurchase')
      const name = text(payload?.name, 'Nombre del proveedor', 2, 160)
      if (db.get<any>('SELECT id FROM suppliers WHERE name = ? COLLATE NOCASE', name)) {
        fail('Ya existe un proveedor con ese nombre.', 'DUPLICATE')
      }
      const isForeignNit = Boolean(payload?.isForeignNit)
      let nit = typeof payload?.nit === 'string' && payload.nit.trim() ? payload.nit.trim().slice(0, 40) : '—'
      if (!isForeignNit && nit !== '—') {
        const digits = normalizeNit(nit)
        if (nit !== digits) fail('El NIT debe contener solo números, sin puntos ni espacios.')
        const dv = typeof payload?.nitDv === 'string' ? payload.nitDv.trim() : calculateNitDv(digits)
        if (!isValidNit(digits, dv)) fail('El dígito de verificación del NIT no es válido.')
        nit = digits
      }
      const contact = typeof payload?.contact === 'string' && payload.contact.trim() ? payload.contact.trim().slice(0, 120) : '—'
      const phone = typeof payload?.phone === 'string' && payload.phone.trim() ? payload.phone.trim().slice(0, 80) : '—'
      const category = typeof payload?.category === 'string' && payload.category.trim() ? payload.category.trim().slice(0, 80) : 'Repuestos'
      const id = `sup_${sha256(`${name}|${Date.now()}`).slice(0, 20)}`
      db.tx(() => {
        db.run(
          `INSERT INTO suppliers (id, name, nit, is_foreign_nit, contact, phone, category, active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
          id,
          name,
          nit,
          isForeignNit ? 1 : 0,
          contact,
          phone,
          category,
          new Date().toISOString()
        )
        audit(db, session, 'Creación de proveedor', 'Proveedor', `${name} · NIT ${nit}${isForeignNit ? ' · extranjero' : ''}`, id)
      })
      return supplierDto(db, db.get<any>('SELECT * FROM suppliers WHERE id = ?', id))
    }

    case 'suppliers.update': {
      requireModuleAccess(session, 'purchases')
      requireCap(session, 'createPurchase')
      const id = text(payload?.id, 'Proveedor', 1, 80)
      const row = db.get<any>('SELECT * FROM suppliers WHERE id = ?', id)
      if (!row) fail('Proveedor no encontrado', 'NOT_FOUND')
      const updates: string[] = []
      const params: any[] = []
      if (typeof payload?.name === 'string') {
        const name = text(payload.name, 'Nombre del proveedor', 2, 160)
        const duplicate = db.get<any>('SELECT id FROM suppliers WHERE name = ? COLLATE NOCASE AND id <> ?', name, id)
        if (duplicate) fail('Ya existe un proveedor con ese nombre.', 'DUPLICATE')
        updates.push('name = ?')
        params.push(name)
      }
      const nextForeignNit =
        payload?.isForeignNit === undefined ? Boolean(row.is_foreign_nit) : Boolean(payload.isForeignNit)
      if (payload?.isForeignNit !== undefined) {
        updates.push('is_foreign_nit = ?')
        params.push(nextForeignNit ? 1 : 0)
      }
      if (payload?.nit !== undefined) {
        let nit = typeof payload.nit === 'string' && payload.nit.trim() ? payload.nit.trim().slice(0, 40) : '—'
        if (!nextForeignNit && nit !== '—') {
          const digits = normalizeNit(nit)
          if (nit !== digits) fail('El NIT debe contener solo números, sin puntos ni espacios.')
          const dv = typeof payload?.nitDv === 'string' ? payload.nitDv.trim() : calculateNitDv(digits)
          if (!isValidNit(digits, dv)) fail('El dígito de verificación del NIT no es válido.')
          nit = digits
        }
        updates.push('nit = ?')
        params.push(nit)
      }
      if (payload?.contact !== undefined) {
        updates.push('contact = ?')
        params.push(typeof payload.contact === 'string' && payload.contact.trim() ? payload.contact.trim().slice(0, 120) : '—')
      }
      if (payload?.phone !== undefined) {
        updates.push('phone = ?')
        params.push(typeof payload.phone === 'string' && payload.phone.trim() ? payload.phone.trim().slice(0, 80) : '—')
      }
      if (payload?.category !== undefined) {
        updates.push('category = ?')
        params.push(typeof payload.category === 'string' && payload.category.trim() ? payload.category.trim().slice(0, 80) : 'Repuestos')
      }
      if (payload?.active !== undefined) {
        updates.push('active = ?')
        params.push(payload.active ? 1 : 0)
      }
      if (!updates.length) fail('No hay cambios para guardar')
      db.tx(() => {
        db.run(`UPDATE suppliers SET ${updates.join(', ')} WHERE id = ?`, ...params, id)
        audit(db, session, 'Actualización de proveedor', 'Proveedor', `${row.name} actualizado`, id)
      })
      return supplierDto(db, db.get<any>('SELECT * FROM suppliers WHERE id = ?', id))
    }

    case 'purchases.create': {
      requireModuleAccess(session, 'purchases')
      requireCap(session, 'createPurchase')
      const supplierId = text(payload?.supplierId, 'Proveedor', 1, 80)
      const supplier = db.get<any>('SELECT * FROM suppliers WHERE id = ? AND active = 1', supplierId)
      if (!supplier) fail('Proveedor no encontrado')
      const purchaseNumber = text(payload?.number, 'Número de factura', 1, 80)
      const itemsInput = Array.isArray(payload?.items) ? payload.items : []
      const computedSubtotal = itemsInput.reduce((sum: number, item: any) => {
        const quantity = Number(item?.quantity ?? 1)
        const unitPrice = Number(item?.unitPrice ?? 0)
        return sum + (Number.isFinite(quantity) ? quantity : 0) * (Number.isFinite(unitPrice) ? unitPrice : 0)
      }, 0)
      const subtotal = numberValue(payload?.subtotal ?? computedSubtotal, 'Subtotal', { min: 1 })
      const subtotalCents = toCents(subtotal)
      const ivaCents = Math.round(subtotalCents * 0.19)
      const totalCents = subtotalCents + ivaCents
      const status = schema(payload?.status ?? 'recibida', z.enum(['recibida', 'pendiente']))
      const purchaseDate = isoDate(payload?.date, 'Fecha de compra')
      const id = `pur_${sha256(`${purchaseNumber}|${Date.now()}`).slice(0, 20)}`
      const nowIso = new Date().toISOString()
      db.tx(() => {
        db.run(
          `INSERT INTO purchases
            (id, number, supplier_id, purchase_date, item_count, subtotal_cents, iva_cents, total_cents, status, notes, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          purchaseNumber,
          supplierId,
          purchaseDate,
          itemsInput.length || 1,
          subtotalCents,
          ivaCents,
          totalCents,
          status,
          typeof payload?.notes === 'string' ? payload.notes.slice(0, 1000) : null,
          session.userId,
          nowIso
        )
        if (!itemsInput.length) {
          db.run(
            `INSERT INTO purchase_items (id, purchase_id, product_id, description, quantity, unit_price_cents)
             VALUES (?, ?, NULL, ?, 1, ?)`,
            `puri_${Date.now()}`,
            id,
            'Compra registrada según factura de proveedor',
            subtotalCents
          )
        } else {
          for (const [index, item] of itemsInput.entries()) {
            const product = item?.productId ? db.get<any>('SELECT * FROM products WHERE id = ?', item.productId) : null
            const quantity = numberValue(item?.quantity ?? 1, 'Cantidad', { min: 0.01 })
            const unitPrice = item?.unitPrice !== undefined ? numberValue(item.unitPrice, 'Valor unitario', { min: 0 }) : subtotal / Math.max(itemsInput.length, 1)
            db.run(
              `INSERT INTO purchase_items (id, purchase_id, product_id, description, quantity, unit_price_cents)
               VALUES (?, ?, ?, ?, ?, ?)`,
              `puri_${index}_${Date.now()}`,
              id,
              product?.id ?? null,
              product?.name ?? String(item?.description ?? 'Compra de mercancía').slice(0, 240),
              quantity,
              toCents(unitPrice)
            )
            if (product && status === 'recibida') {
              db.run(
                'UPDATE products SET stock = stock + ?, cost_cents = ?, updated_at = ? WHERE id = ?',
                quantity,
                toCents(unitPrice),
                nowIso,
                product.id
              )
              db.run(
                `INSERT INTO stock_movements
                  (id, product_id, type, quantity, unit_cost_cents, reason, reference_type, reference_id, user_id, user_name, created_at)
                 VALUES (?, ?, 'compra', ?, ?, ?, 'purchase', ?, ?, ?, ?)`,
                `sm_${Date.now()}_${index}`,
                product.id,
                Math.abs(quantity),
                toCents(unitPrice),
                `Compra ${purchaseNumber}`,
                id,
                session.userId,
                displayUser(session).name,
                nowIso
              )
            }
          }
        }
        audit(
          db,
          session,
          'Registro de compra',
          'Compra',
          `${purchaseNumber} · ${supplier.name} · ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(money(totalCents))} · IVA ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(money(ivaCents))}`,
          id
        )
      })
      return purchaseDto(db, db.get<any>('SELECT * FROM purchases WHERE id = ?', id))
    }

    case 'reports.summary': {
      requireModuleAccess(session, 'reports')
      const period = schema(payload?.period ?? '30d', z.enum(['hoy', '7d', '30d', 'ano']))
      return reportData(db, session, period)
    }

    case 'audit.list': {
      requireCap(session, 'viewAudit')
      return db.all<any>('SELECT * FROM audit_log ORDER BY seq DESC LIMIT 1000').map(auditDto)
    }

    case 'audit.verify': {
      requireCap(session, 'viewAudit')
      return db.verifyAuditChain()
    }

    case 'permissions.updateRole': {
      requireModuleAccess(session, 'settings')
      requireCap(session, 'configureLegal')
      const role = schema(payload?.role, z.enum(['admin', 'tecnico', 'cajero']))
      const items = schema(
        payload?.permissions,
        z.array(z.object({ capability: z.string().min(1), allowed: z.boolean() }))
      )
      const now = new Date().toISOString()
      db.tx(() => {
        for (const item of items) {
          const capability = item.capability as BackendCapability
          if (!ALL_CAPABILITIES.includes(capability)) fail(`Permiso desconocido: ${capability}`)
          if (item.allowed && ROOT_ONLY_CAPABILITIES.includes(capability)) {
            fail(`${capability} es exclusivo del propietario y no puede delegarse al rol ${role}.`, 'FORBIDDEN')
          }
          db.run(
            `INSERT INTO role_permissions (role, capability, allowed, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(role, capability) DO UPDATE SET allowed = excluded.allowed, updated_at = excluded.updated_at`,
            role,
            capability,
            item.allowed ? 1 : 0,
            now
          )
        }
        audit(
          db,
          session,
          'Actualización de matriz de permisos',
          'Configuración',
          `Rol ${roleLabels[role]} · ${items.length} permisos revisados.`
        )
      })
      return settingsData(db)
    }

    case 'dictionaries.list': {
      return db
        .all<any>('SELECT * FROM dictionary_nodes ORDER BY type ASC, parent_id ASC, sort_order ASC, name ASC')
        .map((row) => dictionaryNodeDto(db, row))
    }

    case 'dictionaries.create': {
      requireModuleAccess(session, 'settings')
      requireCap(session, 'manageDictionaries')
      const type = schema(payload?.type, z.enum(DICTIONARY_TYPE_VALUES))
      const parentId =
        typeof payload?.parentId === 'string' && payload.parentId
          ? text(payload.parentId, 'Elemento padre', 1, 80)
          : null
      if (parentId) {
        const parent = db.get<any>('SELECT * FROM dictionary_nodes WHERE id = ?', parentId)
        if (!parent) fail('El elemento padre no existe')
        if (parent.type !== type) fail('El elemento padre debe ser del mismo tipo')
      }
      const name = text(payload?.name, 'Nombre', 1, 120)
      const duplicate = db.get<any>(
        "SELECT id FROM dictionary_nodes WHERE type = ? AND IFNULL(parent_id, '') = IFNULL(?, '') AND name = ? COLLATE NOCASE",
        type,
        parentId,
        name
      )
      if (duplicate) fail('Ya existe un valor con ese nombre en este nivel.', 'DUPLICATE')
      const code =
        typeof payload?.code === 'string' && payload.code.trim()
          ? text(payload.code, 'Código', 1, 60)
          : null
      if (code) {
        const codeDuplicate = db.get<any>('SELECT id FROM dictionary_nodes WHERE type = ? AND code = ?', type, code)
        if (codeDuplicate) fail('Ya existe un valor con ese código en este tipo.', 'DUPLICATE')
      }
      const nextSort =
        db.get<{ next: number }>(
          'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM dictionary_nodes WHERE type = ? AND IFNULL(parent_id, \'\') = IFNULL(?, \'\')',
          type,
          parentId
        )?.next ?? 1
      const sortOrder =
        payload?.sortOrder === undefined ? Number(nextSort) : numberValue(payload.sortOrder, 'Orden', { min: 0, max: 99999 })
      const active = payload?.active === undefined ? true : Boolean(payload.active)
      const id = `dict_${sha256(`${type}|${parentId ?? ''}|${name}|${Date.now()}`).slice(0, 20)}`
      const nowIso = new Date().toISOString()
      db.tx(() => {
        db.run(
          `INSERT INTO dictionary_nodes
            (id, parent_id, type, code, name, sort_order, active, system, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
          id,
          parentId,
          type,
          code,
          name,
          sortOrder,
          active ? 1 : 0,
          nowIso,
          nowIso
        )
        const typeLabel = DICTIONARY_TYPES.find((item) => item.value === type)?.label ?? type
        audit(db, session, 'Creación de diccionario', 'Diccionario', `${typeLabel} · ${name}`, id)
      })
      return dictionaryNodeDto(db, db.get<any>('SELECT * FROM dictionary_nodes WHERE id = ?', id))
    }

    case 'dictionaries.update': {
      requireModuleAccess(session, 'settings')
      requireCap(session, 'manageDictionaries')
      const id = text(payload?.id, 'Elemento', 1, 80)
      const row = db.get<any>('SELECT * FROM dictionary_nodes WHERE id = ?', id)
      if (!row) fail('Elemento de diccionario no encontrado', 'NOT_FOUND')
      const updates: string[] = []
      const params: any[] = []
      const changed: string[] = []
      const nextName = payload?.name !== undefined ? text(payload.name, 'Nombre', 1, 120) : row.name
      const currentParent = row.parent_id ?? null
      const nextParent =
        payload?.parentId !== undefined
          ? typeof payload.parentId === 'string' && payload.parentId
            ? text(payload.parentId, 'Elemento padre', 1, 80)
            : null
          : currentParent
      const parentChanged = nextParent !== currentParent
      if (parentChanged) {
        if (row.system) fail('Los elementos del sistema no pueden cambiar de nivel.')
        if (nextParent) {
          if (nextParent === id || dictionaryDescendants(db, id).includes(nextParent)) {
            fail('No puedes mover un elemento dentro de sí mismo.')
          }
          const parent = db.get<any>('SELECT * FROM dictionary_nodes WHERE id = ?', nextParent)
          if (!parent) fail('El elemento padre no existe')
          if (parent.type !== row.type) fail('El elemento padre debe ser del mismo tipo')
        }
      }
      if (nextName !== row.name || parentChanged) {
        const duplicate = db.get<any>(
          "SELECT id FROM dictionary_nodes WHERE type = ? AND IFNULL(parent_id, '') = IFNULL(?, '') AND name = ? COLLATE NOCASE AND id <> ?",
          row.type,
          nextParent,
          nextName,
          id
        )
        if (duplicate) fail('Ya existe un valor con ese nombre en este nivel.', 'DUPLICATE')
      }
      if (nextName !== row.name) {
        updates.push('name = ?')
        params.push(nextName)
        changed.push('nombre')
      }
      if (parentChanged) {
        updates.push('parent_id = ?')
        params.push(nextParent)
        changed.push('nivel')
      }
      if (payload?.code !== undefined) {
        const nextCode =
          typeof payload.code === 'string' && payload.code.trim()
            ? text(payload.code, 'Código', 1, 60)
            : null
        if (row.system && nextCode !== (row.code ?? null)) {
          fail('El código de un elemento del sistema no se puede cambiar.')
        }
        if (nextCode && nextCode !== (row.code ?? null)) {
          const duplicate = db.get<any>('SELECT id FROM dictionary_nodes WHERE type = ? AND code = ? AND id <> ?', row.type, nextCode, id)
          if (duplicate) fail('Ya existe un valor con ese código en este tipo.', 'DUPLICATE')
        }
        if (nextCode !== (row.code ?? null)) {
          updates.push('code = ?')
          params.push(nextCode)
          changed.push('código')
        }
      }
      if (payload?.sortOrder !== undefined) {
        const nextSort = numberValue(payload.sortOrder, 'Orden', { min: 0, max: 99999 })
        if (nextSort !== Number(row.sort_order)) {
          updates.push('sort_order = ?')
          params.push(nextSort)
          changed.push('orden')
        }
      }
      if (payload?.active !== undefined) {
        const nextActive = Boolean(payload.active)
        if (nextActive !== Boolean(row.active)) {
          updates.push('active = ?')
          params.push(nextActive ? 1 : 0)
          changed.push(nextActive ? 'activación' : 'desactivación')
        }
      }
      if (!updates.length) fail('No hay cambios para guardar')
      const nowIso = new Date().toISOString()
      updates.push('updated_at = ?')
      params.push(nowIso, id)
      db.tx(() => {
        db.run(`UPDATE dictionary_nodes SET ${updates.join(', ')} WHERE id = ?`, ...params)
        if (nextName !== row.name) {
          if (row.type === 'inventory_category') {
            db.run('UPDATE products SET category = ?, updated_at = ? WHERE category = ?', nextName, nowIso, row.name)
          } else if (row.type === 'inventory_location') {
            db.run('UPDATE products SET location = ?, updated_at = ? WHERE location = ?', nextName, nowIso, row.name)
          } else if (row.type === 'supplier_category') {
            db.run('UPDATE suppliers SET category = ? WHERE category = ?', nextName, row.name)
          } else if (row.type === 'service_type') {
            db.run('UPDATE products SET service_type = ?, updated_at = ? WHERE service_type = ?', nextName, nowIso, row.name)
          }
        }
        const typeLabel = DICTIONARY_TYPES.find((item) => item.value === row.type)?.label ?? row.type
        audit(db, session, 'Actualización de diccionario', 'Diccionario', `${typeLabel} · ${nextName} · ${changed.join(', ')}`, id)
      })
      return dictionaryNodeDto(db, db.get<any>('SELECT * FROM dictionary_nodes WHERE id = ?', id))
    }

    case 'dictionaries.delete': {
      requireModuleAccess(session, 'settings')
      requireCap(session, 'manageDictionaries')
      const id = text(payload?.id, 'Elemento', 1, 80)
      const row = db.get<any>('SELECT * FROM dictionary_nodes WHERE id = ?', id)
      if (!row) fail('Elemento de diccionario no encontrado', 'NOT_FOUND')
      if (row.system) fail('Los valores del sistema no se eliminan; puedes desactivarlos.')
      const children = Number(
        db.get<{ count: number }>('SELECT COUNT(*) AS count FROM dictionary_nodes WHERE parent_id = ?', id)?.count ?? 0
      )
      if (children > 0) fail('Primero elimina o mueve los elementos hijos.')
      const usage = dictionaryUsageCount(db, row)
      if (usage > 0) fail(`Este valor está en uso (${usage}). Desactívalo en lugar de eliminarlo.`)
      db.tx(() => {
        db.run('DELETE FROM dictionary_nodes WHERE id = ?', id)
        const typeLabel = DICTIONARY_TYPES.find((item) => item.value === row.type)?.label ?? row.type
        audit(db, session, 'Eliminación de diccionario', 'Diccionario', `${typeLabel} · ${row.name}`, id)
      })
      return { deleted: true }
    }

    case 'settings.get': {
      requireModuleAccess(session, 'settings')
      return settingsData(db)
    }

    case 'legal.get': {
      return legalPublic(db)
    }

    case 'legal.update': {
      requireCap(session, 'configureLegal')
      const current = getLegal(db)
      const shortClauses = Array.isArray(payload?.shortClauses)
        ? payload.shortClauses.map((item: unknown) => text(item, 'Cláusula corta', 5, 3000)).slice(0, 20)
        : current.shortClauses
      const fullClauses = Array.isArray(payload?.fullClauses)
        ? payload.fullClauses.map((item: unknown) => text(item, 'Cláusula completa', 10, 6000)).slice(0, 30)
        : current.fullClauses
      if (!shortClauses.length || !fullClauses.length) fail('Debe existir al menos una cláusula corta y una completa.')
      const abandonmentDays = Math.round(numberValue(payload?.abandonmentDays ?? current.abandonmentDays, 'Días de abandono', { min: 1, max: 365 }))
      const warrantyDays = Math.round(numberValue(payload?.warrantyDays ?? current.warrantyDays, 'Días de garantía', { min: 1, max: 3650 }))
      const match = String(current.version).match(/^v(\d+)\.(\d+)$/)
      const version = match ? `v${match[1]}.${Number(match[2]) + 1}` : 'v1.1'
      const rawNit = payload?.nit !== undefined ? text(payload.nit, 'NIT', 3, 40) : String(current.nit ?? '')
      const nit = normalizeNit(rawNit)
      if (payload?.nit !== undefined && rawNit !== nit) {
        fail('El NIT debe contener solo números, sin puntos ni espacios.')
      }
      const nitDv = String(payload?.nitDv ?? current.nitDv ?? calculateNitDv(nit)).trim()
      if (!isValidNit(nit, nitDv)) fail('El dígito de verificación del NIT no es válido.')
      const next: LegalConfig = {
        ...current,
        businessName: text(payload?.businessName ?? current.businessName, 'Nombre del negocio', 2, 160),
        nit,
        nitDv,
        foreignNit:
          typeof payload?.foreignNit === 'string'
            ? payload.foreignNit.trim().slice(0, 40)
            : current.foreignNit ?? '',
        phone: text(payload?.phone ?? current.phone, 'Teléfono', 3, 80),
        address: text(payload?.address ?? current.address, 'Dirección', 3, 200),
        city: text(payload?.city ?? current.city, 'Ciudad', 2, 120),
        email: text(payload?.email ?? current.email, 'Correo', 3, 160),
        abandonmentDays,
        warrantyDays,
        shortClauses,
        fullClauses,
        version,
        updatedAt: new Date().toISOString()
      }
      db.tx(() => {
        db.setSetting('legal_config', next)
        db.run(
          'INSERT INTO legal_versions (id, version, config_json, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
          `legal_${sha256(`${version}|${Date.now()}`).slice(0, 20)}`,
          version,
          JSON.stringify(next),
          session.userId,
          next.updatedAt
        )
        audit(
          db,
          session,
          'Actualización legal',
          'Configuración',
          `Versión ${version} · abandono ${abandonmentDays} días · garantía ${warrantyDays} días`,
          version
        )
      })
      return next
    }

    case 'settings.updateSection': {
      requireModuleAccess(session, 'settings')
      const section = schema(payload?.section, z.enum(['print', 'ai', 'security', 'business', 'equipment', 'messages']))
      if (section === 'ai') requireCap(session, 'configureAI')
      if (section === 'equipment') requireCap(session, 'manageStaff')
      if (section === 'ai' && payload?.value && typeof payload.value === 'object' && 'apiKey' in payload.value) {
        // La clave nunca se devuelve al renderer ni se guarda en texto plano en la base.
        const value = { ...payload.value }
        const key = String(value.apiKey ?? '')
        delete value.apiKey
        if (key) {
          const current = db.getSetting<any>('ai_config', DEFAULT_SETTINGS.ai)
          db.setSetting('ai_config', { ...current, ...value, configured: true, keyFingerprint: sha256(key).slice(0, 12) })
        } else {
          const current = db.getSetting<any>('ai_config', DEFAULT_SETTINGS.ai)
          db.setSetting('ai_config', { ...current, ...value })
        }
      } else {
        const current = db.getSetting<any>(`${section}_config`, (DEFAULT_SETTINGS as any)[section])
        db.setSetting(`${section}_config`, { ...current, ...(payload?.value ?? {}) })
      }
      audit(db, session, 'Actualización de configuración', 'Configuración', `Sección ${section} actualizada.`)
      return settingsData(db)
    }

    case 'profile.get': {
      const row = db.get<any>('SELECT * FROM users WHERE id = ? AND active = 1', session.userId)
      if (!row) fail('La cuenta ya no está disponible.', 'NOT_FOUND')
      return userDto(db, row)
    }

    case 'profile.update': {
      const row = db.get<any>('SELECT * FROM users WHERE id = ? AND active = 1', session.userId)
      if (!row) fail('La cuenta ya no está disponible.', 'NOT_FOUND')
      const updates: string[] = []
      const params: any[] = []
      const changed: string[] = []
      if (payload?.name !== undefined) {
        updates.push('name = ?')
        params.push(text(payload.name, 'Nombre', 3, 160))
        changed.push('nombre')
      }
      if (payload?.email !== undefined) {
        updates.push('email = ?')
        params.push(String(payload.email).trim().slice(0, 200))
        changed.push('correo')
      }
      if (payload?.phone !== undefined) {
        updates.push('phone = ?')
        params.push(typeof payload.phone === 'string' && payload.phone.trim() ? payload.phone.trim().slice(0, 80) : null)
        changed.push('teléfono')
      }
      if (payload?.address !== undefined) {
        updates.push('address = ?')
        params.push(typeof payload.address === 'string' && payload.address.trim() ? payload.address.trim().slice(0, 200) : null)
        changed.push('dirección')
      }
      if (payload?.documentType !== undefined) {
        updates.push('document_type = ?')
        params.push(typeof payload.documentType === 'string' ? payload.documentType.slice(0, 20) : null)
        changed.push('tipo de documento')
      }
      if (payload?.document !== undefined) {
        updates.push('document = ?')
        params.push(typeof payload.document === 'string' && payload.document.trim() ? payload.document.trim().slice(0, 40) : null)
        changed.push('documento')
      }
      if (payload?.photoDataUrl !== undefined) {
        updates.push('photo_path = ?')
        params.push(normalizeUserPhoto(payload.photoDataUrl))
        changed.push(payload.photoDataUrl ? 'foto' : 'foto eliminada')
      }
      if (!updates.length) fail('No hay cambios para guardar')
      db.tx(() => {
        db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, ...params, session.userId)
        audit(db, session, 'Actualización de perfil', 'Usuario', `${row.name} · ${changed.join(', ')}`, session.userId)
      })
      return userDto(db, db.get<any>('SELECT * FROM users WHERE id = ?', session.userId))
    }

    case 'users.list': {
      requireModuleAccess(session, 'settings')
      requireCap(session, 'manageStaff')
      return listUsers(db, session.actualRole)
    }

    case 'users.create': {
      requireModuleAccess(session, 'settings')
      requireCap(session, 'manageStaff')
      const role = schema(payload?.role ?? 'tecnico', z.enum(['admin', 'tecnico', 'cajero']))
      if (role === 'admin') requireCap(session, 'manageAdmins')
      const name = text(payload?.name, 'Nombre', 3, 160)
      const username = text(payload?.username, 'Usuario', 3, 60).toLowerCase()
      if (!/^[a-z0-9._-]+$/.test(username)) fail('El usuario solo puede tener letras, números, punto, guion y guion bajo.')
      if (db.get<any>('SELECT id FROM users WHERE username = ? COLLATE NOCASE', username)) fail('Ese usuario ya existe.', 'DUPLICATE')
      const password = text(payload?.password, 'Contraseña', 8, 200)
      const email = text(payload?.email ?? '—', 'Correo', 1, 200)
      const documentType = typeof payload?.documentType === 'string' ? payload.documentType.slice(0, 20) : null
      const document = typeof payload?.document === 'string' ? payload.document.trim().slice(0, 40) : null
      const phone = typeof payload?.phone === 'string' ? payload.phone.trim().slice(0, 80) : null
      const address = typeof payload?.address === 'string' ? payload.address.trim().slice(0, 200) : null
      const photoPath = normalizeUserPhoto(payload?.photoDataUrl)
      const id = `user_${sha256(`${username}|${Date.now()}`).slice(0, 20)}`
      db.tx(() => {
        db.run(
          `INSERT INTO users
            (id, username, name, email, document_type, document, phone, address, photo_path,
             role, password_hash, active, is_protected, created_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
          id,
          username,
          name,
          email,
          documentType,
          document,
          phone,
          address,
          photoPath,
          role,
          hashPassword(password),
          new Date().toISOString(),
          session.userId
        )
        applyPermissionOverrides(db, session, id, role, payload?.permissions)
        audit(db, session, 'Creación de usuario', 'Usuario', `${name} · usuario ${username} · rol ${roleLabels[role]}`, id)
      })
      return userDto(db, db.get<any>('SELECT * FROM users WHERE id = ?', id))
    }

    case 'users.updatePhoto': {
      requireModuleAccess(session, 'settings')
      requireCap(session, 'manageStaff')
      const id = text(payload?.id, 'Usuario', 1, 80)
      const row = db.get<any>('SELECT * FROM users WHERE id = ?', id)
      if (!row) fail('Usuario no encontrado', 'NOT_FOUND')
      if (row.role === 'superadmin') fail('La cuenta raíz solo se modifica desde Mi perfil.', 'FORBIDDEN')
      const photoPath = normalizeUserPhoto(payload?.photoDataUrl)
      db.tx(() => {
        db.run('UPDATE users SET photo_path = ? WHERE id = ?', photoPath, id)
        audit(
          db,
          session,
          'Actualización de foto de perfil',
          'Usuario',
          `${row.name} · ${photoPath ? 'foto actualizada' : 'foto eliminada'}`,
          id
        )
      })
      return userDto(db, db.get<any>('SELECT * FROM users WHERE id = ?', id))
    }

    case 'users.update': {
      requireModuleAccess(session, 'settings')
      requireCap(session, 'manageStaff')
      const id = text(payload?.id, 'Usuario', 1, 80)
      const row = db.get<any>('SELECT * FROM users WHERE id = ?', id)
      if (!row) fail('Usuario no encontrado', 'NOT_FOUND')
      if (row.role === 'superadmin') fail('La cuenta raíz no se modifica desde este panel.', 'FORBIDDEN')
      if (row.role === 'admin') requireCap(session, 'manageAdmins')
      if (payload?.role === 'admin') requireCap(session, 'manageAdmins')
      const updates: string[] = []
      const params: any[] = []
      if (typeof payload?.name === 'string') {
        updates.push('name = ?')
        params.push(text(payload.name, 'Nombre', 3, 160))
      }
      if (typeof payload?.email === 'string') {
        updates.push('email = ?')
        params.push(payload.email.slice(0, 200))
      }
      if (payload?.documentType !== undefined) {
        updates.push('document_type = ?')
        params.push(typeof payload.documentType === 'string' ? payload.documentType.slice(0, 20) : null)
      }
      if (payload?.document !== undefined) {
        updates.push('document = ?')
        params.push(typeof payload.document === 'string' ? payload.document.trim().slice(0, 40) : null)
      }
      if (payload?.phone !== undefined) {
        updates.push('phone = ?')
        params.push(typeof payload.phone === 'string' ? payload.phone.trim().slice(0, 80) : null)
      }
      if (payload?.address !== undefined) {
        updates.push('address = ?')
        params.push(typeof payload.address === 'string' ? payload.address.trim().slice(0, 200) : null)
      }
      if (payload?.photoDataUrl !== undefined) {
        updates.push('photo_path = ?')
        params.push(normalizeUserPhoto(payload.photoDataUrl))
      }
      if (payload?.role) {
        const role = schema(payload.role, z.enum(['admin', 'tecnico', 'cajero']))
        if (role === 'admin') requireCap(session, 'manageAdmins')
        updates.push('role = ?')
        params.push(role)
      }
      if (payload?.active !== undefined) {
        if (!row.active && row.role === 'superadmin') fail('No se puede desactivar la cuenta raíz.')
        updates.push('active = ?')
        params.push(payload.active ? 1 : 0)
      }
      if (typeof payload?.password === 'string' && payload.password) {
        const password = text(payload.password, 'Contraseña', 8, 200)
        updates.push('password_hash = ?')
        params.push(hashPassword(password))
      }
      const nextRole = payload?.role ? String(payload.role) : row.role
      if (payload?.permissions !== undefined) {
        if (nextRole === 'superadmin') fail('La cuenta raíz no admite permisos especiales.', 'FORBIDDEN')
      }
      if (!updates.length && payload?.permissions === undefined) fail('No hay cambios para guardar')
      db.tx(() => {
        if (updates.length) {
          db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, ...params, id)
        }
        if (payload?.permissions !== undefined) {
          applyPermissionOverrides(db, session, id, nextRole, payload.permissions)
        }
        audit(db, session, 'Actualización de usuario', 'Usuario', `${row.name} · datos actualizados`, id)
      })
      return userDto(db, db.get<any>('SELECT * FROM users WHERE id = ?', id))
    }

    case 'backups.list': {
      requireModuleAccess(session, 'settings')
      requireCap(session, 'createBackup')
      return backupList(db, session.actualRole)
    }

    case 'backups.create': {
      requireModuleAccess(session, 'settings')
      requireCap(session, 'createBackup')
      const backup = await createBackup(db, runtime, session)
      db.tx(() => {
        audit(db, session, 'Creación de respaldo', 'Respaldo', backup.name, backup.id)
      })
      return { backup, backups: backupList(db, session.actualRole) }
    }

    case 'backups.setPassword': {
      requireModuleAccess(session, 'settings')
      requireCap(session, 'createBackup')
      const password = text(payload?.password, 'Contraseña de respaldo', 8, 200)
      if (!safeStorage.isEncryptionAvailable()) {
        fail('El cifrado del sistema no está disponible; no se puede guardar la contraseña.', 'UNSUPPORTED')
      }
      const encrypted = safeStorage.encryptString(password).toString('base64')
      db.tx(() => {
        db.setSetting('backup_password', { encrypted, updatedAt: new Date().toISOString() })
        audit(db, session, 'Configuración de contraseña de respaldo', 'Respaldo', 'Contraseña de exportación/importación actualizada.')
      })
      return { configured: true }
    }

    case 'backups.revealPassword': {
      requireModuleAccess(session, 'settings')
      requireCap(session, 'createBackup')
      const password = getBackupPassword(db)
      if (!password) fail('Configura primero la contraseña de respaldo.')
      db.tx(() => {
        audit(db, session, 'Visualización de contraseña de respaldo', 'Respaldo', 'El administrador copió la contraseña de respaldo.')
      })
      return { password }
    }

    case 'backups.export': {
      requireModuleAccess(session, 'settings')
      requireCap(session, 'createBackup')
      const password = getBackupPassword(db)
      if (!password) fail('Configura la contraseña de respaldo antes de exportar.')
      const backup = await createBackup(db, runtime, session)
      const folder = backup.path
      const databaseBytes = fs.readFileSync(path.join(folder, BACKUP_DATABASE_FILENAME))
      const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'))
      const evidenceRoot = path.join(folder, EVIDENCE_FOLDER)
      const evidence = fs.existsSync(evidenceRoot)
        ? walkFiles(evidenceRoot).map((file) => ({
            path: file.relative.replace(/\\/g, '/'),
            data: fs.readFileSync(file.absolute).toString('base64')
          }))
        : []
      const container = {
        format: 'bitacoretech-backup',
        version: 1,
        createdAt: new Date().toISOString(),
        appVersion: runtime.version,
        manifest,
        database: databaseBytes.toString('base64'),
        evidence
      }
      const encrypted = encryptBackupPayload(Buffer.from(JSON.stringify(container), 'utf8'), password)
      const testPath =
        process.env.BITACORETECH_TEST_PATHS === '1' && typeof payload?.path === 'string' ? payload.path : ''
      const chosen = testPath
        ? { canceled: false, filePath: testPath }
        : await dialog.showSaveDialog({
            title: 'Exportar respaldo BitacoreTech',
            defaultPath: `BitacoreTech-${new Date().toISOString().slice(0, 10)}.bctbackup`,
            filters: [{ name: 'Respaldo BitacoreTech', extensions: ['bctbackup'] }]
          })
      if (chosen.canceled || !chosen.filePath) return { exported: false }
      fs.writeFileSync(chosen.filePath, encrypted)
      db.tx(() => {
        audit(
          db,
          session,
          'Exportación de respaldo',
          'Respaldo',
          `${path.basename(chosen.filePath)} · ${encrypted.length} bytes · ${backup.name}`,
          backup.id
        )
      })
      return { exported: true, path: chosen.filePath, size: encrypted.length, backupName: backup.name }
    }

    case 'backups.import': {
      requireModuleAccess(session, 'settings')
      requireCap(session, 'restoreBackup')
      const stored = getBackupPassword(db)
      const supplied = typeof payload?.password === 'string' && payload.password ? payload.password : stored
      if (!supplied) fail('Configura la contraseña de respaldo o ingrésala para importar.')
      const testPath =
        process.env.BITACORETECH_TEST_PATHS === '1' && typeof payload?.path === 'string' ? payload.path : ''
      const chosen = testPath
        ? { canceled: false, filePaths: [testPath] }
        : await dialog.showOpenDialog({
            title: 'Importar respaldo BitacoreTech',
            properties: ['openFile'],
            filters: [{ name: 'Respaldo BitacoreTech', extensions: ['bctbackup'] }]
          })
      if (chosen.canceled || !chosen.filePaths[0]) return { imported: false }
      const encrypted = fs.readFileSync(chosen.filePaths[0])
      const plain = decryptBackupPayload(encrypted, supplied)
      let container: any
      try {
        container = JSON.parse(plain.toString('utf8'))
      } catch {
        fail('El respaldo no contiene datos válidos.')
      }
      if (container?.format !== 'bitacoretech-backup' || !container?.database) {
        fail('El archivo no es un respaldo BitacoreTech compatible.')
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const folderName = `import-${stamp}`
      const folder = path.join(getBackupPath(runtime.userDataPath), folderName)
      fs.mkdirSync(path.join(folder, EVIDENCE_FOLDER), { recursive: true })
      const databaseBytes = Buffer.from(String(container.database), 'base64')
      fs.writeFileSync(path.join(folder, BACKUP_DATABASE_FILENAME), databaseBytes)
      for (const item of Array.isArray(container.evidence) ? container.evidence : []) {
        const relative = String(item?.path ?? '').replace(/\\/g, '/')
        if (!relative || relative.includes('..') || path.isAbsolute(relative)) continue
        const target = path.join(folder, EVIDENCE_FOLDER, relative)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, Buffer.from(String(item?.data ?? ''), 'base64'))
      }
      const manifest = container.manifest ?? { app: 'BitacoreTech', createdAt: container.createdAt }
      fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
      const size = walkFiles(folder).reduce((sum, file) => sum + file.size, 0)
      const id = `bk_${sha256(`${folderName}|${Date.now()}`).slice(0, 20)}`
      db.run(
        `INSERT INTO backups (id, filename, path, size_bytes, sha256, format, created_by, created_by_name, created_at)
         VALUES (?, ?, ?, ?, ?, 'folder', ?, ?, ?)`,
        id,
        folderName,
        folder,
        size,
        sha256Bytes(databaseBytes),
        session.userId,
        displayUser(session).name,
        new Date().toISOString()
      )
      const imported = db.get<any>('SELECT * FROM backups WHERE id = ?', id)
      audit(db, session, 'Importación de respaldo', 'Respaldo', `${path.basename(chosen.filePaths[0])} · ${folderName}`, id)
      const result = await restoreBackupRecord(db, runtime, session, imported)
      return { ...result, imported: true, fileName: path.basename(chosen.filePaths[0]) }
    }

    case 'backups.restore': {
      requireModuleAccess(session, 'settings')
      requireCap(session, 'restoreBackup')
      const id = text(payload?.id, 'Respaldo', 1, 80)
      const backup = db.get<any>('SELECT * FROM backups WHERE id = ?', id)
      if (!backup) fail('Respaldo no encontrado', 'NOT_FOUND')
      return restoreBackupRecord(db, runtime, session, backup)
    }

    case 'backups.purge': {
      requireModuleAccess(session, 'settings')
      requireCap(session, 'purgeData')
      const confirmation = text(payload?.confirmation, 'Confirmación', 6, 20).toUpperCase()
      if (confirmation !== 'PURGAR') fail('Escribe PURGAR para confirmar la purga.')
      const password = typeof payload?.password === 'string' ? payload.password : ''
      const user = db.get<any>('SELECT * FROM users WHERE id = ?', session.userId)
      if (!user || !verifyPassword(password, user.password_hash)) fail('Contraseña del propietario incorrecta.', 'INVALID_CREDENTIALS')
      // createBackup registra la copia previa en la tabla de respaldos.
      const backup = await createBackup(db, runtime, session)
      db.tx(() => {
        // Se preservan usuarios, configuración, auditoría y respaldos.
        db.exec('DROP TRIGGER IF EXISTS payments_no_update; DROP TRIGGER IF EXISTS payments_no_delete;')
        db.exec('DROP TRIGGER IF EXISTS cash_movements_no_update; DROP TRIGGER IF EXISTS cash_movements_no_delete;')
        db.exec('DROP TRIGGER IF EXISTS stock_movements_no_update; DROP TRIGGER IF EXISTS stock_movements_no_delete;')
        db.exec(`
          DELETE FROM payments;
          DELETE FROM invoice_items;
          DELETE FROM invoices;
          DELETE FROM cash_movements;
          DELETE FROM cash_sessions;
          DELETE FROM work_order_evidence;
          DELETE FROM work_order_events;
          DELETE FROM work_order_items;
          DELETE FROM work_orders;
          DELETE FROM purchase_items;
          DELETE FROM purchases;
          DELETE FROM stock_movements;
          DELETE FROM product_serials;
          DELETE FROM products;
          DELETE FROM customers WHERE is_final_consumer = 0;
          DELETE FROM suppliers;
          DELETE FROM sequences;
        `)
        db.exec(`
          CREATE TRIGGER payments_no_update BEFORE UPDATE ON payments BEGIN SELECT RAISE(ABORT, 'payments es append-only'); END;
          CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments BEGIN SELECT RAISE(ABORT, 'payments es append-only'); END;
          CREATE TRIGGER cash_movements_no_update BEFORE UPDATE ON cash_movements BEGIN SELECT RAISE(ABORT, 'cash_movements es append-only'); END;
          CREATE TRIGGER cash_movements_no_delete BEFORE DELETE ON cash_movements BEGIN SELECT RAISE(ABORT, 'cash_movements es append-only'); END;
          CREATE TRIGGER stock_movements_no_update BEFORE UPDATE ON stock_movements BEGIN SELECT RAISE(ABORT, 'stock_movements es append-only'); END;
          CREATE TRIGGER stock_movements_no_delete BEFORE DELETE ON stock_movements BEGIN SELECT RAISE(ABORT, 'stock_movements es append-only'); END;
        `)
        db.appendAudit({
          userId: session.userId,
          userName: displayUser(session).name,
          role: roleLabel(session.role as any),
          action: 'Purga de datos',
          entity: 'Sistema',
          entityId: backup.id,
          detail: `Datos operativos purgados. Respaldo previo: ${backup.name}.`
        })
      })
      const evidenceRoot = getEvidencePath(runtime.userDataPath)
      if (fs.existsSync(evidenceRoot)) fs.rmSync(evidenceRoot, { recursive: true, force: true })
      fs.mkdirSync(evidenceRoot, { recursive: true })
      db.appendAudit({
        userId: session.userId,
        userName: displayUser(session).name,
        role: roleLabel(session.role as any),
        action: 'Purga de evidencias',
        entity: 'Sistema',
        entityId: backup.id,
        detail: `Fotografías de las OT purgadas eliminadas del disco. El respaldo completo ${backup.name} conserva las evidencias.`
      })
      return { purged: true, backup, requiresReload: true }
    }

    default:
      fail(`Comando desconocido: ${command}`, 'UNKNOWN_COMMAND')
  }
}
