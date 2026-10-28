import fs from 'node:fs'
import path from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { dialog, safeStorage, shell } from 'electron'
import { z } from 'zod'
import type { ModuleKey, PromotionInput } from '@shared/index'
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
  ALL_MODULES,
  ROOT_ONLY_CAPABILITIES,
  ROOT_ONLY_MODULES,
  RpcError,
  can,
  capabilitiesForRole,
  requireCapability,
  roleLabel,
  roleModulesForRole,
  type BackendCapability
} from './permissions'
import { hashPassword, newToken, sha256, sha256Bytes, verifyPassword } from './security'
import { calculateNitDv, isValidNit, normalizeNit } from './nit'
import {
  catalogStatus,
  clearRemoteSecret,
  publishCatalog,
  publishCatalogRemote,
  saveRemoteSecret,
  scheduleCatalogPublish,
  testSupabaseConnection,
  updateCatalogConfig
} from './catalogPublisher'
import {
  activePromotionRows,
  deletePromotion,
  listPromotions,
  previewPromotion,
  promotionAlertData,
  resolvePromotionForProductRow,
  savePromotion,
  setPromotionWeb,
  togglePromotion
} from './promotions'
import { runDemoSeed, type SeedOwner } from './seed'
import { generateDiagnosticReport, type ReportMode } from './diagnosticReport'
import { listGeminiModels, scanInvoice, testGeminiConnection, type InvoiceExtraction } from './aiInvoice'
import { resolveInternalSku } from './sku'
import { cleanProductText } from './productText'
import {
  PRODUCT_IMAGE_FOLDER,
  prepareProductImage,
  productImageRoot,
  removeProductImageFiles
} from './productImages'
import {
  PAYMENT_RECEIPT_FOLDER,
  preparePaymentReceipt,
  paymentReceiptRoot,
  paymentReceiptUrl,
  removePaymentReceiptFiles,
  resolvePaymentReceiptFile
} from './paymentReceipts'
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

const WEB_PRODUCT_CONDITIONS = new Set(['Nuevo', 'Reacondicionado'])

function isWebProductCondition(value: string) {
  return WEB_PRODUCT_CONDITIONS.has(value.trim())
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

function validateTechnicalSheet(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const drives = (value as any).storageDrives
  if (!Array.isArray(drives)) return
  for (const drive of drives) {
    if (!drive || typeof drive !== 'object' || drive.healthNotApplicable) continue
    if (drive.healthPercent === undefined || drive.healthPercent === null || drive.healthPercent === '') continue
    const percent = Number(drive.healthPercent)
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      fail('La salud del disco debe ser un porcentaje entre 0 y 100, o N/A.')
    }
  }
}

function createSnapshot(db: Database, acceptedAt: string, technicalSheet?: unknown) {
  const config = getLegal(db)
  return {
    version: config.version,
    acceptedAt,
    abandonmentDays: config.abandonmentDays,
    warrantyDays: config.warrantyDays,
    shortClauses: config.shortClauses.map((clause) => resolveClause(clause, config)),
    fullClauses: config.fullClauses.map((clause) => resolveClause(clause, config)),
    ...(technicalSheet && typeof technicalSheet === 'object' ? { technicalSheet } : {})
  }
}

function normalizeCustomerPhones(payload: any, fallbackPhone?: string) {
  const raw = Array.isArray(payload?.phones) ? payload.phones : []
  const rows: Array<{ phone: string; label: string; isPrimary: boolean }> = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item.phone !== 'string') continue
    const phone = item.phone.trim().slice(0, 80)
    if (!phone || phone === '—') continue
    const key = phone.replace(/\s+/g, '').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      phone,
      label:
        typeof item.label === 'string' && item.label.trim() ? item.label.trim().slice(0, 40) : 'Teléfono',
      isPrimary: Boolean(item.isPrimary)
    })
  }
  if (
    !rows.length &&
    typeof fallbackPhone === 'string' &&
    fallbackPhone.trim() &&
    fallbackPhone.trim() !== '—'
  ) {
    rows.push({ phone: fallbackPhone.trim().slice(0, 80), label: 'Principal', isPrimary: true })
  }
  if (rows.length && !rows.some((item) => item.isPrimary)) rows[0].isPrimary = true
  let primarySeen = false
  for (const row of rows) {
    if (row.isPrimary && primarySeen) row.isPrimary = false
    else if (row.isPrimary) primarySeen = true
  }
  return rows
}

function saveCustomerPhones(
  db: Database,
  customerId: string,
  phones: Array<{ phone: string; label: string; isPrimary: boolean }>,
  createdAt: string
) {
  db.run('DELETE FROM customer_phones WHERE customer_id = ?', customerId)
  const primary = phones.find((item) => item.isPrimary) ?? phones[0]
  for (const entry of phones) {
    db.run(
      `INSERT INTO customer_phones (id, customer_id, phone, label, is_primary, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      `cph_${sha256(`${customerId}|${entry.phone}`).slice(0, 20)}`,
      customerId,
      entry.phone,
      entry.label,
      entry.isPrimary ? 1 : 0,
      createdAt
    )
  }
  db.run('UPDATE customers SET phone = ? WHERE id = ?', primary?.phone ?? '—', customerId)
}

function customerPlaceholderDocument(id: string) {
  return `SD-${id.replace(/^cust_/, '')}`
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
  const modules = effectiveModules(
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
    permissions,
    modules
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
  const db = currentSession()
  const modules = effectiveModules(
    db,
    session.userId,
    session.role,
    session.role !== session.actualRole
  )
  if (!modules.includes(module as ModuleKey)) {
    fail(`Tu rol (${roleLabel(session.role as any)}) no tiene acceso a este módulo.`, 'FORBIDDEN')
  }
}

function effectiveModules(db: Database, userId: string, role: string, preview = false) {
  const rows = db.all<{ module: string; allowed: number }>(
    'SELECT module, allowed FROM role_modules WHERE role = ?',
    role
  )
  const granted = new Set<ModuleKey>(
    rows.length
      ? rows
          .filter((row) => row.allowed)
          .map((row) => row.module as ModuleKey)
          .filter((module) => ALL_MODULES.includes(module))
      : roleModulesForRole(role as any)
  )
  if (preview) return ALL_MODULES.filter((module) => granted.has(module))
  return ALL_MODULES.filter((module) => granted.has(module))
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

function recordAccountMovement(
  db: Database,
  session: Session,
  input: {
    accountId: string
    accountName: string
    type: 'ingreso' | 'egreso'
    amountCents: number
    description: string
    referenceType?: string
    referenceId?: string
    createdAt?: string
  }
) {
  db.run(
    `INSERT INTO account_movements
      (id, account_id, type, amount_cents, description, reference_type, reference_id,
       user_id, user_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    `acm_${sha256(`${input.accountId}|${Date.now()}|${Math.random()}`).slice(0, 20)}`,
    input.accountId,
    input.type,
    input.amountCents,
    input.description,
    input.referenceType ?? null,
    input.referenceId ?? null,
    session.userId,
    displayUser(session).name,
    input.createdAt ?? new Date().toISOString()
  )
}

function requiresDigitalReceipt(db: Database, method: string) {
  const config = db.getSetting<any>('payments_config', DEFAULT_SETTINGS.payments)
  return Boolean(config?.requireReceiptForDigital) &&
    (method === 'Transferencia' || method === 'Tarjeta')
}

function assertDigitalReceipt(db: Database, method: string, receipt: any) {
  if (requiresDigitalReceipt(db, method) && !receipt?.dataUrl) {
    fail('Adjunta el comprobante del pago digital para continuar.', 'RECEIPT_REQUIRED')
  }
}

function prepareReceiptFromPayload(
  runtime: Runtime,
  paymentId: string,
  receipt: any
) {
  if (!receipt || typeof receipt !== 'object' || !receipt.dataUrl) return null
  return preparePaymentReceipt({
    userDataPath: runtime.userDataPath,
    paymentId,
    dataUrl: receipt.dataUrl,
    filename: receipt.name
  })
}

function insertPaymentReceipt(
  db: Database,
  session: Session,
  paymentId: string,
  prepared: ReturnType<typeof preparePaymentReceipt> | null
) {
  if (!prepared) return
  db.run(
    `INSERT INTO payment_receipts
      (id, payment_id, filename, mime_type, size_bytes, path, sha256,
       uploaded_by, uploaded_by_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    `prc_${sha256(`${paymentId}|${prepared.sha256}`).slice(0, 20)}`,
    paymentId,
    prepared.filename,
    prepared.mimeType,
    prepared.sizeBytes,
    prepared.relativePath,
    prepared.sha256,
    session.userId,
    displayUser(session).name,
    new Date().toISOString()
  )
}

function paymentAccountById(db: Database, id: string, type = 'purchase_payment_account') {
  return db.get<any>('SELECT * FROM dictionary_nodes WHERE id = ? AND type = ? AND active = 1', id, type)
}

function resolvePurchaseAccount(
  db: Database,
  payloadAccountId: unknown,
  fallbackMethod: unknown
) {
  const requestedId =
    typeof payloadAccountId === 'string' && payloadAccountId.trim() ? payloadAccountId.trim() : ''
  if (requestedId) {
    const account = paymentAccountById(db, requestedId)
    if (!account) fail('La cuenta de pago seleccionada no está activa.')
    return {
      id: account.id,
      name: account.name,
      channel: String(account.channel ?? 'Transferencia'),
      linkedIncomeAccountId: account.linked_income_account_id ?? null
    }
  }
  const method =
    typeof fallbackMethod === 'string' && fallbackMethod.trim()
      ? fallbackMethod.trim()
      : 'Transferencia'
  const account = db.get<any>(
    `SELECT * FROM dictionary_nodes
     WHERE type = 'purchase_payment_account' AND active = 1 AND channel = ?
     ORDER BY sort_order ASC, name ASC LIMIT 1`,
    method
  )
  return {
    id: account?.id ?? null,
    name: account?.name ?? method,
    channel: account?.channel ?? method,
    linkedIncomeAccountId: account?.linked_income_account_id ?? null
  }
}

function cashTransferDto(db: Database, row: any, session: Session) {
  const account = db.get<any>('SELECT * FROM dictionary_nodes WHERE id = ?', row.account_id)
  return {
    id: row.id,
    cashSessionId: row.cash_session_id,
    accountId: row.account_id,
    accountName: account?.name ?? 'Cuenta de ingresos',
    requestedAmount: money(row.requested_cents),
    approvedAmount: row.approved_cents === null ? null : money(row.approved_cents),
    status: row.status,
    requestedBy: row.requested_by,
    requestedByName: row.requested_by_name,
    approvedBy: row.approved_by ?? null,
    approvedByName: row.approved_by_name ?? null,
    approvedAt: row.approved_at ?? null,
    rejectionReason: row.rejection_reason ?? null,
    notes: row.notes ?? null,
    createdAt: row.created_at,
    canApprove:
      row.status === 'pendiente' &&
      Boolean(account?.responsible_user_id) &&
      account.responsible_user_id === session.userId
  }
}

function pendingTransfersFor(db: Database, userId: string) {
  return db.all<any>(
    `SELECT t.*
     FROM cash_transfers t
     JOIN dictionary_nodes account ON account.id = t.account_id
     WHERE t.status = 'pendiente' AND account.responsible_user_id = ?
     ORDER BY t.created_at ASC`,
    userId
  )
}

function executeCashTransfer(
  db: Database,
  session: Session,
  transfer: any,
  amountCents: number,
  account: any
) {
  const current = requireCashSession(db)
  const expectedCents = toCents(cashSessionDto(db, current).expected)
  if (amountCents > expectedCents) {
    fail(`El traslado supera el efectivo disponible en caja (${money(expectedCents)}).`)
  }
  const nowIso = new Date().toISOString()
  recordCash(db, session, {
    type: 'egreso',
    method: 'Efectivo',
    amountCents,
    reason: `Traslado a banco · ${account.name}`,
    referenceType: 'cash_transfer',
    referenceId: transfer.id,
    createdAt: nowIso
  })
  recordAccountMovement(db, session, {
    accountId: account.id,
    accountName: account.name,
    type: 'ingreso',
    amountCents,
    description: `Traslado de efectivo a banco · ${account.name}`,
    referenceType: 'cash_transfer',
    referenceId: transfer.id,
    createdAt: nowIso
  })
  db.run(
    `UPDATE cash_transfers
     SET status = 'aprobado', approved_cents = ?, approved_by = ?, approved_by_name = ?,
         approved_at = ?, updated_at = ?
     WHERE id = ?`,
    amountCents,
    session.userId,
    displayUser(session).name,
    nowIso,
    nowIso,
    transfer.id
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
  lines: Array<{
    name: string
    quantity: number
    unitPriceCents: number
    unitCostCents: number
    isService?: boolean
    allowBelowCost?: boolean
  }>,
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
    if (net < cost && !line.allowBelowCost) {
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
       discount_value, discount_cents, total_cents, payment_method, status, notes, created_by,
       created_by_name, created_by_role, created_at)
     VALUES (?, ?, 'ot', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'activa', ?, ?, ?, ?, ?)`,
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
    name,
    session.actualRole,
    new Date().toISOString()
  )
  const items = db.all<any>('SELECT * FROM work_order_items WHERE work_order_id = ? ORDER BY rowid ASC', order.id)
  if (items.length) {
    const laborItems = items.filter((item) => item.type === 'servicio')
    const partItems = items.filter((item) => item.type !== 'servicio')

    if (laborItems.length) {
      const laborTotal = laborItems.reduce(
        (sum, item) => sum + Number(item.unit_price_cents) * Number(item.quantity),
        0
      )
      const laborCost = laborItems.reduce(
        (sum, item) => sum + Number(item.unit_cost_cents) * Number(item.quantity),
        0
      )
      db.run(
        `INSERT INTO invoice_items
          (id, invoice_id, product_id, description, quantity, unit_price_cents, unit_cost_cents, line_total_cents, item_type, note)
         VALUES (?, ?, NULL, 'Mano de obra', 1, ?, ?, ?, 'servicio', ?)`,
        `ii_${sha256(`${id}|labor`).slice(0, 20)}`,
        id,
        laborTotal,
        laborCost,
        laborTotal,
        laborItems.length > 1 ? `${laborItems.length} líneas de mano de obra` : null
      )
    }

    for (const item of partItems) {
      db.run(
        `INSERT INTO invoice_items
          (id, invoice_id, product_id, description, quantity, unit_price_cents, unit_cost_cents, line_total_cents, item_type, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `ii_${sha256(`${id}|${item.id}`).slice(0, 20)}`,
        id,
        item.product_id,
        item.description,
        item.quantity,
        item.unit_price_cents,
        item.unit_cost_cents,
        Math.round(item.unit_price_cents * item.quantity),
        item.type,
        item.type === 'repuesto' && Number(item.warranty_days ?? 0) > 0
          ? `Garantía: ${Number(item.warranty_days)} días`
          : null
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

function settingsData(db: Database, runtime: Runtime) {
  const aiConfig = { ...db.getSetting<any>('ai_config', DEFAULT_SETTINGS.ai) }
  const aiKey = db.getSetting<any>('ai_key', null)
  delete aiConfig.apiKey
  delete aiConfig.configured
  delete aiConfig.keyFingerprint
  const primaryModel =
    typeof aiConfig.model === 'string' ? aiConfig.model.replace(/^models\//, '').trim() : ''
  const fallbackModels = Array.isArray(aiConfig.fallbackModels)
    ? aiConfig.fallbackModels
        .filter((model: unknown): model is string => typeof model === 'string' && Boolean(model.trim()))
        .map((model: string) => model.replace(/^models\//, '').trim())
        .filter((model: string) => model !== primaryModel)
        .slice(0, 3)
    : []
  const modelCatalog = Array.isArray(aiConfig.modelCatalog)
    ? aiConfig.modelCatalog
        .filter((model: any) => model && typeof model.id === 'string')
        .map((model: any) => ({
          id: String(model.id).replace(/^models\//, '').slice(0, 120),
          displayName: String(model.displayName ?? model.id).slice(0, 120),
          ...(typeof model.description === 'string'
            ? { description: model.description.slice(0, 300) }
            : {}),
          ...(Number.isFinite(Number(model.inputTokenLimit)) && Number(model.inputTokenLimit) > 0
            ? { inputTokenLimit: Number(model.inputTokenLimit) }
            : {}),
          ...(Number.isFinite(Number(model.outputTokenLimit)) &&
          Number(model.outputTokenLimit) > 0
            ? { outputTokenLimit: Number(model.outputTokenLimit) }
            : {})
        }))
    : []
  return {
    legal: getLegal(db),
    print: db.getSetting('print_config', DEFAULT_SETTINGS.print),
    ai: {
      ...aiConfig,
      fallbackModels,
      autoFallback: Boolean(aiConfig.autoFallback),
      modelCatalog,
      catalogUpdatedAt: aiConfig.catalogUpdatedAt ?? null,
      configured: Boolean(aiKey?.encrypted),
      keyFingerprint: aiKey?.fingerprint ?? undefined
    },
    security: db.getSetting('security_config', DEFAULT_SETTINGS.security),
    business: db.getSetting('business_config', DEFAULT_SETTINGS.business),
    equipment: db.getSetting('equipment_config', DEFAULT_SETTINGS.equipment),
    payments: db.getSetting('payments_config', DEFAULT_SETTINGS.payments),
    messages: db.getSetting('messages_config', DEFAULT_SETTINGS.messages),
    tracking: db.getSetting('tracking_config', DEFAULT_SETTINGS.tracking),
    catalog: catalogStatus(db, runtime),
    backup: { passwordConfigured: backupPasswordConfigured(db) },
    rolePermissions: db
      .all<{ role: string; capability: string; allowed: number }>(
        'SELECT role, capability, allowed FROM role_permissions ORDER BY role ASC, capability ASC'
      )
      .map((row) => ({ role: row.role, capability: row.capability, allowed: Boolean(row.allowed) })),
    roleModules: db
      .all<{ role: string; module: string; allowed: number }>(
        'SELECT role, module, allowed FROM role_modules ORDER BY role ASC, module ASC'
      )
      .map((row) => ({ role: row.role, module: row.module, allowed: Boolean(row.allowed) })),
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
  if (row.type === 'purchase_payment_account') {
    return (
      Number(
        db.get<{ count: number }>('SELECT COUNT(*) AS count FROM purchases WHERE payment_account_id = ?', row.id)
          ?.count ?? 0
      ) +
      Number(
        db.get<{ count: number }>('SELECT COUNT(*) AS count FROM supplier_payments WHERE payment_account_id = ?', row.id)
          ?.count ?? 0
      )
    )
  }
  if (row.type === 'income_account') {
    return (
      Number(
        db.get<{ count: number }>('SELECT COUNT(*) AS count FROM payments WHERE income_account_id = ?', row.id)
          ?.count ?? 0
      ) +
      Number(
        db.get<{ count: number }>('SELECT COUNT(*) AS count FROM cash_transfers WHERE account_id = ?', row.id)
          ?.count ?? 0
      ) +
      Number(
        db.get<{ count: number }>('SELECT COUNT(*) AS count FROM account_movements WHERE account_id = ?', row.id)
          ?.count ?? 0
      )
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
    channel: row.channel ?? null,
    name: row.name,
    sortOrder: Number(row.sort_order),
    active: Boolean(row.active),
    system: Boolean(row.system),
    responsibleUserId: row.responsible_user_id ?? null,
    linkedIncomeAccountId: row.linked_income_account_id ?? null,
    usageCount: dictionaryUsageCount(db, row),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

const PAYMENT_ACCOUNT_CHANNELS = ['Efectivo', 'Transferencia', 'Tarjeta'] as const

function validatePaymentAccountFields(
  db: Database,
  type: string,
  input: {
    active: boolean
    responsibleUserId?: string | null
    linkedIncomeAccountId?: string | null
    channel?: string | null
    id?: string
  }
) {
  if (type === 'income_account') {
    if (input.active) {
      const other = db.get<any>(
        "SELECT id, name FROM dictionary_nodes WHERE type = 'income_account' AND active = 1 AND id <> ? LIMIT 1",
        input.id ?? ''
      )
      if (other) {
        fail(
          `Solo puede haber una cuenta de ingresos activa. Desactiva primero "${other.name}".`,
          'DUPLICATE'
        )
      }
      if (!input.responsibleUserId) {
        fail('Selecciona el administrador responsable de la cuenta de ingresos.')
      }
    }
    if (input.responsibleUserId) {
      const responsible = db.get<any>(
        "SELECT id, name, role, active FROM users WHERE id = ?",
        input.responsibleUserId
      )
      if (!responsible || !responsible.active) fail('El administrador responsable no está activo.')
      if (responsible.role !== 'admin') {
        fail('La cuenta de ingresos debe quedar vinculada a un administrador.')
      }
    }
    return
  }
  if (type !== 'purchase_payment_account') return
  if (input.channel && !(PAYMENT_ACCOUNT_CHANNELS as readonly string[]).includes(input.channel)) {
    fail('El canal debe ser Efectivo, Transferencia o Tarjeta.')
  }
  if (input.linkedIncomeAccountId) {
    if ((input.channel ?? 'Transferencia') === 'Efectivo') {
      fail('Una cuenta de efectivo no puede descontar de la cuenta de ingresos. Usa transferencia o tarjeta.')
    }
    const linked = db.get<any>(
      "SELECT id, name, active FROM dictionary_nodes WHERE id = ? AND type = 'income_account'",
      input.linkedIncomeAccountId
    )
    if (!linked) fail('La cuenta de ingresos vinculada no existe.')
    if (!linked.active) fail('La cuenta de ingresos vinculada está inactiva.')
  }
}

function incomeAccountRow(db: Database) {
  return db.get<any>(
    "SELECT * FROM dictionary_nodes WHERE type = 'income_account' AND active = 1 ORDER BY sort_order ASC, name ASC LIMIT 1"
  )
}

function requireIncomeAccount(db: Database) {
  const account = incomeAccountRow(db)
  if (!account) {
    fail(
      'Configura y activa la cuenta de ingresos con un administrador responsable antes de cobrar pagos digitales.'
    )
  }
  return account
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
    .map((line) => {
      const quantity = Number(line.quantity) || 1
      const ivaCents = Number(line.iva_cents ?? 0)
      const unitPriceCents = Number(line.unit_price_cents) || 0
      return {
        id: line.id,
        productId: line.product_id ?? null,
        description: line.description,
        quantity,
        unitPrice: money(unitPriceCents),
        ivaRate: Number(line.iva_rate ?? 19),
        iva: money(ivaCents),
        unitPriceWithTax: money(unitPriceCents + ivaCents / quantity),
        supplierSku: String(line.supplier_sku ?? ''),
        serialText: String(line.serial_text ?? ''),
        lineTotal: money(unitPriceCents * quantity)
      }
    })
  const payments = db
    .all<any>(
      'SELECT * FROM supplier_payments WHERE purchase_id = ? ORDER BY paid_at ASC, rowid ASC',
      row.id
    )
    .map((payment) => ({
      id: payment.id,
      amount: money(payment.amount_cents),
      method: payment.method,
      date: payment.paid_at,
      notes: payment.notes ?? null,
      paymentAccount: payment.payment_account ?? null,
      paymentAccountId: payment.payment_account_id ?? null,
      createdByName: payment.created_by_name ?? null
    }))
  let aiMetadata: any = null
  try {
    aiMetadata = row.ai_metadata_json ? JSON.parse(row.ai_metadata_json) : null
  } catch {
    aiMetadata = null
  }
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
    discount: money(row.discount_cents ?? 0),
    adjustment: money(row.adjustment_cents ?? 0),
    total: money(row.total_cents),
    status: row.status,
    paymentStatus: row.payment_status ?? (Number(row.balance_cents ?? 0) > 0 ? 'pendiente' : 'pagada'),
    paymentMethod: row.payment_method ?? 'Transferencia',
    paymentAccount: row.payment_account ?? null,
    paymentAccountId: row.payment_account_id ?? null,
    linkedIncomeAccountName: row.payment_account_id
      ? db.get<{ name: string }>(
          `SELECT linked.name
           FROM dictionary_nodes account
           LEFT JOIN dictionary_nodes linked ON linked.id = account.linked_income_account_id
           WHERE account.id = ?`,
          row.payment_account_id
        )?.name ?? null
      : null,
    paid: money(row.paid_cents ?? 0),
    balance: money(row.balance_cents ?? 0),
    dueDate: row.due_date ?? null,
    createdByName: row.created_by_name ?? null,
    createdByRole: row.created_by_role ?? null,
    payments,
    notes: row.notes ?? null,
    ai: aiMetadata,
    lines
  }
}

const PURCHASE_PAYMENT_METHODS = ['Efectivo', 'Transferencia', 'Tarjeta', 'Crédito'] as const

function purchasePaymentMethod(value: unknown, fallback = 'Transferencia') {
  const method = typeof value === 'string' ? value.trim() : ''
  return (PURCHASE_PAYMENT_METHODS as readonly string[]).includes(method) ? method : fallback
}

function purchasePaymentSummary({
  totalCents,
  paymentCondition,
  initialPayment,
  paymentMethod
}: {
  totalCents: number
  paymentCondition: unknown
  initialPayment: unknown
  paymentMethod: unknown
}) {
  const condition = paymentCondition === 'credito' ? 'credito' : 'contado'
  const method = purchasePaymentMethod(paymentMethod, condition === 'credito' ? 'Crédito' : 'Transferencia')
  if (condition === 'contado') {
    return {
      paymentStatus: 'pagada',
      paymentMethod: method === 'Crédito' ? 'Transferencia' : method,
      paidCents: totalCents,
      balanceCents: 0
    }
  }
  const paidCents = Math.min(
    totalCents,
    Math.max(0, toCents(numberValue(initialPayment ?? 0, 'Abono inicial', { min: 0 })))
  )
  const balanceCents = totalCents - paidCents
  return {
    paymentStatus:
      balanceCents <= 0 ? 'pagada' : paidCents > 0 ? 'parcial' : 'pendiente',
    paymentMethod: paidCents > 0 && method === 'Crédito' ? 'Transferencia' : method,
    paidCents,
    balanceCents
  }
}

function recordSupplierPayment(
  db: Database,
  session: Session,
  input: {
    purchaseId: string
    purchaseNumber: string
    amountCents: number
    method: string
    paymentAccount?: {
      id: string | null
      name: string
      channel: string
      linkedIncomeAccountId: string | null
    } | null
    paidAt: string
    notes?: string | null
    registerCash?: boolean
  }
) {
  if (input.amountCents <= 0) return
  const id = `sp_${sha256(`${input.purchaseId}|${input.amountCents}|${Date.now()}|${Math.random()}`).slice(0, 20)}`
  db.run(
    `INSERT INTO supplier_payments
      (id, purchase_id, amount_cents, method, payment_account, payment_account_id,
       paid_at, notes, created_by, created_by_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.purchaseId,
    input.amountCents,
    input.method,
    input.paymentAccount?.name ?? null,
    input.paymentAccount?.id ?? null,
    input.paidAt,
    input.notes ?? null,
    session.userId,
    displayUser(session).name,
    new Date().toISOString()
  )
  if (input.registerCash && input.method === 'Efectivo') {
    recordCash(db, session, {
      type: 'egreso',
      method: 'Efectivo',
      amountCents: input.amountCents,
      reason: `Pago compra ${input.purchaseNumber}`,
      referenceType: 'purchase',
      referenceId: input.purchaseId,
      createdAt: input.paidAt
    })
  } else if (input.paymentAccount?.linkedIncomeAccountId) {
    recordAccountMovement(db, session, {
      accountId: input.paymentAccount.linkedIncomeAccountId,
      accountName: input.paymentAccount.name,
      type: 'egreso',
      amountCents: input.amountCents,
      description: `Pago compra ${input.purchaseNumber} · ${input.paymentAccount.name}`,
      referenceType: 'purchase',
      referenceId: input.purchaseId,
      createdAt: input.paidAt
    })
  }
}

function normalizeAiText(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function normalizeAiNit(value: unknown) {
  const textValue = String(value ?? '').trim()
  const digits = textValue.replace(/\D/g, '')
  return digits || textValue.toLowerCase()
}

function normalizeAiModel(value: unknown, field = 'Modelo de IA') {
  const raw = text(value, field, 1, 120)
  const id = raw.replace(/^models\//, '').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    fail('El identificador del modelo no es válido. Usa el nombre sin el prefijo "models/".')
  }
  return id
}

function requireAiModelManager(session: Session) {
  requireModuleAccess(session, 'purchases')
  requireCap(session, 'useAI')
  if (session.role !== 'superadmin' && session.role !== 'admin') {
    fail('Solo el propietario y los administradores pueden cambiar el modelo de IA.', 'FORBIDDEN')
  }
}

function aiModelChain(config: any) {
  const primary =
    typeof config?.model === 'string'
      ? config.model.replace(/^models\//, '').trim()
      : ''
  const fallbacks = Array.isArray(config?.fallbackModels)
    ? config.fallbackModels
        .filter((model: unknown): model is string => typeof model === 'string')
        .map((model: string) => model.replace(/^models\//, '').trim())
        .filter(Boolean)
    : []
  return [...new Set([primary, ...fallbacks].filter(Boolean))]
}

const AI_RETRYABLE_CODES = new Set([
  'AI_QUOTA',
  'AI_MODEL_NOT_FOUND',
  'AI_UNAVAILABLE',
  'AI_TIMEOUT'
])

const aiModelCooldowns = new Map<string, number>()

function aiModelCooldownRemaining(model: string) {
  const until = aiModelCooldowns.get(model) ?? 0
  if (until <= Date.now()) {
    aiModelCooldowns.delete(model)
    return 0
  }
  return Math.ceil((until - Date.now()) / 1000)
}

function cooldownAiModel(model: string, seconds?: number) {
  const duration = Math.max(30, Math.min(seconds ?? 60, 3600))
  aiModelCooldowns.set(model, Date.now() + duration * 1000)
}

function clearAiModelCooldown(model: string) {
  aiModelCooldowns.delete(model)
}

function aiNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function aiDate(value: unknown) {
  const textValue = String(value ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(textValue)) return textValue.slice(0, 10)
  const parsed = new Date(textValue)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  return ''
}

function getStoredAiKey(db: Database) {
  const stored = db.getSetting<{ encrypted?: string } | null>('ai_key', null)
  if (!stored?.encrypted) return null
  if (!safeStorage.isEncryptionAvailable()) {
    fail('El almacén seguro de Windows no está disponible; no se puede usar la clave de IA.')
  }
  try {
    return safeStorage.decryptString(Buffer.from(stored.encrypted, 'base64'))
  } catch {
    fail('No se pudo descifrar la clave de IA. Puede pertenecer a otro equipo o usuario de Windows; vuelve a ingresarla.', 'AI_KEY_INVALID')
  }
}

function buildInvoiceDraft(
  db: Database,
  extraction: InvoiceExtraction,
  source: { name: string; mimeType: string; size: number },
  aiMeta: {
    model: string
    requestedModel: string
    attempts: Array<{
      model: string
      code: string
      message: string
      retryAfterSeconds?: number
    }>
  }
) {
  const suppliers = db.all<any>('SELECT id, name, nit, is_foreign_nit FROM suppliers WHERE active = 1')
  const supplierName = String(extraction.supplier?.name ?? '').trim().slice(0, 160)
  const supplierNit = String(extraction.supplier?.nit ?? '').trim().slice(0, 40)
  const nitKey = normalizeAiNit(supplierNit)
  let matchedSupplier: any = null
  let supplierMatch: 'exact' | 'name' | 'none' = 'none'
  if (nitKey) {
    matchedSupplier = suppliers.find((item) => normalizeAiNit(item.nit) === nitKey) ?? null
    if (matchedSupplier) supplierMatch = 'exact'
  }
  if (!matchedSupplier && supplierName) {
    const nameKey = normalizeAiText(supplierName)
    matchedSupplier =
      suppliers.find((item) => normalizeAiText(item.name) === nameKey) ??
      suppliers.find((item) => {
        const candidate = normalizeAiText(item.name)
        return candidate.includes(nameKey) || nameKey.includes(candidate)
      }) ??
      null
    if (matchedSupplier) supplierMatch = 'name'
  }

  const products = db.all<any>(
    'SELECT id, name, sku, supplier_sku, cost_cents, price_cents FROM products WHERE active = 1'
  )
  const warnings = (Array.isArray(extraction.warnings) ? extraction.warnings : [])
    .map((item) => String(item).slice(0, 300))
    .filter(Boolean)
  if (aiMeta.model !== aiMeta.requestedModel) {
    warnings.push(
      `Se usó el modelo de respaldo ${aiMeta.model} porque ${aiMeta.requestedModel} no estaba disponible.`
    )
  }
  const rawLines = Array.isArray(extraction.lines) ? extraction.lines : []
  const lines: Array<any> = []
  const usedSkus = new Set<string>(products.map((product) => String(product.sku).toLowerCase()))
  let subtotalCents = 0
  let ivaCents = 0

  rawLines.forEach((raw, index) => {
    const cleaned = cleanProductText(
      String(raw?.description ?? ''),
      Array.isArray(raw?.serials) ? raw.serials.map((serial: unknown) => String(serial)) : []
    )
    const description = cleaned.name.trim().slice(0, 240)
    const quantity = aiNumber(raw?.quantity, 0)
    const unitCost = aiNumber(raw?.unitCost, 0)
    let ivaRate = aiNumber(raw?.ivaRate, 19)
    const supplierSku = String(raw?.supplierSku ?? '').trim().slice(0, 60)
    const serialText = cleaned.serials.join(', ').slice(0, 1000)
    if (!description || quantity <= 0 || unitCost < 0) {
      warnings.push(`Línea ${index + 1} incompleta; revísala antes de aprobar.`)
      return
    }
    if (ivaRate < 0 || ivaRate > 100) {
      warnings.push(`Línea ${index + 1}: IVA inválido; se usará 19 %.`)
      ivaRate = 19
    }
    const unitCostCents = toCents(unitCost)
    const lineBaseCents = Math.round(unitCostCents * quantity)
    const lineIvaCents = Math.round((lineBaseCents * ivaRate) / 100)
    const computedLineTotalCents = lineBaseCents + lineIvaCents
    const extractedLineTotalCents = toCents(aiNumber(raw?.lineTotal, 0))
    subtotalCents += lineBaseCents
    ivaCents += lineIvaCents
    if (
      extractedLineTotalCents > 0 &&
      Math.abs(extractedLineTotalCents - computedLineTotalCents) > 1
    ) {
      warnings.push(
        `La línea ${index + 1} no coincide con el total de la fila; revisa cantidad, IVA y costo.`
      )
    }

    const descriptionKey = normalizeAiText(description)
    const supplierSkuKey = normalizeAiText(supplierSku)
    let product = null
    if (supplierSkuKey) {
      product =
        products.find(
          (item) =>
            normalizeAiText(item.supplier_sku) === supplierSkuKey &&
            Boolean(String(item.supplier_sku ?? '').trim())
        ) ?? null
    }
    if (!product) {
      product =
        products.find(
          (item) =>
            normalizeAiText(item.sku) === descriptionKey ||
            normalizeAiText(item.name) === descriptionKey
        ) ?? null
    }
    let matchConfidence = product ? 1 : 0
    if (!product && descriptionKey) {
      product =
        products.find((item) => {
          const productKey = normalizeAiText(item.name)
          return productKey.includes(descriptionKey) || descriptionKey.includes(productKey)
        }) ?? null
      if (product) matchConfidence = 0.7
    }
    const previousCost = product ? money(product.cost_cents) : 0
    const previousPrice = product ? money(product.price_cents) : 0
    let costChange = null
    if (product && previousCost > 0 && unitCost > previousCost * 1.1) {
      const marginPercent =
        previousPrice > 0 ? Math.max(0, ((previousPrice - previousCost) / previousPrice) * 100) : 0
      const suggestedPrice =
        previousCost > 0 ? money(toCents(unitCost * (previousPrice / previousCost))) : previousPrice
      costChange = {
        previousCost,
        previousPrice,
        newCost: money(toCents(unitCost)),
        marginPercent: money(toCents(marginPercent)),
        suggestedPrice
      }
      warnings.push(`El costo de ${product.name} subió más del 10 %.`)
    }

    let skuResolution = product
      ? {
          sku: product.sku,
          source: 'producto' as const,
          warning: null as string | null
        }
      : resolveInternalSku({
          aiSku: raw?.skuSugerido,
          name: description,
          supplierSku,
          existingSkus: [...usedSkus]
        })
    if (!product && skuResolution.sku) {
      usedSkus.add(skuResolution.sku.toLowerCase())
    }
    if (skuResolution.warning) warnings.push(`Línea ${index + 1}: ${skuResolution.warning}`)

    lines.push({
      id: `line_${index + 1}`,
      description,
      quantity,
      unitCost: money(toCents(unitCost)),
      ivaRate,
      unitCostWithTax: money(toCents(unitCost * (1 + ivaRate / 100))),
      confidence: Math.max(0, Math.min(1, aiNumber(raw?.confidence, matchConfidence || 0.7))),
      productId: product?.id ?? null,
      productName: product?.name ?? null,
      productSku: product?.sku ?? null,
      supplierSku,
      serialText,
      skuSugerido: skuResolution.sku,
      skuSource: skuResolution.source,
      skuWarning: skuResolution.warning,
      matchConfidence,
      warnings: [],
      costChange
    })
  })

  const discountCents = Math.max(
    0,
    Math.min(subtotalCents + ivaCents, toCents(aiNumber(extraction.discount, 0)))
  )
  const calculatedTotalCents = subtotalCents + ivaCents - discountCents
  const extractedTotalCents = toCents(aiNumber(extraction.total, 0))
  const realTotalCents = extractedTotalCents > 0 ? extractedTotalCents : calculatedTotalCents
  const differenceCents = realTotalCents - calculatedTotalCents
  const number = String(extraction.invoice?.number ?? '').trim().slice(0, 80)
  const date = aiDate(extraction.invoice?.date)
  const duplicate =
    matchedSupplier && number
      ? db.get<any>('SELECT id FROM purchases WHERE supplier_id = ? AND number = ?', matchedSupplier.id, number)
      : null

  if (!supplierName) warnings.push('No se pudo leer el nombre del proveedor.')
  if (!number) warnings.push('No se pudo leer el número de factura.')
  if (!date) warnings.push('No se pudo leer la fecha de factura.')
  if (!lines.length) warnings.push('No se detectaron líneas en la factura.')
  if (differenceCents !== 0 && lines.length) {
    warnings.push('El total real no coincide con el total calculado; revisa el ajuste antes de aprobar.')
  }
  if (duplicate) {
    warnings.push(`Ya existe una factura de ${matchedSupplier.name} con el número ${number}.`)
  }

  const averageConfidence = lines.length
    ? lines.reduce((sum, line) => sum + Number(line.confidence ?? 0), 0) / lines.length
    : 0
  const aiConfidence = Math.max(
    0,
    Math.min(1, aiNumber(extraction.confidence, averageConfidence || 0.7))
  )

  return {
    supplier: {
      name: supplierName,
      nit: supplierNit,
      supplierId: matchedSupplier?.id ?? null,
      matchedName: matchedSupplier?.name ?? null,
      match: supplierMatch,
      confidence: Math.max(0, Math.min(1, aiNumber(extraction.supplier?.confidence, supplierMatch === 'none' ? 0.5 : 0.9)))
    },
    invoice: {
      number,
      date,
      currency: String(extraction.invoice?.currency || 'COP').trim().toUpperCase().slice(0, 8),
      paymentMethod: String(extraction.paymentMethod ?? '').trim().slice(0, 40),
      paymentCondition: String(extraction.paymentCondition ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .includes('cred')
        ? 'credito'
        : 'contado',
      confidence: Math.max(0, Math.min(1, aiNumber(extraction.invoice?.confidence, 0.7)))
    },
    lines,
    subtotal: money(subtotalCents),
    discount: money(discountCents),
    iva: money(ivaCents),
    calculatedTotal: money(calculatedTotalCents),
    realTotal: money(realTotalCents),
    difference: money(differenceCents),
    duplicate: Boolean(duplicate),
    duplicatePurchaseId: duplicate?.id ?? null,
    warnings: [...new Set(warnings)],
    ai: {
      provider: 'gemini',
      model: aiMeta.model,
      requestedModel: aiMeta.requestedModel,
      fallbackUsed: aiMeta.model !== aiMeta.requestedModel,
      attempts: aiMeta.attempts,
      extractedAt: new Date().toISOString(),
      confidence: aiConfidence,
      extractionHash: sha256(JSON.stringify(extraction)),
      warnings: [...new Set(warnings)]
    },
    source
  }
}

function createProductFromPurchaseReview(
  db: Database,
  input: any,
  unitCostCents: number,
  nowIso: string
) {
  const name = text(input?.name, 'Nombre del producto', 2, 160)
  const sku = text(input?.sku, 'SKU', 2, 60)
  if (db.get<any>('SELECT id FROM products WHERE sku = ?', sku)) {
    fail(`Ya existe un producto con el SKU ${sku}.`, 'DUPLICATE')
  }
  const category = text(input?.category ?? 'Repuestos', 'Categoría', 2, 80)
  const location = text(input?.location ?? 'Bodega A', 'Ubicación', 2, 80)
  const priceCents = toCents(numberValue(input?.price, 'Precio de venta', { min: 0.01 }))
  const warrantyDays = Math.max(0, Math.round(aiNumber(input?.warrantyDays, 0)))
  const supplierSku =
    typeof input?.supplierSku === 'string' ? input.supplierSku.trim().slice(0, 60) : ''
  const id = `prod_${sha256(`${sku}|${Date.now()}|${Math.random()}`).slice(0, 20)}`
  db.run(
    `INSERT INTO products
      (id, name, sku, barcode, supplier_sku, category, location, condition, origin, stock, min_stock, cost_cents, price_cents,
       warranty_days, is_service, service_type, alert_enabled, rotation, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, 0, NULL, 1, 'rotativo', 1, ?, ?)`,
    id,
    name,
    sku,
    String(input?.barcode ?? `AI${Date.now().toString().slice(-9)}`).slice(0, 60),
    supplierSku,
    category,
    location,
    typeof input?.condition === 'string' ? input.condition.trim().slice(0, 80) : '',
    typeof input?.origin === 'string' ? input.origin.trim().slice(0, 80) : '',
    unitCostCents,
    priceCents,
    warrantyDays,
    nowIso,
    nowIso
  )
  return id
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
  const posInvoices = invoices.filter((invoice) => invoice.type === 'venta')
  const otInvoices = invoices.filter((invoice) => invoice.type === 'ot')
  const salesPosCents = posInvoices.reduce(
    (sum, invoice) => sum + Number(invoice.total_cents),
    0
  )
  const salesOtCents = otInvoices.reduce(
    (sum, invoice) => sum + Number(invoice.total_cents),
    0
  )
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

  const invoiceCost = new Map<string, number>()
  for (const item of items) {
    invoiceCost.set(
      item.invoice_id,
      (invoiceCost.get(item.invoice_id) ?? 0) +
        Number(item.unit_cost_cents) * Number(item.quantity)
    )
  }
  const salesByUserMap = new Map<
    string,
    {
      userId: string
      name: string
      role: string
      invoices: number
      sales: number
      cost: number
    }
  >()
  for (const invoice of invoices) {
    const key = invoice.created_by || 'sin_usuario'
    const current = salesByUserMap.get(key) ?? {
      userId: key,
      name: invoice.created_by_name || 'Usuario eliminado',
      role: invoice.created_by_role || '',
      invoices: 0,
      sales: 0,
      cost: 0
    }
    current.invoices += 1
    current.sales += Number(invoice.total_cents)
    current.cost += invoiceCost.get(invoice.id) ?? 0
    salesByUserMap.set(key, current)
  }
  const salesByUser = [...salesByUserMap.values()]
    .sort((a, b) => b.sales - a.sales)
    .map((row) => ({
      userId: row.userId,
      name: row.name,
      role: row.role ? roleLabel(row.role as any) : 'Sin rol',
      invoices: row.invoices,
      sales: money(row.sales),
      cost: canGross ? money(row.cost) : null,
      margin: canGross ? money(row.sales - row.cost) : null,
      marginPercent:
        canGross && row.sales > 0 ? Math.round(((row.sales - row.cost) / row.sales) * 1000) / 10 : null,
      averageTicket: row.invoices ? money(Math.round(row.sales / row.invoices)) : 0
    }))

  const technicianMap = new Map<
    string,
    {
      userId: string
      name: string
      role: string
      orders: number
      sales: number
      services: number
      parts: number
      cost: number
    }
  >()
  for (const invoice of invoices) {
    if (invoice.type !== 'ot' || !invoice.order_id) continue
    const order = db.get<any>(
      `SELECT w.technician_id, u.name AS technician_name, u.role AS technician_role
       FROM work_orders w LEFT JOIN users u ON u.id = w.technician_id
       WHERE w.id = ?`,
      invoice.order_id
    )
    if (!order) continue
    const key = order.technician_id || 'sin_asignar'
    const current = technicianMap.get(key) ?? {
      userId: key,
      name: order.technician_name || 'Sin asignar',
      role: order.technician_role || '',
      orders: 0,
      sales: 0,
      services: 0,
      parts: 0,
      cost: 0
    }
    current.orders += 1
    current.sales += Number(invoice.total_cents)
    current.cost += invoiceCost.get(invoice.id) ?? 0
    const orderItems = db.all<any>('SELECT * FROM invoice_items WHERE invoice_id = ?', invoice.id)
    for (const item of orderItems) {
      const line = Number(item.unit_price_cents) * Number(item.quantity)
      if (item.item_type === 'servicio') current.services += line
      else current.parts += line
    }
    technicianMap.set(key, current)
  }
  const technicianRevenue = [...technicianMap.values()]
    .sort((a, b) => b.sales - a.sales)
    .map((row) => ({
      userId: row.userId,
      name: row.name,
      role: row.role ? roleLabel(row.role as any) : 'Sin rol',
      orders: row.orders,
      sales: money(row.sales),
      services: money(row.services),
      parts: money(row.parts),
      cost: canGross ? money(row.cost) : null,
      margin: canGross ? money(row.sales - row.cost) : null
    }))

  const trackingConfig = db.getSetting<any>('tracking_config', DEFAULT_SETTINGS.tracking)
  const purchaseTrackingEnabled = trackingConfig?.purchasesByUser !== false
  const purchasesByUserMap = new Map<
    string,
    {
      userId: string
      name: string
      role: string
      purchases: number
      items: number
      total: number
      iva: number
      estimatedMargin: number
      lastPurchaseAt: string | null
    }
  >()
  if (purchaseTrackingEnabled) {
    for (const purchase of purchases) {
      const key = purchase.created_by || 'sin_usuario'
      const current = purchasesByUserMap.get(key) ?? {
        userId: key,
        name: purchase.created_by_name || 'Usuario eliminado',
        role: purchase.created_by_role || '',
        purchases: 0,
        items: 0,
        total: 0,
        iva: 0,
        estimatedMargin: 0,
        lastPurchaseAt: null
      }
      current.purchases += 1
      current.items += Number(purchase.item_count ?? 0)
      current.total += Number(purchase.total_cents)
      current.iva += Number(purchase.iva_cents)
      const purchaseItems = db.all<any>(
        `SELECT pi.quantity, pi.unit_price_cents, p.price_cents AS sale_price_cents
         FROM purchase_items pi LEFT JOIN products p ON p.id = pi.product_id
         WHERE pi.purchase_id = ?`,
        purchase.id
      )
      for (const item of purchaseItems) {
        if (item.sale_price_cents === null || item.sale_price_cents === undefined) continue
        current.estimatedMargin +=
          (Number(item.sale_price_cents) - Number(item.unit_price_cents)) *
          Number(item.quantity)
      }
      if (!current.lastPurchaseAt || purchase.created_at > current.lastPurchaseAt) {
        current.lastPurchaseAt = purchase.created_at
      }
      purchasesByUserMap.set(key, current)
    }
  }
  const purchasesByUser = [...purchasesByUserMap.values()]
    .sort((a, b) => b.total - a.total)
    .map((row) => ({
      userId: row.userId,
      name: row.name,
      role: row.role ? roleLabel(row.role as any) : 'Sin rol',
      purchases: row.purchases,
      items: row.items,
      total: money(row.total),
      iva: money(row.iva),
      estimatedMargin: canGross ? money(row.estimatedMargin) : null,
      lastPurchaseAt: row.lastPurchaseAt
    }))

  const accountRows = db.all<any>(
    `SELECT m.account_id, a.name,
            SUM(CASE WHEN m.type = 'ingreso' THEN m.amount_cents ELSE 0 END) AS income_cents,
            SUM(CASE WHEN m.type = 'egreso' THEN m.amount_cents ELSE 0 END) AS expense_cents,
            COUNT(*) AS entries
     FROM account_movements m
     JOIN dictionary_nodes a ON a.id = m.account_id
     WHERE datetime(m.created_at) >= datetime(?)
     GROUP BY m.account_id, a.name
     ORDER BY a.name`,
    start.toISOString()
  )
  const accountSummary = accountRows.map((row) => {
    const all = db.get<any>(
      `SELECT
         SUM(CASE WHEN type = 'ingreso' THEN amount_cents ELSE 0 END) AS income_cents,
         SUM(CASE WHEN type = 'egreso' THEN amount_cents ELSE 0 END) AS expense_cents
       FROM account_movements WHERE account_id = ?`,
      row.account_id
    )
    return {
      accountName: row.name,
      income: money(Number(row.income_cents ?? 0)),
      expenses: money(Number(row.expense_cents ?? 0)),
      balance: money(Number(all?.income_cents ?? 0) - Number(all?.expense_cents ?? 0)),
      entries: Number(row.entries ?? 0)
    }
  })

  const chartData = monthlyChartData(db)

  return {
    period,
    salesTotal: money(salesCents),
    salesPos: money(salesPosCents),
    salesOt: money(salesOtCents),
    invoiceCount: invoices.length,
    invoiceCountPos: posInvoices.length,
    invoiceCountOt: otInvoices.length,
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
    salesByUser,
    technicianRevenue,
    purchasesByUser,
    accountSummary,
    purchaseTrackingEnabled,
    invoices: invoices.slice(0, 50).map((invoice) => invoiceDto(db, invoice)),
    payments: payments.slice(0, 50).map((payment) => paymentDto(db, payment)),
    permissions: { grossMargin: canGross, netProfit: canNet }
  }
}

function requireCapabilitySoft(role: string, capability: BackendCapability) {
  return can(role as any, capability)
}
function notificationData(db: Database, session?: Session) {
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
  if (session) {
    const transfers = pendingTransfersFor(db, session.userId)
    if (transfers.length) {
      data.push({
        id: 'cash-transfers',
        title: `${transfers.length} traslado${transfers.length === 1 ? '' : 's'} a banco pendiente${transfers.length === 1 ? '' : 's'}`,
        description: 'Revisa el monto y aprueba o rechaza desde Caja.',
        time: 'Ahora',
        tone: 'warning'
      })
    }
    if (session.role === 'admin' || session.role === 'superadmin') {
      const promoAlerts = promotionAlertData(db)
      if (promoAlerts.belowCost > 0) {
        data.push({
          id: 'promotions-below-cost',
          title: `${promoAlerts.belowCost} promoción${promoAlerts.belowCost === 1 ? '' : 'es'} por debajo del costo`,
          description: `Revisa ${promoAlerts.belowCostNames.join(', ')}.`,
          time: 'Ahora',
          tone: 'danger'
        })
      }
      const catalog = db.getSetting<any>('catalog_config', DEFAULT_SETTINGS.catalog)
      if (catalog?.lastStatus === 'error') {
        data.push({
          id: 'catalog-publish-error',
          title: 'No se pudo publicar el catálogo web',
          description: String(catalog.lastMessage || 'Revisa la configuración de la carpeta de publicación.'),
          time: 'Ahora',
          tone: 'danger'
        })
      } else if (catalog?.lastStatus === 'pending') {
        data.push({
          id: 'catalog-publish-pending',
          title: 'Publicación del catálogo web en curso',
          description: String(catalog.lastMessage || 'Espera a que termine la publicación.'),
          time: 'Ahora',
          tone: 'info'
        })
      }
      if (catalog?.remote?.enabled && catalog.remote?.lastStatus === 'error') {
        data.push({
          id: 'catalog-remote-error',
          title: 'No se pudo publicar el catálogo en Supabase',
          description: String(
            catalog.remote.lastMessage ||
              'Revisa la URL, el bucket y la clave secreta de Supabase.'
          ),
          time: 'Ahora',
          tone: 'danger'
        })
      } else if (catalog?.remote?.enabled && catalog.remote?.lastStatus === 'pending') {
        data.push({
          id: 'catalog-remote-pending',
          title: 'Publicación en Supabase en curso',
          description: String(catalog.remote.lastMessage || 'Espera a que termine la publicación.'),
          time: 'Ahora',
          tone: 'info'
        })
      }
    }
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

    const productImagesSource = productImageRoot(runtime.userDataPath)
    const productImagesTarget = path.join(folder, PRODUCT_IMAGE_FOLDER)
    fs.mkdirSync(productImagesTarget, { recursive: true })
    if (fs.existsSync(productImagesSource)) {
      fs.cpSync(productImagesSource, productImagesTarget, { recursive: true, force: true })
    }

    const paymentReceiptsSource = paymentReceiptRoot(runtime.userDataPath)
    const paymentReceiptsTarget = path.join(folder, PAYMENT_RECEIPT_FOLDER)
    fs.mkdirSync(paymentReceiptsTarget, { recursive: true })
    if (fs.existsSync(paymentReceiptsSource)) {
      fs.cpSync(paymentReceiptsSource, paymentReceiptsTarget, { recursive: true, force: true })
    }

    const evidenceRows = db.all<any>(
      `SELECT e.*, w.number AS order_number, w.customer_id, c.name AS customer_name
       FROM work_order_evidence e
       JOIN work_orders w ON w.id = e.work_order_id
       JOIN customers c ON c.id = w.customer_id
       ORDER BY e.captured_at ASC, e.rowid ASC`
    )
    const evidenceFiles = walkFiles(evidenceTarget)
    const productImageFiles = walkFiles(productImagesTarget)
    const paymentReceiptFiles = walkFiles(paymentReceiptsTarget)
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
      productImages: {
        count: productImageFiles.length,
        bytes: productImageFiles.reduce((sum, file) => sum + file.size, 0),
        files: productImageFiles.map((file) => ({
          path: file.relative,
          size: file.size,
          sha256: sha256Bytes(fs.readFileSync(file.absolute))
        }))
      },
      paymentReceipts: {
        count: paymentReceiptFiles.length,
        bytes: paymentReceiptFiles.reduce((sum, file) => sum + file.size, 0),
        files: paymentReceiptFiles.map((file) => ({
          path: file.relative,
          size: file.size,
          sha256: sha256Bytes(fs.readFileSync(file.absolute))
        }))
      },
      disclaimer:
        'Respaldo completo de BitacoreTech: base de datos, evidencias fotográficas, imágenes de inventario, comprobantes de pago y manifiesto de integridad. Conserve esta carpeta como soporte de reclamos.'
    }
    const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8')
    fs.writeFileSync(path.join(folder, 'manifest.json'), manifestBuffer)
    const totalSize =
      databaseBytes.length +
      evidenceFiles.reduce((sum, file) => sum + file.size, 0) +
      productImageFiles.reduce((sum, file) => sum + file.size, 0) +
      paymentReceiptFiles.reduce((sum, file) => sum + file.size, 0) +
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
    permissions: effectiveCapabilities(db, user.id, user.role),
    modules: effectiveModules(db, user.id, user.role)
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
  const sourceProductImages = path.join(String(backup.path), PRODUCT_IMAGE_FOLDER)
  const hasProductImages = format === 'folder' && fs.existsSync(sourceProductImages)
  const sourcePaymentReceipts = path.join(String(backup.path), PAYMENT_RECEIPT_FOLDER)
  const hasPaymentReceipts = format === 'folder' && fs.existsSync(sourcePaymentReceipts)
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
    const currentProductImages = productImageRoot(runtime.userDataPath)
    if (fs.existsSync(currentProductImages)) {
      fs.rmSync(currentProductImages, { recursive: true, force: true })
    }
    if (hasProductImages) {
      fs.cpSync(sourceProductImages, currentProductImages, { recursive: true, force: true })
    } else {
      fs.mkdirSync(currentProductImages, { recursive: true })
    }
    const currentPaymentReceipts = paymentReceiptRoot(runtime.userDataPath)
    if (fs.existsSync(currentPaymentReceipts)) {
      fs.rmSync(currentPaymentReceipts, { recursive: true, force: true })
    }
    if (hasPaymentReceipts) {
      fs.cpSync(sourcePaymentReceipts, currentPaymentReceipts, { recursive: true, force: true })
    } else {
      fs.mkdirSync(currentPaymentReceipts, { recursive: true })
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
  const restoredProductColumns = restored.all<{ name: string }>('PRAGMA table_info(products)')
  if (
    !hasProductImages &&
    restoredProductColumns.some((column) => column.name === 'image_path')
  ) {
    restored.run(
      'UPDATE products SET image_path = NULL, image_thumb_path = NULL, image_updated_at = NULL'
    )
  }
  if (!hasPaymentReceipts) {
    const receiptTable = restored.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'payment_receipts'"
    )
    if (receiptTable) restored.run('DELETE FROM payment_receipts')
  }
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
  const restoredAiKey = restored.getSetting<any>('ai_key', null)
  if (restoredAiKey?.encrypted) {
    restored.run("DELETE FROM app_settings WHERE key = 'ai_key'")
    const aiConfig = restored.getSetting<any>('ai_config', DEFAULT_SETTINGS.ai)
    restored.setSetting('ai_config', {
      ...aiConfig,
      configured: false,
      keyFingerprint: null
    })
    restored.appendAudit({
      userId: session.userId,
      userName: displayUser(session).name,
      role: roleLabel(session.role as any),
      action: 'Clave de IA descartada por restauración',
      entity: 'Respaldo',
      entityId: backup.id,
      detail: 'La clave de IA se descartó para evitar dependencia del equipo de origen. Vuelve a configurarla.'
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
    const admin = db.get<{ id: string }>(
      "SELECT id FROM users WHERE role = 'admin' AND active = 1 LIMIT 1"
    )
    const setup = db.get<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'setup_completed'"
    )
    const setupRequired = setup?.value !== '1' || !admin
    return { setupRequired, hasUsers: users > 0, hasAdmin: Boolean(admin) }
  }

  if (command === 'auth.setup') {
    const db = currentSession()
    const currentAdmin = db.get<{ id: string }>(
      "SELECT id FROM users WHERE role = 'admin' AND active = 1 LIMIT 1"
    )
    const setup = db.get<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'setup_completed'"
    )
    if (setup?.value === '1' && currentAdmin) {
      fail('La aplicación ya está configurada.', 'ALREADY_SETUP')
    }
    if (!db.get("SELECT id FROM users WHERE role = 'superadmin' LIMIT 1")) {
      fail('No se encontró la cuenta raíz protegida. Reinstala o restaura un respaldo válido.', 'OWNER_MISSING')
    }
    const name = text(payload?.name, 'Nombre del administrador', 3, 160)
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
    const adminId = db.get("SELECT id FROM users WHERE id = 'u1'") ? `u_admin_${sha256(`${username}|${Date.now()}`).slice(0, 12)}` : 'u1'
    const admin: SeedOwner = { id: adminId, username, name, email, password }

    db.tx(() => {
      if (demo) {
        runDemoSeed(db, admin)
      } else {
        db.run(
          `INSERT INTO users (id, username, name, email, role, password_hash, active, is_protected, created_at, created_by)
           VALUES (?, ?, ?, ?, 'admin', ?, 1, 0, ?, NULL)`,
          admin.id,
          admin.username,
          admin.name,
          admin.email,
          hashPassword(admin.password),
          new Date().toISOString()
        )
      }
      // El seed demo ya creó el administrador; se asegura que use las credenciales elegidas.
      if (demo) {
        db.run(
          `UPDATE users
           SET username = ?, name = ?, email = ?, password_hash = ?, role = 'admin', active = 1, is_protected = 0
           WHERE id = ?`,
          admin.username,
          admin.name,
          admin.email,
          hashPassword(admin.password),
          admin.id
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
        admin.id,
        updatedAt
      )

      db.appendAudit({
        userId: admin.id,
        userName: admin.name,
        role: 'Administrador',
        action: 'Configuración inicial',
        entity: 'Sistema',
        detail: `Administrador ${admin.username} creado. Negocio: ${businessName}.${demo ? ' Datos de demostración cargados.' : ''}`
      })
      db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('setup_completed', '1')")
    })

    const created = db.get<any>('SELECT * FROM users WHERE id = ?', admin.id)
    if (!created) fail('No se pudo crear la cuenta del administrador.', 'INTERNAL_ERROR')
    const issued = issueSession(db, created)
    const sessionLike = {
      token: issued.token,
      tokenHash: sha256(issued.token),
      userId: created.id,
      userName: created.name,
      username: created.username,
      email: created.email ?? '',
      actualRole: 'admin',
      role: 'admin',
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
    const setupAdmin = db.get<{ id: string }>(
      "SELECT id FROM users WHERE role = 'admin' AND active = 1 LIMIT 1"
    )
    const setup = db.get<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'setup_completed'"
    )
    if (!setupAdmin || setup?.value !== '1') {
      fail('La aplicación aún no está configurada. Crea la cuenta del administrador.', 'SETUP_REQUIRED')
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
      const performanceStart = new Date(Date.now() - 30 * 24 * 3600_000).toISOString()
      const sellerPerformance = db.get<any>(
        `SELECT COUNT(*) AS invoices, COALESCE(SUM(total_cents), 0) AS sales
         FROM invoices
         WHERE status = 'activa' AND created_by = ? AND datetime(created_at) >= datetime(?)`,
        session.userId,
        performanceStart
      )
      const technicianPerformance = db.get<any>(
        `SELECT COUNT(*) AS orders, COALESCE(SUM(i.total_cents), 0) AS sales
         FROM invoices i JOIN work_orders w ON w.id = i.order_id
         WHERE i.status = 'activa' AND w.technician_id = ? AND datetime(i.created_at) >= datetime(?)`,
        session.userId,
        performanceStart
      )
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
        personalPerformance: {
          sellerInvoices: Number(sellerPerformance?.invoices ?? 0),
          sellerSales: money(Number(sellerPerformance?.sales ?? 0)),
          technicianOrders: Number(technicianPerformance?.orders ?? 0),
          technicianSales: money(Number(technicianPerformance?.sales ?? 0))
        },
        notifications: notificationData(db, session)
      }
    }

    case 'notifications.list': {
      return notificationData(db, session)
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
      const id = `cust_${sha256(`${name}|${Date.now()}|${Math.random()}`).slice(0, 20)}`
      const rawDocument = typeof payload?.document === 'string' ? payload.document.trim().slice(0, 40) : ''
      const documentMissing = !rawDocument
      let document = documentMissing ? customerPlaceholderDocument(id) : rawDocument
      if (!documentMissing && documentType === 'NIT' && !isForeignDocument) {
        const digits = normalizeNit(document)
        if (document !== digits) fail('El NIT debe contener solo números, sin puntos ni espacios.')
        const dv = typeof payload?.documentDv === 'string' ? payload.documentDv.trim() : calculateNitDv(digits)
        if (!isValidNit(digits, dv)) fail('El dígito de verificación del NIT no es válido.')
        document = digits
      }
      if (!documentMissing) {
        const existing = db.get<any>('SELECT id, name FROM customers WHERE document = ?', document)
        if (existing) fail(`Ya existe un cliente con ese documento: ${existing.name}`, 'DUPLICATE')
      }
      const phones = normalizeCustomerPhones(payload, payload?.phone)
      if ((payload?.phones !== undefined || payload?.phone !== undefined) && !phones.length) {
        fail('El cliente debe tener al menos un teléfono principal.')
      }
      const primaryPhone = phones.find((item) => item.isPrimary)?.phone ?? '—'
      const creditEnabled = Boolean(payload?.creditEnabled)
      if (creditEnabled) requireCap(session, 'manageLoyalty')
      const nowIso = new Date().toISOString()
      db.tx(() => {
        db.run(
          `INSERT INTO customers
            (id, name, document_type, document, phone, email, address, is_final_consumer, is_foreign_document,
             document_missing, loyalty_active, loyalty_discount_type, loyalty_discount_value, loyalty_valid_until,
             loyalty_notes, credit_enabled, created_at, updated_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, 'percent', 0, NULL, NULL, ?, ?, ?, ?)`,
          id,
          name,
          documentType,
          document,
          primaryPhone,
          text(payload?.email ?? '—', 'Correo', 1, 160) || '—',
          text(payload?.address ?? 'Sin dirección', 'Dirección', 1, 240) || 'Sin dirección',
          isForeignDocument ? 1 : 0,
          documentMissing ? 1 : 0,
          creditEnabled ? 1 : 0,
          nowIso,
          nowIso,
          session.userId
        )
        saveCustomerPhones(db, id, phones, nowIso)
        audit(
          db,
          session,
          'Creación de cliente',
          'Cliente',
          `${name} · ${documentMissing ? 'sin documento' : `${documentType} ${document}`}${isForeignDocument ? ' · documento extranjero' : ''} · ${primaryPhone}`,
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
      const phonesTouched = Array.isArray(payload?.phones) || typeof payload?.phone === 'string'
      const phones = phonesTouched ? normalizeCustomerPhones(payload, payload?.phone) : []
      if (phonesTouched && !phones.length && !Boolean(row.is_final_consumer)) {
        fail('El cliente debe tener al menos un teléfono.')
      }
      if (typeof payload?.name === 'string') {
        updates.push('name = ?')
        params.push(text(payload.name, 'Nombre', 2, 160))
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
        const rawDocument =
          typeof payload?.document === 'string'
            ? payload.document.trim().slice(0, 40)
            : row.document_missing
              ? ''
              : String(row.document ?? '')
        const documentMissing = !rawDocument
        let document = documentMissing
          ? row.document_missing
            ? row.document
            : customerPlaceholderDocument(id)
          : rawDocument
        if (!documentMissing && documentType === 'NIT' && !isForeignDocument) {
          const digits = normalizeNit(document)
          if (document !== digits) fail('El NIT debe contener solo números, sin puntos ni espacios.')
          const dv = typeof payload?.documentDv === 'string' ? payload.documentDv.trim() : calculateNitDv(digits)
          if (!isValidNit(digits, dv)) fail('El dígito de verificación del NIT no es válido.')
          document = digits
        }
        if (!documentMissing) {
          const duplicate = db.get<any>('SELECT id, name FROM customers WHERE document = ? AND id <> ?', document, id)
          if (duplicate) fail(`Ya existe un cliente con ese documento: ${duplicate.name}`, 'DUPLICATE')
        }
        updates.push('document_type = ?', 'document = ?', 'is_foreign_document = ?', 'document_missing = ?')
        params.push(documentType, document, isForeignDocument ? 1 : 0, documentMissing ? 1 : 0)
      }
      if (payload?.creditEnabled !== undefined) {
        requireCap(session, 'manageLoyalty')
        updates.push('credit_enabled = ?')
        params.push(payload.creditEnabled ? 1 : 0)
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
      if (!updates.length && !phonesTouched) fail('No hay cambios para guardar')
      const nowIso = new Date().toISOString()
      updates.push('updated_at = ?')
      params.push(nowIso, id)
      db.tx(() => {
        db.run(`UPDATE customers SET ${updates.join(', ')} WHERE id = ?`, ...params)
        if (phonesTouched) saveCustomerPhones(db, id, phones, nowIso)
        audit(
          db,
          session,
          touchesLoyalty ? 'Actualización de fidelidad' : 'Actualización de cliente',
          'Cliente',
          touchesLoyalty
            ? `${row.name} · fidelidad ${payload?.loyaltyActive === false ? 'desactivada' : 'actualizada'}`
            : `${row.name} actualizado${phonesTouched ? ' · teléfonos' : ''}`,
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
      validateTechnicalSheet(payload?.technicalSheet)
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
        validateTechnicalSheet(payload.technicalSheet)
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

    case 'inventory.suggestSku': {
      requireModuleAccess(session, 'inventory')
      requireCap(session, 'editInventory')
      const name = text(payload?.name, 'Nombre', 2, 160)
      const supplierSku =
        typeof payload?.supplierSku === 'string' ? payload.supplierSku.trim().slice(0, 60) : ''
      const productId = typeof payload?.productId === 'string' ? payload.productId : ''
      const existingSkus = db
        .all<{ sku: string }>('SELECT sku FROM products WHERE id <> ?', productId)
        .map((row) => row.sku)
      const result = resolveInternalSku({
        aiSku: '',
        name,
        supplierSku,
        existingSkus
      })
      if (!result.sku) fail('No se pudo generar un SKU para este producto.')
      return result
    }

    case 'inventory.generateMissingSkus': {
      requireModuleAccess(session, 'inventory')
      requireCap(session, 'editInventory')
      const rows = db.all<any>(
        "SELECT id, name, supplier_sku FROM products WHERE active = 1 AND (sku IS NULL OR TRIM(sku) = '' OR TRIM(sku) = '-')"
      )
      const used = new Set(
        db
          .all<{ sku: string }>('SELECT sku FROM products')
          .map((row) => String(row.sku).toLowerCase())
      )
      let updated = 0
      db.tx(() => {
        for (const row of rows) {
          const result = resolveInternalSku({
            aiSku: '',
            name: String(row.name),
            supplierSku: String(row.supplier_sku ?? ''),
            existingSkus: [...used]
          })
          if (!result.sku) continue
          db.run('UPDATE products SET sku = ?, updated_at = ? WHERE id = ?', result.sku, new Date().toISOString(), row.id)
          used.add(result.sku.toLowerCase())
          updated += 1
        }
        if (updated > 0) {
          audit(
            db,
            session,
            'Generación masiva de SKU',
            'Producto',
            `${updated} producto${updated === 1 ? '' : 's'} sin SKU actualizado${updated === 1 ? '' : 's'}.`
          )
        }
      })
      return { updated, pending: rows.length - updated }
    }

    case 'inventory.create': {
      requireModuleAccess(session, 'inventory')
      requireCap(session, 'editInventory')
      const name = text(payload?.name, 'Nombre', 2, 160)
      const supplierSku =
        typeof payload?.supplierSku === 'string' ? payload.supplierSku.trim().slice(0, 60) : ''
      const requestedSku = typeof payload?.sku === 'string' ? payload.sku.trim() : ''
      let sku = requestedSku ? text(requestedSku, 'SKU', 2, 60) : ''
      if (!sku) {
        const generated = resolveInternalSku({
          aiSku: '',
          name,
          supplierSku,
          existingSkus: db.all<{ sku: string }>('SELECT sku FROM products').map((row) => row.sku)
        })
        if (!generated.sku) fail('No se pudo generar un SKU para este producto.')
        sku = generated.sku
      }
      if (db.get<any>('SELECT id FROM products WHERE sku = ?', sku)) fail('Ya existe un producto con ese SKU', 'DUPLICATE')
      const price = numberValue(payload?.price, 'Precio', { min: 1 })
      const cost = numberValue(payload?.cost ?? 0, 'Costo', { min: 0 })
      const stock = numberValue(payload?.stock ?? 0, 'Stock', { min: 0 })
      const minStock = numberValue(payload?.minStock ?? 0, 'Stock mínimo', { min: 0 })
      const rotation = schema(payload?.rotation ?? 'rotativo', z.enum(['rotativo', 'no_rotativo', 'prueba']))
      const alertEnabled = payload?.alertEnabled === undefined ? rotation === 'rotativo' : Boolean(payload.alertEnabled)
      const condition =
        typeof payload?.condition === 'string' ? payload.condition.trim().slice(0, 80) : ''
      const service = Boolean(payload?.service)
      const publishWeb =
        !service &&
        isWebProductCondition(condition) &&
        (payload?.publishWeb === undefined ? true : Boolean(payload.publishWeb))
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
      const imageDataUrl = typeof payload?.imageDataUrl === 'string' ? payload.imageDataUrl : ''
      let preparedImage = null as ReturnType<typeof prepareProductImage> | null
      if (imageDataUrl) {
        try {
          preparedImage = prepareProductImage({
            userDataPath: runtime.userDataPath,
            productId: id,
            dataUrl: imageDataUrl,
            thumbnailDataUrl: payload?.imageThumbnailDataUrl
          })
        } catch (error) {
          fail(error instanceof Error ? error.message : 'No se pudo preparar la imagen del producto.')
        }
      }
      const nowIso = new Date().toISOString()
      try {
        db.tx(() => {
          db.run(
            `INSERT INTO products
              (id, name, sku, barcode, supplier_sku, category, location, condition, origin, stock, min_stock, cost_cents, price_cents,
               image_path, image_thumb_path, image_updated_at,
               warranty_days, is_service, service_type, alert_enabled, publish_web, rotation, active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
            id,
            name,
            sku,
            barcode,
            supplierSku,
            text(payload?.category ?? 'Repuestos', 'Categoría', 2, 80),
            text(payload?.location ?? 'Bodega A', 'Ubicación', 2, 80),
            condition,
            typeof payload?.origin === 'string' ? payload.origin.trim().slice(0, 80) : '',
            stock,
            minStock,
            toCents(cost),
            toCents(price),
            preparedImage?.imagePath ?? null,
            preparedImage?.imageThumbPath ?? null,
            preparedImage ? nowIso : null,
            Math.max(0, Math.round(numberValue(payload?.warrantyDays ?? 0, 'Garantía', { min: 0 }))),
            service ? 1 : 0,
            serviceType,
            alertEnabled ? 1 : 0,
            publishWeb ? 1 : 0,
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
          audit(
            db,
            session,
            'Creación de producto',
            'Producto',
            `${name} · SKU ${sku}${preparedImage ? ' · con imagen' : ''}`,
            id
          )
        })
      } catch (error) {
        if (preparedImage) {
          removeProductImageFiles(runtime.userDataPath, [
            preparedImage.imagePath,
            preparedImage.imageThumbPath
          ])
        }
        throw error
      }
      scheduleCatalogPublish(db, runtime)
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
        const requested = typeof payload.sku === 'string' ? payload.sku.trim() : ''
        let sku = requested ? text(requested, 'SKU', 2, 60) : ''
        if (!sku) {
          const generated = resolveInternalSku({
            aiSku: '',
            name: String(payload.name ?? product.name),
            supplierSku:
              payload.supplierSku !== undefined
                ? String(payload.supplierSku ?? '').trim()
                : String(product.supplier_sku ?? ''),
            existingSkus: db
              .all<{ sku: string }>('SELECT sku FROM products WHERE id <> ?', productId)
              .map((row) => row.sku)
          })
          if (!generated.sku) fail('No se pudo generar un SKU para este producto.')
          sku = generated.sku
        }
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
      if (payload?.supplierSku !== undefined) {
        updates.push('supplier_sku = ?')
        params.push(
          typeof payload.supplierSku === 'string' ? payload.supplierSku.trim().slice(0, 60) : ''
        )
        changed.push('SKU de proveedor')
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
      let nextCondition = String(product.condition ?? '')
      if (payload?.condition !== undefined) {
        nextCondition =
          typeof payload.condition === 'string' ? payload.condition.trim().slice(0, 80) : ''
        updates.push('condition = ?')
        params.push(nextCondition)
        changed.push('condición')
      }
      if (payload?.origin !== undefined) {
        updates.push('origin = ?')
        params.push(typeof payload.origin === 'string' ? payload.origin.trim().slice(0, 80) : '')
        changed.push('origen')
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
      const publishWebAllowed = !nextService && isWebProductCondition(nextCondition)
      const nextPublishWeb = publishWebAllowed
        ? payload?.publishWeb !== undefined
          ? Boolean(payload.publishWeb)
          : Boolean(product.publish_web)
        : false
      if (
        payload?.publishWeb !== undefined ||
        nextPublishWeb !== Boolean(product.publish_web)
      ) {
        updates.push('publish_web = ?')
        params.push(nextPublishWeb ? 1 : 0)
        changed.push(
          nextPublishWeb
            ? 'publicación web activada'
            : publishWebAllowed
              ? 'publicación web desactivada'
              : 'publicación web desactivada por condición'
        )
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
      const imageDataUrl = typeof payload?.imageDataUrl === 'string' ? payload.imageDataUrl : ''
      const removeImage = Boolean(payload?.removeImage)
      let preparedImage = null as ReturnType<typeof prepareProductImage> | null
      if (imageDataUrl) {
        try {
          preparedImage = prepareProductImage({
            userDataPath: runtime.userDataPath,
            productId,
            dataUrl: imageDataUrl,
            thumbnailDataUrl: payload?.imageThumbnailDataUrl
          })
        } catch (error) {
          fail(error instanceof Error ? error.message : 'No se pudo preparar la imagen del producto.')
        }
      }
      if (removeImage && !preparedImage) {
        updates.push('image_path = NULL', 'image_thumb_path = NULL', 'image_updated_at = NULL')
        changed.push('imagen eliminada')
      } else if (preparedImage) {
        updates.push('image_path = ?', 'image_thumb_path = ?', 'image_updated_at = ?')
        params.push(
          preparedImage.imagePath,
          preparedImage.imageThumbPath,
          new Date().toISOString()
        )
        changed.push('imagen actualizada')
      }
      if (!updates.length) fail('No hay cambios para guardar')
      updates.push('updated_at = ?')
      params.push(new Date().toISOString())
      const oldImagePaths = [product.image_path, product.image_thumb_path].filter(Boolean)
      try {
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
      } catch (error) {
        if (preparedImage) {
          removeProductImageFiles(runtime.userDataPath, [
            preparedImage.imagePath,
            preparedImage.imageThumbPath
          ])
        }
        throw error
      }
      if (preparedImage || removeImage) {
        const nextImagePaths = new Set(
          preparedImage ? [preparedImage.imagePath, preparedImage.imageThumbPath] : []
        )
        removeProductImageFiles(
          runtime.userDataPath,
          oldImagePaths.filter((item) => !nextImagePaths.has(String(item)))
        )
      }
      scheduleCatalogPublish(db, runtime)
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
      scheduleCatalogPublish(db, runtime)
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
      validateTechnicalSheet(intakeInput.technicalSheet)
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
      const reportedIssue = text(payload?.reportedIssue, 'Motivo de ingreso', 4, 3000)
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
      let trackingCode = ''
      do {
        trackingCode = `SG-${randomBytes(8).toString('hex').toUpperCase()}`
      } while (db.get('SELECT id FROM work_orders WHERE tracking_code = ?', trackingCode))
      const intake = {
        ...intakeInput,
        category,
        categoryLabel,
        customBuild: customBuild || undefined,
        alias: alias ?? undefined,
        estimate: Math.max(0, numberValue(intakeInput.estimate ?? 0, 'Presupuesto', { min: 0 })),
        diagnosticFee: Math.max(0, numberValue(intakeInput.diagnosticFee ?? 0, 'Diagnóstico', { min: 0 })),
        accessories: Array.isArray(intakeInput.accessories) ? intakeInput.accessories.slice(0, 40) : [],
        serviceKind: intakeInput.serviceKind === 'mantenimiento' ? 'mantenimiento' : 'falla',
        serviceType:
          typeof intakeInput.serviceType === 'string' && intakeInput.serviceType.trim()
            ? intakeInput.serviceType.trim().slice(0, 120)
            : undefined,
        serviceDetail:
          typeof intakeInput.serviceDetail === 'string' && intakeInput.serviceDetail.trim()
            ? intakeInput.serviceDetail.trim().slice(0, 1000)
            : undefined,
        receivedBy: displayUser(session).name,
        receivedAt: nowIso,
        legal: createSnapshot(db, nowIso, intakeInput.technicalSheet)
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
            (id, number, tracking_code, customer_id, equipment_id, device_category, category_label, equipment_type, brand, model, serial,
             accessories, physical_condition, reported_issue, diagnosis, status, technician_id, created_at,
             promised_at, notes, intake_json, received_by, created_by, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'recibido', ?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          number,
          trackingCode,
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
      if (
        db.get(
          "SELECT id FROM invoices WHERE order_id = ? AND status = 'activa' LIMIT 1",
          row.id
        )
      ) {
        fail('La OT ya está facturada; no admite nuevos ítems.')
      }
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
      const requestedWarranty =
        payload?.warrantyDays !== undefined && payload?.warrantyDays !== null && payload?.warrantyDays !== ''
          ? Math.round(numberValue(payload.warrantyDays, 'Garantía del repuesto', { min: 0, max: 3650 }))
          : null
      const canCarryWarranty = type === 'repuesto' && Boolean(product) && !product?.is_service
      if (!canCarryWarranty && requestedWarranty && requestedWarranty > 0) {
        fail('La garantía solo aplica a repuestos vinculados a un producto del inventario.')
      }
      const warrantyDays = canCarryWarranty
        ? requestedWarranty ?? Math.max(0, Math.min(3650, Number(product?.warranty_days ?? 0)))
        : 0
      const nowIso = new Date().toISOString()
      const itemId = `woi_${Date.now()}`
      db.tx(() => {
        db.run(
          `INSERT INTO work_order_items
            (id, work_order_id, type, description, quantity, unit_price_cents, product_id, unit_cost_cents, warranty_days, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          itemId,
          row.id,
          type,
          description,
          quantity,
          toCents(unitPrice),
          productId,
          unitCost,
          warrantyDays,
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
          `${row.number} · ${description} × ${quantity} · ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(unitPrice)}${warrantyDays > 0 ? ` · garantía ${warrantyDays} días` : ''}`,
          row.id
        )
      })
      scheduleCatalogPublish(db, runtime)
      return orderDto(db, getOrderOrFail(db, row.id))
    }

    case 'orders.addPayment': {
      requireModuleAccess(session, 'orders')
      requireCap(session, 'settleOrder')
      const row = getOrderOrFail(db, text(payload?.id, 'Orden', 1, 80))
      if (['entregado', 'no_reparado'].includes(row.status)) fail('La OT ya está cerrada; no admite anticipos.')
      const invoice = db.get<any>(
        "SELECT * FROM invoices WHERE order_id = ? AND status = 'activa' ORDER BY created_at DESC LIMIT 1",
        row.id
      )
      const totalCents = invoice
        ? Number(invoice.total_cents)
        : orderItemsTotal(db, row.id) || toCents(JSON.parse(row.intake_json ?? '{}').estimate ?? 0)
      if (!totalCents) fail('Primero registra ítems o un presupuesto en la OT.')
      const paidCents = Number(orderPaidTotal(db, row.id))
      const balanceCents = totalCents - paidCents
      if (balanceCents <= 0) fail('La OT ya está pagada en su totalidad.')
      const amount = numberValue(payload?.amount, 'Valor del anticipo', { min: 0.01 })
      const amountCents = toCents(amount)
      if (amountCents > balanceCents) fail(`El anticipo supera el saldo pendiente (${money(balanceCents)}).`)
      const method = schema(payload?.method, z.enum(['Efectivo', 'Transferencia', 'Tarjeta', 'Mixto']))
      assertDigitalReceipt(db, method, payload?.receipt)
      requireCashSession(db)
      const number = db.paymentNumber()
      const id = `pay_${sha256(`${row.id}|${number}|${Date.now()}`).slice(0, 20)}`
      const incomeAccount =
        method === 'Efectivo' || method === 'Mixto' ? null : requireIncomeAccount(db)
      const preparedReceipt = prepareReceiptFromPayload(runtime, id, payload?.receipt)
      const nowIso = new Date().toISOString()
      try {
        db.tx(() => {
        db.run(
          `INSERT INTO payments
            (id, number, kind, order_id, invoice_id, method, amount_cents, received_cents, change_cents, reference,
             income_account_id, income_account_name, is_exception, created_by, created_by_name, created_by_role, created_at)
           VALUES (?, ?, 'anticipo', ?, NULL, ?, ?, ?, 0, ?, ?, ?, 0, ?, ?, ?, ?)`,
          id,
          number,
          row.id,
          method,
          amountCents,
          amountCents,
          typeof payload?.reference === 'string' ? payload.reference.slice(0, 160) : null,
          incomeAccount?.id ?? null,
          incomeAccount?.name ?? null,
          session.userId,
          displayUser(session).name,
          session.actualRole,
          nowIso
        )
        insertPaymentReceipt(db, session, id, preparedReceipt)
        if (incomeAccount) {
          recordAccountMovement(db, session, {
            accountId: incomeAccount.id,
            accountName: incomeAccount.name,
            type: 'ingreso',
            amountCents,
            description: `Anticipo ${row.number} · ${row.customer_name} · ${method}`,
            referenceType: 'payment',
            referenceId: id,
            createdAt: nowIso
          })
        }
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
          `${row.number} · anticipo ${number} · ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(amount)} · ${method}${incomeAccount ? ` · ${incomeAccount.name}` : ''}${preparedReceipt ? ' · comprobante' : ''}`,
          row.id
        )
        })
      } catch (error) {
        if (preparedReceipt) {
          removePaymentReceiptFiles(runtime.userDataPath, [preparedReceipt.relativePath])
        }
        throw error
      }
      return orderDto(db, getOrderOrFail(db, row.id))
    }

    case 'orders.invoice': {
      requireModuleAccess(session, 'orders')
      requireCap(session, 'settleOrder')
      const row = getOrderOrFail(db, text(payload?.id, 'Orden', 1, 80))
      if (row.status === 'entregado') fail('La OT ya fue entregada y cerrada.')
      if (row.status !== 'listo') fail('La OT debe estar en estado Listo para entrega antes de facturar.')
      const existing = db.get<any>(
        "SELECT * FROM invoices WHERE order_id = ? AND status = 'activa' ORDER BY created_at DESC LIMIT 1",
        row.id
      )
      if (existing) return orderDto(db, getOrderOrFail(db, row.id))
      const intake = JSON.parse(row.intake_json ?? '{}')
      const subtotalCents = orderItemsTotal(db, row.id) || toCents(intake.estimate ?? 0)
      if (subtotalCents <= 0) {
        fail('No hay valores por cobrar. Agrega ítems o un presupuesto en la OT.')
      }
      const customer = db.get<any>('SELECT * FROM customers WHERE id = ?', row.customer_id)
      const discount = resolveSaleDiscount(customer, payload, session, subtotalCents)
      const discountCents = discountCentsFor(discount.type, discount.value, subtotalCents)
      const orderItemRows = db.all<any>('SELECT * FROM work_order_items WHERE work_order_id = ?', row.id)
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
      const totalCents = subtotalCents - discountCents
      let invoice: { id: string; number: string } | null = null
      db.tx(() => {
        invoice = createOrderInvoice(
          db,
          session,
          row,
          subtotalCents,
          totalCents,
          'Pendiente',
          false,
          '',
          {
            type: discount.type as 'percent' | 'amount',
            value: discount.value,
            cents: discountCents
          }
        )
        audit(
          db,
          session,
          'Facturación de OT',
          'Orden de trabajo',
          `${row.number} · ${invoice!.number} · ${new Intl.NumberFormat('es-CO', {
            style: 'currency',
            currency: 'COP',
            maximumFractionDigits: 0
          }).format(money(totalCents))}`,
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
      const existingInvoice = db.get<any>(
        "SELECT * FROM invoices WHERE order_id = ? AND status = 'activa' ORDER BY created_at DESC LIMIT 1",
        row.id
      )
      const intake = JSON.parse(row.intake_json ?? '{}')
      const customer = db.get<any>('SELECT * FROM customers WHERE id = ?', row.customer_id)
      const noCharge = Boolean(payload?.noCharge)
      const credit = Boolean(payload?.credit)
      if (noCharge && credit) fail('No se puede combinar entrega sin cobro con entrega a crédito.')
      if (credit) {
        requireCap(session, 'authorizeCredit')
        if (!customer?.credit_enabled) {
          fail('El cliente no está autorizado para entrega a crédito.')
        }
        if (Number(orderPaidTotal(db, row.id)) >= Number(existingInvoice?.total_cents ?? 0) && existingInvoice) {
          fail('La OT ya está pagada; registra la entrega normal.')
        }
      }
      if (noCharge) {
        requireCap(session, 'authorizeNoCharge')
        if (existingInvoice) fail('La OT ya está facturada; anula la factura antes de entregar sin cobro.')
        if (Number(orderPaidTotal(db, row.id)) > 0) fail('No se puede entregar sin cobro una OT que ya tiene pagos registrados.')
      }
      const subtotalCents = existingInvoice
        ? Number(existingInvoice.subtotal_cents)
        : orderItemsTotal(db, row.id) || toCents(intake.estimate ?? 0)
      if (!existingInvoice && !noCharge && subtotalCents <= 0) {
        fail('No hay valores por cobrar. Agrega ítems, presupuesto o autoriza la entrega sin cobro.')
      }
      let discount: { type: 'percent' | 'amount'; value: number; source: string }
      let discountCents: number
      if (existingInvoice) {
        discount = {
          type: existingInvoice.discount_type === 'amount' ? 'amount' : 'percent',
          value: Number(existingInvoice.discount_value ?? 0),
          source: 'invoice'
        }
        discountCents = Number(existingInvoice.discount_cents ?? 0)
      } else {
        discount = noCharge
          ? { type: 'percent', value: 0, source: 'none' }
          : resolveSaleDiscount(customer, payload, session, subtotalCents)
        discountCents = noCharge
          ? 0
          : discountCentsFor(discount.type, discount.value, subtotalCents)
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
      }
      const totalCents = existingInvoice
        ? Number(existingInvoice.total_cents)
        : subtotalCents - discountCents
      const paidCents = Number(orderPaidTotal(db, row.id))
      const method = schema(payload?.method ?? 'Efectivo', z.enum(['Efectivo', 'Transferencia', 'Tarjeta', 'Mixto']))
      const exceptionReason = noCharge ? text(payload?.exceptionReason, 'Motivo de la excepción', 5, 500) : ''
      const balanceCents = Math.max(totalCents - paidCents, 0)
      const chargeCents = noCharge || credit ? 0 : balanceCents
      if (!noCharge && !credit && chargeCents > 0) {
        assertDigitalReceipt(db, method, payload?.receipt)
      }
      const receivedCents = numberValue(payload?.received ?? money(chargeCents), 'Efectivo recibido', { min: 0 })
      const received = toCents(receivedCents)
      if (!noCharge && !credit && method === 'Efectivo' && received < chargeCents) {
        fail('El efectivo recibido es menor al saldo por cobrar.')
      }
      const changeCents = method === 'Efectivo' && !noCharge && !credit ? Math.max(received - chargeCents, 0) : 0
      const nowIso = new Date().toISOString()
      if (!credit) requireCashSession(db)
      const paymentNumber = !noCharge && !credit && chargeCents > 0 ? db.paymentNumber() : ''
      const paymentId =
        paymentNumber
          ? `pay_${sha256(`${row.id}|${paymentNumber}|${Date.now()}`).slice(0, 20)}`
          : ''
      const incomeAccount =
        noCharge || credit || method === 'Efectivo' || method === 'Mixto'
          ? null
          : requireIncomeAccount(db)
      const preparedReceipt =
        paymentId ? prepareReceiptFromPayload(runtime, paymentId, payload?.receipt) : null
      let invoice: { id: string; number: string } | null = existingInvoice
        ? { id: existingInvoice.id, number: existingInvoice.number }
        : null
      try {
        db.tx(() => {
        if (!invoice) {
          invoice = createOrderInvoice(
            db,
            session,
            row,
            subtotalCents,
            totalCents,
            credit ? 'Crédito' : method,
            noCharge,
            exceptionReason,
            {
              type: discount.type as 'percent' | 'amount',
              value: discount.value,
              cents: discountCents
            }
          )
        }
        if (credit && invoice) {
          db.run(
            'UPDATE invoices SET credit_authorized = 1, credit_authorized_by = ?, credit_authorized_at = ? WHERE id = ?',
            displayUser(session).name,
            nowIso,
            invoice.id
          )
        }
        if (!noCharge && !credit) {
          db.run(
            'UPDATE invoices SET payment_method = ? WHERE id = ?',
            chargeCents > 0 ? method : 'Anticipos',
            invoice!.id
          )
        }
        if (!noCharge && !credit && chargeCents > 0) {
          db.run(
            `INSERT INTO payments
              (id, number, kind, order_id, invoice_id, method, amount_cents, received_cents, change_cents, reference,
               income_account_id, income_account_name, is_exception, created_by, created_by_name, created_by_role, created_at)
             VALUES (?, ?, 'saldo', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
            paymentId,
            paymentNumber,
            row.id,
            invoice!.id,
            method,
            chargeCents,
            received,
            changeCents,
            typeof payload?.reference === 'string' ? payload.reference.slice(0, 160) : null,
            incomeAccount?.id ?? null,
            incomeAccount?.name ?? null,
            session.userId,
            displayUser(session).name,
            session.actualRole,
            nowIso
          )
          insertPaymentReceipt(db, session, paymentId, preparedReceipt)
          if (incomeAccount) {
            recordAccountMovement(db, session, {
              accountId: incomeAccount.id,
              accountName: incomeAccount.name,
              type: 'ingreso',
              amountCents: chargeCents,
              description: `Cobro ${invoice!.number} · ${row.number} · ${row.customer_name} · ${method}`,
              referenceType: 'invoice',
              referenceId: invoice!.id,
              createdAt: nowIso
            })
          }
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
          noCharge ? 'Entregado sin cobro' : credit ? 'Entregado a crédito' : 'Entregado y facturado',
          noCharge
            ? `Entrega autorizada sin cobro. Motivo: ${exceptionReason}.`
            : credit
              ? `Entrega a crédito autorizada. Saldo pendiente: ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(money(balanceCents))}.`
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
          noCharge ? 'Entrega sin cobro' : credit ? 'Entrega a crédito' : 'Cobro y entrega de OT',
          'Orden de trabajo',
          noCharge
            ? `${row.number} · sin cobro · ${exceptionReason}`
            : credit
              ? `${row.number} · ${invoice!.number} · crédito autorizado · saldo ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(money(balanceCents))}`
              : `${row.number} · ${invoice!.number} · ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(money(totalCents))} · saldo ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(money(chargeCents))}`,
          row.id
        )
        })
      } catch (error) {
        if (preparedReceipt) {
          removePaymentReceiptFiles(runtime.userDataPath, [preparedReceipt.relativePath])
        }
        throw error
      }
      return orderDto(db, getOrderOrFail(db, row.id))
    }

    case 'pos.sell': {
      requireModuleAccess(session, 'pos')
      requireCap(session, 'settleOrder')
      const customerId = text(payload?.customerId, 'Cliente', 1, 80)
      const customer = db.get<any>('SELECT * FROM customers WHERE id = ?', customerId)
      if (!customer) fail('Selecciona un cliente válido')
      const lines = schema(
        payload?.lines ?? [],
        z.array(
          z.object({
            productId: z.string().min(1),
            quantity: z.number().positive(),
            note: z.string().max(500).optional()
          })
        )
      )
      const manualLines = schema(
        payload?.manualLines ?? [],
        z.array(
          z.object({
            description: z.string().trim().min(2).max(300),
            quantity: z.number().positive(),
            unitPrice: z.number().min(0.01),
            warrantyDays: z.number().min(0).max(3650).optional(),
            note: z.string().max(500).optional()
          })
        )
      )
      if (!lines.length && !manualLines.length) {
        fail('Agrega al menos un producto o servicio a la venta.')
      }
      const method = schema(payload?.method, z.enum(['Efectivo', 'Transferencia', 'Tarjeta', 'Mixto']))
      assertDigitalReceipt(db, method, payload?.receipt)
      const activePromotions = activePromotionRows(db)
      const preparedProducts = lines.map((line) => {
        const product = db.get<any>('SELECT * FROM products WHERE id = ? AND active = 1', line.productId)
        if (!product) fail('Uno de los productos ya no existe')
        if (!product.is_service && Number(product.stock) < line.quantity) {
          fail(`Stock insuficiente de ${product.name}. Disponible: ${product.stock}`)
        }
        const promotion = resolvePromotionForProductRow(db, product, activePromotions)
        const originalUnitPriceCents = Number(product.price_cents)
        const unitPriceCents = promotion ? toCents(promotion.price) : originalUnitPriceCents
        return {
          ...line,
          sourceKey: line.productId,
          manual: false,
          product,
          promotion,
          originalUnitPriceCents,
          unitPriceCents,
          promotionDiscountCents: Math.max(0, originalUnitPriceCents - unitPriceCents),
          note: product.is_service ? line.note?.trim().slice(0, 500) || null : null
        }
      })
      const manualPrepared = manualLines.map((line, index) => {
        const warrantyDays = Math.max(0, Math.round(Number(line.warrantyDays ?? 0)))
        const note = line.note?.trim().slice(0, 500) || null
        return {
          ...line,
          sourceKey: `manual_${index}_${sha256(`${line.description}|${line.unitPrice}|${index}`).slice(0, 8)}`,
          manual: true,
          product: {
            id: null,
            name: line.description,
            cost_cents: 0,
            is_service: 1,
            stock: 0
          },
          promotion: null,
          originalUnitPriceCents: toCents(line.unitPrice),
          unitPriceCents: toCents(line.unitPrice),
          promotionDiscountCents: 0,
          warrantyDays,
          note: warrantyDays > 0 ? `${note ? `${note} · ` : ''}Garantía: ${warrantyDays} días` : note
        }
      })
      const prepared = [...preparedProducts, ...manualPrepared]
      const hasPromotion = preparedProducts.some((line) => Boolean(line.promotion))
      if (hasPromotion) {
        const requestedValue =
          payload?.discountValue !== undefined
            ? Number(payload.discountValue)
            : Number(payload?.discountPercent ?? 0)
        if (requestedValue > 0) {
          fail(
            'Las promociones no se acumulan con descuento manual ni fidelidad. Retira el descuento para continuar.',
            'PROMOTION_NO_STACK'
          )
        }
      }
      const subtotalCents = prepared.reduce(
        (sum, line) => sum + line.unitPriceCents * line.quantity,
        0
      )
      const discount = hasPromotion
        ? ({ type: 'percent', value: 0, source: 'none' } as const)
        : resolveSaleDiscount(customer, payload, session, subtotalCents)
      const discountCents = discountCentsFor(discount.type, discount.value, subtotalCents)
      assertDiscountFloor(
        prepared.map((line) => ({
          name: line.product.name,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          unitCostCents: line.manual ? 0 : Number(line.product.cost_cents),
          isService: Boolean(line.manual || line.product.is_service),
          allowBelowCost: Boolean(line.promotion?.allowBelowCost)
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
      const paymentId = `pay_${sha256(`${invoiceId}|${Date.now()}`).slice(0, 20)}`
      const incomeAccount =
        method === 'Efectivo' || method === 'Mixto' ? null : requireIncomeAccount(db)
      const preparedReceipt = prepareReceiptFromPayload(runtime, paymentId, payload?.receipt)
      const nowIso = new Date().toISOString()
      try {
        db.tx(() => {
        db.run(
          `INSERT INTO invoices
            (id, number, type, customer_id, customer_name, subtotal_cents, discount_percent, discount_type, discount_value,
             discount_cents, total_cents, payment_method, status, created_by, created_by_name, created_by_role, created_at)
           VALUES (?, ?, 'venta', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'activa', ?, ?, ?, ?)`,
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
          displayUser(session).name,
          session.actualRole,
          nowIso
        )
        for (const line of prepared) {
          db.run(
            `INSERT INTO invoice_items
              (id, invoice_id, product_id, description, quantity, unit_price_cents, original_unit_price_cents,
               unit_cost_cents, line_total_cents, promotion_id, promotion_name, promotion_discount_cents,
               item_type, note)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            `ii_${sha256(`${invoiceId}|${line.sourceKey}`).slice(0, 20)}`,
            invoiceId,
            line.manual ? null : line.product.id,
            line.product.name,
            line.quantity,
            line.unitPriceCents,
            line.originalUnitPriceCents,
            line.manual ? 0 : line.product.cost_cents,
            Math.round(line.unitPriceCents * line.quantity),
            line.promotion?.id ?? null,
            line.promotion?.name ?? null,
            line.promotionDiscountCents,
            line.manual || line.product.is_service ? 'servicio' : 'producto',
            line.note
          )
          if (!line.manual && !line.product.is_service) {
            db.run('UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?', line.quantity, nowIso, line.product.id)
            db.run(
              `INSERT INTO stock_movements
                (id, product_id, type, quantity, unit_cost_cents, reason, reference_type, reference_id, user_id, user_name, created_at)
               VALUES (?, ?, 'venta', ?, ?, ?, 'invoice', ?, ?, ?, ?)`,
              `sm_${sha256(`${invoiceId}|${line.sourceKey}`).slice(0, 20)}`,
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
             income_account_id, income_account_name, is_exception, created_by, created_by_name, created_by_role, created_at)
           VALUES (?, ?, 'venta', NULL, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
          paymentId,
          db.paymentNumber(),
          invoiceId,
          method,
          totalCents,
          received,
          changeCents,
          typeof payload?.reference === 'string' ? payload.reference.slice(0, 160) : null,
          incomeAccount?.id ?? null,
          incomeAccount?.name ?? null,
          session.userId,
          displayUser(session).name,
          session.actualRole,
          nowIso
        )
        insertPaymentReceipt(db, session, paymentId, preparedReceipt)
        if (incomeAccount) {
          recordAccountMovement(db, session, {
            accountId: incomeAccount.id,
            accountName: incomeAccount.name,
            type: 'ingreso',
            amountCents: totalCents,
            description: `Venta ${number} · ${customer.name} · ${method}`,
            referenceType: 'invoice',
            referenceId: invoiceId,
            createdAt: nowIso
          })
        }
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
          `${number} · ${customer.name} · ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(money(totalCents))} · ${method}${incomeAccount ? ` · ${incomeAccount.name}` : ''}${preparedReceipt ? ' · comprobante' : ''}`,
          invoiceId
        )
        })
      } catch (error) {
        if (preparedReceipt) {
          removePaymentReceiptFiles(runtime.userDataPath, [preparedReceipt.relativePath])
        }
        throw error
      }
      const invoice = db.get<any>('SELECT * FROM invoices WHERE id = ?', invoiceId)
      scheduleCatalogPublish(db, runtime)
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
            productId: line.manual ? null : line.product.id,
            name: line.product.name,
            quantity: line.quantity,
            price: money(line.unitPriceCents),
            originalPrice: money(line.originalUnitPriceCents),
            promotionName: line.promotion?.name ?? null,
            promotionDiscount: money(line.promotionDiscountCents),
            lineTotal: money(line.unitPriceCents * line.quantity),
            note: line.note
          }))
        }
      }
    }

    case 'payments.requirements': {
      return {
        requireReceiptForDigital: Boolean(
          db.getSetting<any>('payments_config', DEFAULT_SETTINGS.payments)
            ?.requireReceiptForDigital
        )
      }
    }

    case 'payments.openReceipt': {
      if (
        !can(session.actualRole as any, 'settleOrder') &&
        !can(session.actualRole as any, 'createOrder') &&
        !can(session.actualRole as any, 'viewAudit')
      ) {
        fail('Tu rol no puede abrir comprobantes de pago.', 'FORBIDDEN')
      }
      const paymentId = text(payload?.paymentId, 'Pago', 1, 80)
      const receipt = db.get<any>('SELECT * FROM payment_receipts WHERE payment_id = ?', paymentId)
      if (!receipt) fail('Este pago no tiene comprobante.', 'NOT_FOUND')
      const absolute = resolvePaymentReceiptFile(runtime.userDataPath, String(receipt.path))
      if (!fs.existsSync(absolute)) fail('El archivo del comprobante no existe.', 'NOT_FOUND')
      const result = await shell.openPath(absolute)
      if (result) fail(`No se pudo abrir el comprobante: ${result}`)
      audit(
        db,
        session,
        'Apertura de comprobante de pago',
        'Pago',
        `${receipt.filename} · ${paymentId}`,
        paymentId
      )
      return { opened: true }
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
      const account = incomeAccountRow(db)
      const responsible = account?.responsible_user_id
        ? db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', account.responsible_user_id)
        : null
      const pending = pendingTransfersFor(db, session.userId).map((row) =>
        cashTransferDto(db, row, session)
      )
      const mine = db
        .all<any>(
          'SELECT * FROM cash_transfers WHERE requested_by = ? ORDER BY created_at DESC LIMIT 20',
          session.userId
        )
        .map((row) => cashTransferDto(db, row, session))
      const incomeAccount = account
        ? {
            id: account.id,
            name: account.name,
            responsibleUserId: account.responsible_user_id ?? null,
            responsibleUserName: responsible?.name ?? null
          }
        : null
      if (current) {
        const dto = cashSessionDto(db, current)
        return {
          current: dto,
          lastClosed: null,
          movements: dto.movements,
          pendingTransfers: pending,
          myTransfers: mine,
          incomeAccount
        }
      }
      const last = db.get<any>("SELECT * FROM cash_sessions WHERE status = 'cerrado' ORDER BY closed_at DESC LIMIT 1")
      return {
        current: null,
        lastClosed: last ? cashSessionDto(db, last) : null,
        movements: [],
        pendingTransfers: pending,
        myTransfers: mine,
        incomeAccount
      }
    }

    case 'cash.open': {
      requireModuleAccess(session, 'cash')
      requireCap(session, 'closeCash')
      if (currentCashSession(db)) fail('Ya hay un turno de caja abierto.')
      const lastClosed = db.get<{ carry_over_cents: number }>(
        "SELECT carry_over_cents FROM cash_sessions WHERE status = 'cerrado' ORDER BY closed_at DESC LIMIT 1"
      )
      const initial = numberValue(
        payload?.initialAmount ?? money(Number(lastClosed?.carry_over_cents ?? 0)),
        'Base inicial',
        { min: 0 }
      )
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
      const carryOverCents = toCents(
        numberValue(payload?.carryOver ?? money(countedCents), 'Efectivo para base', { min: 0 })
      )
      if (carryOverCents > countedCents) {
        fail('El efectivo para base no puede superar el efectivo contado.')
      }
      const nowIso = new Date().toISOString()
      db.tx(() => {
        db.run(
          `UPDATE cash_sessions
           SET closed_by = ?, closed_by_name = ?, closed_at = ?, expected_cents = ?, counted_cents = ?,
               difference_cents = ?, carry_over_cents = ?, status = 'cerrado', notes = ?
           WHERE id = ?`,
          session.userId,
          displayUser(session).name,
          nowIso,
          expected,
          countedCents,
          countedCents - expected,
          carryOverCents,
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

    case 'cash.transferRequest': {
      requireModuleAccess(session, 'cash')
      requireCap(session, 'closeCash')
      const amount = numberValue(payload?.amount, 'Valor del traslado', { min: 0.01 })
      const amountCents = toCents(amount)
      const notes =
        typeof payload?.notes === 'string' && payload.notes.trim()
          ? payload.notes.trim().slice(0, 500)
          : null
      const current = requireCashSession(db)
      const account = incomeAccountRow(db)
      if (!account) {
        fail('Configura y activa la cuenta de ingresos antes de trasladar efectivo.')
      }
      const responsible = account.responsible_user_id
        ? db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', account.responsible_user_id)
        : null
      const id = `ctr_${sha256(`${current.id}|${amountCents}|${Date.now()}`).slice(0, 20)}`
      const nowIso = new Date().toISOString()
      const requestedBy = session.userId
      const requestedByName = displayUser(session).name
      const autoApprove = account.responsible_user_id === requestedBy
      db.tx(() => {
        db.run(
          `INSERT INTO cash_transfers
            (id, cash_session_id, account_id, requested_cents, approved_cents, status,
             requested_by, requested_by_name, approved_by, approved_by_name, approved_at,
             rejection_reason, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, 'pendiente', ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?)`,
          id,
          current.id,
          account.id,
          amountCents,
          requestedBy,
          requestedByName,
          notes,
          nowIso,
          nowIso
        )
        if (autoApprove) {
          const transfer = db.get<any>('SELECT * FROM cash_transfers WHERE id = ?', id)
          executeCashTransfer(db, session, transfer, amountCents, account)
        }
        audit(
          db,
          session,
          autoApprove ? 'Traslado de efectivo a banco' : 'Solicitud de traslado a banco',
          'Caja',
          `${account.name} · ${money(amountCents)} · ${
            autoApprove ? 'aprobado automáticamente' : `pendiente de ${responsible?.name ?? 'un administrador'}`
          }`,
          id
        )
      })
      const transfer = db.get<any>('SELECT * FROM cash_transfers WHERE id = ?', id)
      return {
        transfer: cashTransferDto(db, transfer, session),
        pendingTransfers: pendingTransfersFor(db, session.userId).map((row) =>
          cashTransferDto(db, row, session)
        )
      }
    }

    case 'cash.transferApprove': {
      requireModuleAccess(session, 'cash')
      requireCap(session, 'closeCash')
      const id = text(payload?.id, 'Traslado', 1, 80)
      const transfer = db.get<any>('SELECT * FROM cash_transfers WHERE id = ?', id)
      if (!transfer) fail('Traslado no encontrado', 'NOT_FOUND')
      if (transfer.status !== 'pendiente') fail('El traslado ya fue procesado.')
      const account = db.get<any>('SELECT * FROM dictionary_nodes WHERE id = ?', transfer.account_id)
      if (!account || account.responsible_user_id !== session.userId) {
        fail('Solo el administrador vinculado a la cuenta puede aprobar este traslado.', 'FORBIDDEN')
      }
      const amount = numberValue(
        payload?.amount ?? money(Number(transfer.requested_cents)),
        'Valor aprobado',
        { min: 0.01 }
      )
      const amountCents = toCents(amount)
      db.tx(() => {
        executeCashTransfer(db, session, transfer, amountCents, account)
        audit(
          db,
          session,
          'Aprobación de traslado a banco',
          'Caja',
          `${account.name} · solicitado ${money(Number(transfer.requested_cents))} · aprobado ${money(amountCents)}`,
          id
        )
      })
      return {
        transfer: cashTransferDto(
          db,
          db.get<any>('SELECT * FROM cash_transfers WHERE id = ?', id),
          session
        )
      }
    }

    case 'cash.transferReject': {
      requireModuleAccess(session, 'cash')
      requireCap(session, 'closeCash')
      const id = text(payload?.id, 'Traslado', 1, 80)
      const transfer = db.get<any>('SELECT * FROM cash_transfers WHERE id = ?', id)
      if (!transfer) fail('Traslado no encontrado', 'NOT_FOUND')
      if (transfer.status !== 'pendiente') fail('El traslado ya fue procesado.')
      const account = db.get<any>('SELECT * FROM dictionary_nodes WHERE id = ?', transfer.account_id)
      if (!account || account.responsible_user_id !== session.userId) {
        fail('Solo el administrador vinculado a la cuenta puede rechazar este traslado.', 'FORBIDDEN')
      }
      const reason = text(payload?.reason, 'Motivo del rechazo', 3, 500)
      const nowIso = new Date().toISOString()
      db.tx(() => {
        db.run(
          `UPDATE cash_transfers
           SET status = 'rechazado', rejection_reason = ?, approved_by = ?, approved_by_name = ?,
               approved_at = ?, updated_at = ?
           WHERE id = ?`,
          reason,
          session.userId,
          displayUser(session).name,
          nowIso,
          nowIso,
          id
        )
        audit(
          db,
          session,
          'Rechazo de traslado a banco',
          'Caja',
          `${account.name} · ${money(Number(transfer.requested_cents))} · ${reason}`,
          id
        )
      })
      return {
        transfer: cashTransferDto(
          db,
          db.get<any>('SELECT * FROM cash_transfers WHERE id = ?', id),
          session
        )
      }
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

    case 'ai.listModels': {
      requireAiModelManager(session)
      const config = db.getSetting<any>('ai_config', DEFAULT_SETTINGS.ai)
      if ((config.provider ?? 'gemini') !== 'gemini') fail('Solo Gemini está disponible en esta versión.')
      const apiKey = getStoredAiKey(db)
      if (!apiKey) fail('Configura la clave de Gemini antes de consultar los modelos.')
      const result = await listGeminiModels({ apiKey })
      if (!result.models.length) {
        fail('Gemini no devolvió modelos compatibles con el análisis de facturas.')
      }
      db.setSetting('ai_config', {
        ...config,
        modelCatalog: result.models,
        catalogUpdatedAt: result.fetchedAt
      })
      audit(
        db,
        session,
        'Catálogo de modelos IA actualizado',
        'Configuración',
        `${result.models.length} modelos compatibles disponibles.`
      )
      return result
    }

    case 'ai.setModel': {
      requireAiModelManager(session)
      const config = db.getSetting<any>('ai_config', DEFAULT_SETTINGS.ai)
      const model = normalizeAiModel(payload?.model)
      if (model !== config.model) {
        const fallbackModels = Array.isArray(config.fallbackModels)
          ? config.fallbackModels
              .filter((item: unknown): item is string => typeof item === 'string')
              .map((item: string) => item.replace(/^models\//, '').trim())
              .filter((item: string) => Boolean(item) && item !== model)
          : []
        db.setSetting('ai_config', {
          ...config,
          model,
          fallbackModels,
          autoFallback: fallbackModels.length ? Boolean(config.autoFallback) : false
        })
        audit(db, session, 'Cambio de modelo IA', 'Configuración', `Modelo activo: ${model}`)
      }
      clearAiModelCooldown(model)
      return { model }
    }

    case 'ai.testConnection': {
      requireModuleAccess(session, 'settings')
      requireCap(session, 'configureAI')
      const config = db.getSetting<any>('ai_config', DEFAULT_SETTINGS.ai)
      if ((config.provider ?? 'gemini') !== 'gemini') fail('Solo Gemini está disponible en esta versión.')
      const apiKey =
        typeof payload?.apiKey === 'string' && payload.apiKey.trim()
          ? payload.apiKey.trim()
          : getStoredAiKey(db)
      if (!apiKey) fail('Configura la clave de Gemini antes de probar la conexión.')
      const model = text(payload?.model ?? config.model, 'Modelo de IA', 1, 120)
      const result = await testGeminiConnection({ apiKey, model })
      audit(db, session, 'Prueba de conexión IA', 'Configuración', `Gemini · ${model} · OK · ${result.latencyMs} ms`)
      return result
    }

    case 'purchases.checkDuplicate': {
      requireModuleAccess(session, 'purchases')
      requireCap(session, 'createPurchase')
      const supplierId = typeof payload?.supplierId === 'string' ? payload.supplierId.trim() : ''
      const number = typeof payload?.number === 'string' ? payload.number.trim() : ''
      if (!supplierId || !number) {
        return { duplicate: false, purchaseId: null, number, date: null }
      }
      const existing = db.get<any>(
        'SELECT id, purchase_date FROM purchases WHERE supplier_id = ? AND number = ? LIMIT 1',
        supplierId,
        number
      )
      return {
        duplicate: Boolean(existing),
        purchaseId: existing?.id ?? null,
        number,
        date: existing?.purchase_date ?? null
      }
    }

    case 'purchases.scanInvoice': {
      requireModuleAccess(session, 'purchases')
      requireCap(session, 'useAI')
      requireCap(session, 'createPurchase')
      const config = db.getSetting<any>('ai_config', DEFAULT_SETTINGS.ai)
      if (!config.enabled) fail('Activa el escaneo de facturas en Configuración → IA.')
      if ((config.provider ?? 'gemini') !== 'gemini') fail('Solo Gemini está disponible en esta versión.')
      const apiKey = getStoredAiKey(db)
      if (!apiKey) fail('Configura la clave de Gemini antes de escanear facturas.')
      const file = payload?.file && typeof payload.file === 'object' ? payload.file : {}
      const mimeType = String(file.mimeType ?? '').toLowerCase()
      if (!['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(mimeType)) {
        fail('La factura debe ser una imagen PNG/JPEG/WebP o un PDF.')
      }
      const dataUrl = String(file.dataUrl ?? '')
      const base64 = dataUrl.startsWith('data:') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl
      if (!base64) fail('No se recibió la imagen o el PDF de la factura.')
      const bytes = Buffer.from(base64, 'base64')
      if (!bytes.length) fail('El archivo de la factura está vacío.')
      if (bytes.length > 8 * 1024 * 1024) fail('La factura supera el límite de 8 MB.')
      const chain = aiModelChain(config)
      if (!chain.length) fail('Configura un modelo de IA antes de escanear facturas.')
      const requestedModel = chain[0]
      const configuredChain = config.autoFallback ? chain : [requestedModel]
      const readyModels = configuredChain.filter((model) => aiModelCooldownRemaining(model) === 0)
      const modelsToTry = readyModels.length ? readyModels : configuredChain
      const attempts: Array<{
        model: string
        code: string
        message: string
        retryAfterSeconds?: number
      }> = []
      let extraction: InvoiceExtraction | null = null
      let modelUsed = requestedModel
      let lastError: RpcError | null = null

      for (const [index, model] of modelsToTry.entries()) {
        try {
          extraction = await scanInvoice({
            apiKey,
            model,
            mimeType,
            dataBase64: base64
          })
          modelUsed = model
          clearAiModelCooldown(model)
          break
        } catch (error) {
          const rpcError =
            error instanceof RpcError
              ? error
              : new RpcError(
                  error instanceof Error ? error.message : 'No se pudo analizar la factura.',
                  'AI_ERROR'
                )
          const retryAfterSeconds = Number(rpcError.details?.retryAfterSeconds)
          attempts.push({
            model,
            code: rpcError.code,
            message: rpcError.message,
            ...(Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
              ? { retryAfterSeconds }
              : {})
          })
          lastError = rpcError
          if (rpcError.code === 'AI_QUOTA') {
            cooldownAiModel(
              model,
              Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
                ? retryAfterSeconds
                : 60
            )
          }
          const hasNext = index < modelsToTry.length - 1
          if (!hasNext || !AI_RETRYABLE_CODES.has(rpcError.code)) break
        }
      }

      if (!extraction) {
        if (attempts.length > 1) {
          const summary = attempts
            .map((attempt) => `${attempt.model}: ${attempt.message}`)
            .join(' ')
          const retryAfterSeconds = Number(lastError?.details?.retryAfterSeconds)
          throw new RpcError(
            `Ningún modelo pudo analizar la factura. ${summary}`,
            'AI_ALL_MODELS_FAILED',
            {
              attempts,
              ...(Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
                ? { retryAfterSeconds }
                : {})
            }
          )
        }
        throw lastError ?? new RpcError('No se pudo analizar la factura.', 'AI_ERROR')
      }

      const draft = buildInvoiceDraft(
        db,
        extraction,
        {
          name: String(file.name ?? 'factura').slice(0, 160),
          mimeType,
          size: bytes.length
        },
        {
          model: modelUsed,
          requestedModel,
          attempts
        }
      )
      const fallbackDetail =
        modelUsed !== requestedModel ? ` · respaldo de ${requestedModel}` : ''
      audit(
        db,
        session,
        'Escaneo de factura con IA',
        'Compra',
        `${draft.supplier.name || 'Proveedor sin identificar'} · ${draft.invoice.number || 'Sin número'} · ${draft.lines.length} líneas · ${modelUsed}${fallbackDetail} · ${draft.ai.extractionHash.slice(0, 12)}`,
        draft.duplicatePurchaseId ?? undefined
      )
      return draft
    }

    case 'purchases.create': {
      requireModuleAccess(session, 'purchases')
      requireCap(session, 'createPurchase')
      const supplierId = text(payload?.supplierId, 'Proveedor', 1, 80)
      const supplier = db.get<any>('SELECT * FROM suppliers WHERE id = ? AND active = 1', supplierId)
      if (!supplier) fail('Proveedor no encontrado')
      const purchaseNumber = text(payload?.number, 'Número de factura', 1, 80)
      const duplicatePurchase = db.get<any>(
        'SELECT id FROM purchases WHERE supplier_id = ? AND number = ?',
        supplierId,
        purchaseNumber
      )
      if (duplicatePurchase) fail('Ya existe una compra de este proveedor con ese número.', 'DUPLICATE')
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
      const dueDate =
        typeof payload?.dueDate === 'string' && payload.dueDate.trim()
          ? isoDate(payload.dueDate, 'Fecha de vencimiento')
          : null
      const paymentAccount = resolvePurchaseAccount(
        db,
        payload?.paymentAccountId,
        payload?.paymentMethod
      )
      const payment = purchasePaymentSummary({
        totalCents,
        paymentCondition: payload?.paymentCondition,
        initialPayment: payload?.initialPayment,
        paymentMethod: paymentAccount.channel
      })
      if (payload?.paymentCondition === 'credito' && payment.paidCents === 0) {
        payment.paymentMethod = 'Crédito'
      }
      const paidAccount = payment.paidCents > 0 ? paymentAccount : null
      const id = `pur_${sha256(`${purchaseNumber}|${Date.now()}`).slice(0, 20)}`
      const nowIso = new Date().toISOString()
      db.tx(() => {
        db.run(
          `INSERT INTO purchases
            (id, number, supplier_id, purchase_date, item_count, subtotal_cents, iva_cents, total_cents,
             discount_cents, adjustment_cents, status, payment_status, payment_method,
             payment_account, payment_account_id, paid_cents, balance_cents, due_date, notes,
             ai_metadata_json, created_by, created_by_name, created_by_role, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
          id,
          purchaseNumber,
          supplierId,
          purchaseDate,
          itemsInput.length || 1,
          subtotalCents,
          ivaCents,
          totalCents,
          status,
          payment.paymentStatus,
          payment.paymentMethod,
          paidAccount?.name ?? null,
          paidAccount?.id ?? null,
          payment.paidCents,
          payment.balanceCents,
          dueDate,
          typeof payload?.notes === 'string' ? payload.notes.slice(0, 1000) : null,
          session.userId,
          displayUser(session).name,
          session.actualRole,
          nowIso
        )
        if (!itemsInput.length) {
          db.run(
            `INSERT INTO purchase_items
              (id, purchase_id, product_id, description, quantity, unit_price_cents, iva_rate, iva_cents,
               supplier_sku, serial_text)
             VALUES (?, ?, NULL, ?, 1, ?, 19, ?, '', '')`,
            `puri_${Date.now()}`,
            id,
            'Compra registrada según factura de proveedor',
            subtotalCents,
            ivaCents
          )
        } else {
          for (const [index, item] of itemsInput.entries()) {
            const product = item?.productId ? db.get<any>('SELECT * FROM products WHERE id = ?', item.productId) : null
            const quantity = numberValue(item?.quantity ?? 1, 'Cantidad', { min: 0.01 })
            const unitPrice = item?.unitPrice !== undefined ? numberValue(item.unitPrice, 'Valor unitario', { min: 0 }) : subtotal / Math.max(itemsInput.length, 1)
            const unitPriceCents = toCents(unitPrice)
            const lineIvaCents = Math.round(unitPriceCents * quantity * 0.19)
            const supplierSku = String(item?.supplierSku ?? '').trim().slice(0, 60)
            const serialText = String(item?.serialText ?? '').trim().slice(0, 1000)
            db.run(
              `INSERT INTO purchase_items
                (id, purchase_id, product_id, description, quantity, unit_price_cents, iva_rate, iva_cents,
                 supplier_sku, serial_text)
               VALUES (?, ?, ?, ?, ?, ?, 19, ?, ?, ?)`,
              `puri_${index}_${Date.now()}`,
              id,
              product?.id ?? null,
              product?.name ?? String(item?.description ?? 'Compra de mercancía').slice(0, 240),
              quantity,
              unitPriceCents,
              lineIvaCents,
              supplierSku,
              serialText
            )
            if (product && supplierSku) {
              db.run(
                `UPDATE products SET supplier_sku = ?
                 WHERE id = ? AND TRIM(COALESCE(supplier_sku, '')) = ''`,
                supplierSku,
                product.id
              )
            }
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
        if (payment.paidCents > 0) {
          recordSupplierPayment(db, session, {
            purchaseId: id,
            purchaseNumber,
            amountCents: payment.paidCents,
            method: payment.paymentMethod,
            paymentAccount: paidAccount,
            paidAt: nowIso,
            notes:
              payment.paymentStatus === 'parcial'
                ? 'Abono inicial de la compra'
                : 'Pago de la compra',
            registerCash: true
          })
        }
        audit(
          db,
          session,
          'Registro de compra',
          'Compra',
          `${purchaseNumber} · ${supplier.name} · ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(money(totalCents))} · IVA ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(money(ivaCents))} · ${payment.paymentStatus} · saldo ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(money(payment.balanceCents))}`,
          id
        )
      })
      scheduleCatalogPublish(db, runtime)
      return purchaseDto(db, db.get<any>('SELECT * FROM purchases WHERE id = ?', id))
    }

    case 'purchases.createFromReview': {
      requireModuleAccess(session, 'purchases')
      requireCap(session, 'createPurchase')
      const supplierId = text(payload?.supplierId, 'Proveedor', 1, 80)
      const supplier = db.get<any>('SELECT * FROM suppliers WHERE id = ? AND active = 1', supplierId)
      if (!supplier) fail('Proveedor no encontrado')
      const purchaseNumber = text(payload?.number, 'Número de factura', 1, 80)
      const purchaseDate = isoDate(payload?.date, 'Fecha de compra')
      const linesInput = Array.isArray(payload?.lines) ? payload.lines : []
      if (!linesInput.length) fail('Agrega al menos una línea a la compra.')
      const discount = numberValue(payload?.discount ?? 0, 'Descuento', { min: 0 })
      const realTotal = numberValue(payload?.realTotal, 'Total real de la factura', { min: 0.01 })
      const updatePrices = Boolean(payload?.updatePrices)
      const duplicateConfirmed = Boolean(payload?.duplicateConfirmed)
      const dueDate =
        typeof payload?.dueDate === 'string' && payload.dueDate.trim()
          ? isoDate(payload.dueDate, 'Fecha de vencimiento')
          : null
      const duplicate = db.get<any>(
        'SELECT id FROM purchases WHERE supplier_id = ? AND number = ? LIMIT 1',
        supplierId,
        purchaseNumber
      )
      if (duplicate && !duplicateConfirmed) {
        fail('Ya existe una compra de este proveedor con ese número. Confirma el duplicado para continuar.', 'DUPLICATE')
      }
      const newSkus = new Set<string>()
      const prepared = linesInput.map((item: any, index: number) => {
        const description = text(item?.description, `Descripción de línea ${index + 1}`, 1, 240)
        const quantity = numberValue(item?.quantity, `Cantidad de línea ${index + 1}`, { min: 0.01 })
        const unitCost = numberValue(item?.unitCost, `Costo de línea ${index + 1}`, { min: 0 })
        const ivaRate = numberValue(item?.ivaRate ?? 19, `IVA de línea ${index + 1}`, {
          min: 0,
          max: 100
        })
        const productId =
          typeof item?.productId === 'string' && item.productId ? item.productId : null
        const newProduct =
          item?.newProduct && typeof item.newProduct === 'object' ? { ...item.newProduct } : null
        const supplierSku = String(item?.supplierSku ?? newProduct?.supplierSku ?? '')
          .trim()
          .slice(0, 60)
        const serialText = String(item?.serialText ?? '').trim().slice(0, 1000)
        if (productId && newProduct) {
          fail(`La línea ${index + 1} no puede tener producto existente y producto nuevo a la vez.`)
        }
        if (productId) {
          const product = db.get<any>('SELECT id FROM products WHERE id = ? AND active = 1', productId)
          if (!product) fail(`El producto de la línea ${index + 1} no está activo.`)
        }
        if (newProduct) {
          const sku = text(newProduct.sku, `SKU de línea ${index + 1}`, 2, 60)
          if (newSkus.has(sku.toLowerCase())) {
            fail(`El SKU ${sku} está repetido en la revisión.`)
          }
          newSkus.add(sku.toLowerCase())
          if (db.get<any>('SELECT id FROM products WHERE sku = ?', sku)) {
            fail(`Ya existe un producto con el SKU ${sku}.`, 'DUPLICATE')
          }
          text(newProduct.name, `Nombre de línea ${index + 1}`, 2, 160)
          numberValue(newProduct.price, `Precio de venta de línea ${index + 1}`, { min: 0.01 })
          newProduct.supplierSku = supplierSku
        }
        const unitCostCents = toCents(unitCost)
        const baseCents = Math.round(unitCostCents * quantity)
        const ivaCents = Math.round((baseCents * ivaRate) / 100)
        const sellPrice =
          item?.sellPrice !== undefined && item.sellPrice !== null && item.sellPrice !== ''
            ? numberValue(item.sellPrice, `Precio de venta de línea ${index + 1}`, { min: 0.01 })
            : null
        return {
          description,
          quantity,
          unitCostCents,
          ivaRate,
          ivaCents,
          baseCents,
          productId,
          newProduct,
          supplierSku,
          serialText,
          sellPrice,
          updatePrice: Boolean(item?.updatePrice)
        }
      })
      const subtotalCents = prepared.reduce((sum, item) => sum + item.baseCents, 0)
      const ivaCents = prepared.reduce((sum, item) => sum + item.ivaCents, 0)
      const baseDiscountCents = Math.min(subtotalCents + ivaCents, Math.max(0, toCents(discount)))
      const calculatedTotalCents = subtotalCents + ivaCents - baseDiscountCents
      const realTotalCents = toCents(realTotal)
      const differenceCents = realTotalCents - calculatedTotalCents
      const discountCents =
        differenceCents < 0 ? baseDiscountCents + Math.abs(differenceCents) : baseDiscountCents
      const adjustmentCents = differenceCents > 0 ? differenceCents : 0
      if (discountCents > subtotalCents + ivaCents) {
        fail('El descuento supera el valor de la factura.')
      }
      const aiMetadata =
        payload?.aiMetadata && typeof payload.aiMetadata === 'object'
          ? JSON.stringify(payload.aiMetadata)
          : null
      if (aiMetadata && aiMetadata.length > 30000) {
        fail('Los metadatos de la IA son demasiado grandes.')
      }
      const paymentAccount = resolvePurchaseAccount(
        db,
        payload?.paymentAccountId,
        payload?.paymentMethod
      )
      const payment = purchasePaymentSummary({
        totalCents: realTotalCents,
        paymentCondition: payload?.paymentCondition,
        initialPayment: payload?.initialPayment,
        paymentMethod: paymentAccount.channel
      })
      if (payload?.paymentCondition === 'credito' && payment.paidCents === 0) {
        payment.paymentMethod = 'Crédito'
      }
      const paidAccount = payment.paidCents > 0 ? paymentAccount : null
      const id = `pur_${sha256(`${supplierId}|${purchaseNumber}|${Date.now()}`).slice(0, 20)}`
      const nowIso = new Date().toISOString()
      db.tx(() => {
        db.run(
          `INSERT INTO purchases
            (id, number, supplier_id, purchase_date, item_count, subtotal_cents, iva_cents, total_cents,
             discount_cents, adjustment_cents, status, payment_status, payment_method,
             payment_account, payment_account_id, paid_cents, balance_cents, due_date, notes,
             ai_metadata_json, created_by, created_by_name, created_by_role, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'recibida', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          purchaseNumber,
          supplierId,
          purchaseDate,
          prepared.length,
          subtotalCents,
          ivaCents,
          realTotalCents,
          discountCents,
          adjustmentCents,
          payment.paymentStatus,
          payment.paymentMethod,
          paidAccount?.name ?? null,
          paidAccount?.id ?? null,
          payment.paidCents,
          payment.balanceCents,
          dueDate,
          typeof payload?.notes === 'string' ? payload.notes.slice(0, 1000) : null,
          aiMetadata,
          session.userId,
          displayUser(session).name,
          session.actualRole,
          nowIso
        )
        for (const [index, item] of prepared.entries()) {
          let productId = item.productId
          if (!productId && item.newProduct) {
            productId = createProductFromPurchaseReview(db, item.newProduct, item.unitCostCents, nowIso)
          }
          db.run(
            `INSERT INTO purchase_items
              (id, purchase_id, product_id, description, quantity, unit_price_cents, iva_rate, iva_cents,
               supplier_sku, serial_text)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            `puri_${index}_${Date.now()}`,
            id,
            productId,
            item.description,
            item.quantity,
            item.unitCostCents,
            item.ivaRate,
            item.ivaCents,
            item.supplierSku,
            item.serialText
          )
          if (productId) {
            if (item.supplierSku) {
              db.run(
                `UPDATE products SET supplier_sku = ?
                 WHERE id = ? AND TRIM(COALESCE(supplier_sku, '')) = ''`,
                item.supplierSku,
                productId
              )
            }
            db.run(
              'UPDATE products SET stock = stock + ?, cost_cents = ?, updated_at = ? WHERE id = ?',
              item.quantity,
              item.unitCostCents,
              nowIso,
              productId
            )
            db.run(
              `INSERT INTO stock_movements
                (id, product_id, type, quantity, unit_cost_cents, reason, reference_type, reference_id, user_id, user_name, created_at)
               VALUES (?, ?, 'compra', ?, ?, ?, 'purchase', ?, ?, ?, ?)`,
              `sm_${Date.now()}_${index}`,
              productId,
              Math.abs(item.quantity),
              item.unitCostCents,
              `Compra ${purchaseNumber} · IA`,
              id,
              session.userId,
              displayUser(session).name,
              nowIso
            )
            if (updatePrices && item.updatePrice && item.sellPrice) {
              db.run(
                'UPDATE products SET price_cents = ?, updated_at = ? WHERE id = ?',
                toCents(item.sellPrice),
                nowIso,
                productId
              )
            }
          }
        }
        if (payment.paidCents > 0) {
          recordSupplierPayment(db, session, {
            purchaseId: id,
            purchaseNumber,
            amountCents: payment.paidCents,
            method: payment.paymentMethod,
            paymentAccount: paidAccount,
            paidAt: nowIso,
            notes:
              payment.paymentStatus === 'parcial'
                ? 'Abono inicial de la compra'
                : 'Pago de la compra',
            registerCash: true
          })
        }
        audit(
          db,
          session,
          'Registro de compra desde IA',
          'Compra',
          `${purchaseNumber} · ${supplier.name} · ${prepared.length} líneas · total ${money(realTotalCents)} · ${payment.paymentStatus} · saldo ${money(payment.balanceCents)} · ajuste ${money(adjustmentCents)}`,
          id
        )
      })
      scheduleCatalogPublish(db, runtime)
      return purchaseDto(db, db.get<any>('SELECT * FROM purchases WHERE id = ?', id))
    }

    case 'purchases.addPayment': {
      requireModuleAccess(session, 'purchases')
      requireCap(session, 'createPurchase')
      const purchaseId = text(payload?.purchaseId, 'Compra', 1, 80)
      const purchase = db.get<any>('SELECT * FROM purchases WHERE id = ?', purchaseId)
      if (!purchase) fail('Compra no encontrada', 'NOT_FOUND')
      const balanceCents = Number(purchase.balance_cents ?? 0)
      if (balanceCents <= 0) fail('La compra no tiene saldo pendiente.')
      const amountCents = toCents(numberValue(payload?.amount, 'Valor del abono', { min: 0.01 }))
      if (amountCents > balanceCents) {
        fail(`El abono supera el saldo pendiente (${money(balanceCents)}).`)
      }
      const paymentAccount = resolvePurchaseAccount(
        db,
        payload?.paymentAccountId,
        payload?.method
      )
      const method = paymentAccount.channel
      if (method === 'Crédito') fail('Selecciona un medio de pago para el abono.')
      const paidAt =
        typeof payload?.date === 'string' && payload.date.trim()
          ? isoDate(payload.date, 'Fecha del abono')
          : new Date().toISOString()
      const notes =
        typeof payload?.notes === 'string' && payload.notes.trim()
          ? payload.notes.trim().slice(0, 1000)
          : null
      const nextPaid = Number(purchase.paid_cents ?? 0) + amountCents
      const nextBalance = Math.max(0, balanceCents - amountCents)
      const nextStatus = nextBalance <= 0 ? 'pagada' : nextPaid > 0 ? 'parcial' : 'pendiente'
      const supplierRow = db.get<{ name: string }>(
        'SELECT name FROM suppliers WHERE id = ?',
        purchase.supplier_id
      )
      db.tx(() => {
        recordSupplierPayment(db, session, {
          purchaseId,
          purchaseNumber: String(purchase.number ?? ''),
          amountCents,
          method,
          paymentAccount,
          paidAt,
          notes,
          registerCash: true
        })
        db.run(
          `UPDATE purchases
           SET paid_cents = ?, balance_cents = ?, payment_status = ?,
               payment_method = CASE WHEN ? <= 0 THEN ? ELSE payment_method END,
               payment_account = COALESCE(?, payment_account),
               payment_account_id = COALESCE(?, payment_account_id)
           WHERE id = ?`,
          nextPaid,
          nextBalance,
          nextStatus,
          nextBalance,
          method,
          paymentAccount.id ? paymentAccount.name : null,
          paymentAccount.id,
          purchaseId
        )
        audit(
          db,
          session,
          'Abono a compra',
          'Compra',
          `${purchase.number} · ${supplierRow?.name ?? 'Proveedor'} · abono ${money(amountCents)} · saldo ${money(nextBalance)} · ${method}`,
          purchaseId
        )
      })
      return purchaseDto(db, db.get<any>('SELECT * FROM purchases WHERE id = ?', purchaseId))
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
      requireCap(session, 'managePermissions')
      const role = schema(payload?.role, z.enum(['admin', 'tecnico', 'cajero']))
      const items = schema(
        payload?.permissions,
        z.array(z.object({ capability: z.string().min(1), allowed: z.boolean() }))
      )
      const moduleItems = schema(
        payload?.modules ?? [],
        z.array(z.object({ module: z.string().min(1), allowed: z.boolean() }))
      )
      const actorCapabilities = new Set(
        effectiveCapabilities(db, session.userId, session.role, session.role !== session.actualRole)
      )
      const actorModules = new Set(
        effectiveModules(db, session.userId, session.role, session.role !== session.actualRole)
      )
      const now = new Date().toISOString()
      db.tx(() => {
        for (const item of items) {
          const capability = item.capability as BackendCapability
          if (!ALL_CAPABILITIES.includes(capability)) fail(`Permiso desconocido: ${capability}`)
          if (item.allowed && ROOT_ONLY_CAPABILITIES.includes(capability)) {
            fail(`${capability} es exclusivo del propietario y no puede delegarse al rol ${role}.`, 'FORBIDDEN')
          }
          if (item.allowed && capability === 'manageAdmins' && role !== 'admin') {
            fail('La gestión de administradores solo puede asignarse al rol Administrador.', 'FORBIDDEN')
          }
          if (session.actualRole !== 'superadmin') {
            if (item.allowed && !actorCapabilities.has(capability)) {
              fail('No puedes conceder un permiso que tu propia cuenta no tiene.', 'FORBIDDEN')
            }
            if (role === 'admin' && capability === 'managePermissions' && !item.allowed) {
              fail('Solo el propietario puede retirar la configuración de permisos al rol Administrador.', 'FORBIDDEN')
            }
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
        for (const item of moduleItems) {
          const module = item.module as ModuleKey
          if (!ALL_MODULES.includes(module)) fail(`Módulo desconocido: ${module}`)
          if (item.allowed && ROOT_ONLY_MODULES.includes(module)) {
            fail(`El módulo ${module} es exclusivo del propietario.`, 'FORBIDDEN')
          }
          if (session.actualRole !== 'superadmin') {
            if (item.allowed && !actorModules.has(module)) {
              fail('No puedes conceder un módulo que tu propia cuenta no tiene.', 'FORBIDDEN')
            }
            if (role === 'admin' && module === 'settings' && !item.allowed) {
              fail('Solo el propietario puede retirar Configuración al rol Administrador.', 'FORBIDDEN')
            }
          }
          db.run(
            `INSERT INTO role_modules (role, module, allowed, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(role, module) DO UPDATE SET allowed = excluded.allowed, updated_at = excluded.updated_at`,
            role,
            module,
            item.allowed ? 1 : 0,
            now
          )
        }
        audit(
          db,
          session,
          'Actualización de matriz de permisos',
          'Configuración',
          `Rol ${roleLabels[role]} · ${items.length} permisos y ${moduleItems.length} módulos revisados.`
        )
      })
      return settingsData(db, runtime)
    }

    case 'dictionaries.list': {
      const canSeeAccounts =
        session.actualRole === 'admin' || session.actualRole === 'superadmin'
      return db
        .all<any>('SELECT * FROM dictionary_nodes ORDER BY type ASC, parent_id ASC, sort_order ASC, name ASC')
        .filter(
          (row) =>
            canSeeAccounts ||
            (row.type !== 'purchase_payment_account' && row.type !== 'income_account')
        )
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
      const channel =
        type === 'income_account'
          ? 'Digital'
          : type === 'purchase_payment_account'
            ? typeof payload?.channel === 'string' && payload.channel.trim()
              ? payload.channel.trim()
              : 'Transferencia'
            : null
      const responsibleUserId =
        type === 'income_account' && typeof payload?.responsibleUserId === 'string' && payload.responsibleUserId
          ? text(payload.responsibleUserId, 'Administrador responsable', 1, 80)
          : null
      const linkedIncomeAccountId =
        type === 'purchase_payment_account' &&
        typeof payload?.linkedIncomeAccountId === 'string' &&
        payload.linkedIncomeAccountId
          ? text(payload.linkedIncomeAccountId, 'Cuenta de ingresos', 1, 80)
          : null
      validatePaymentAccountFields(db, type, {
        active,
        responsibleUserId,
        linkedIncomeAccountId,
        channel
      })
      const id = `dict_${sha256(`${type}|${parentId ?? ''}|${name}|${Date.now()}`).slice(0, 20)}`
      const nowIso = new Date().toISOString()
      db.tx(() => {
        db.run(
          `INSERT INTO dictionary_nodes
            (id, parent_id, type, code, channel, name, sort_order, active, system,
             responsible_user_id, linked_income_account_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
          id,
          parentId,
          type,
          code,
          channel,
          name,
          sortOrder,
          active ? 1 : 0,
          responsibleUserId,
          linkedIncomeAccountId,
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
      const nextActive = payload?.active === undefined ? Boolean(row.active) : Boolean(payload.active)
      const nextResponsibleUserId =
        payload?.responsibleUserId !== undefined
          ? typeof payload.responsibleUserId === 'string' && payload.responsibleUserId
            ? text(payload.responsibleUserId, 'Administrador responsable', 1, 80)
            : null
          : (row.responsible_user_id ?? null)
      const nextLinkedIncomeAccountId =
        payload?.linkedIncomeAccountId !== undefined
          ? typeof payload.linkedIncomeAccountId === 'string' && payload.linkedIncomeAccountId
            ? text(payload.linkedIncomeAccountId, 'Cuenta de ingresos', 1, 80)
            : null
          : (row.linked_income_account_id ?? null)
      const nextChannel =
        payload?.channel !== undefined
          ? typeof payload.channel === 'string' && payload.channel.trim()
            ? payload.channel.trim()
            : null
          : (row.channel ?? null)
      validatePaymentAccountFields(db, row.type, {
        active: nextActive,
        responsibleUserId: nextResponsibleUserId,
        linkedIncomeAccountId: nextLinkedIncomeAccountId,
        channel: nextChannel,
        id
      })
      if (nextActive !== Boolean(row.active)) {
        updates.push('active = ?')
        params.push(nextActive ? 1 : 0)
        changed.push(nextActive ? 'activación' : 'desactivación')
      }
      if (nextChannel !== (row.channel ?? null)) {
        updates.push('channel = ?')
        params.push(nextChannel)
        changed.push('canal')
      }
      if (nextResponsibleUserId !== (row.responsible_user_id ?? null)) {
        updates.push('responsible_user_id = ?')
        params.push(nextResponsibleUserId)
        changed.push('administrador responsable')
      }
      if (nextLinkedIncomeAccountId !== (row.linked_income_account_id ?? null)) {
        updates.push('linked_income_account_id = ?')
        params.push(nextLinkedIncomeAccountId)
        changed.push('cuenta de ingresos vinculada')
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

    case 'promotions.list': {
      requireModuleAccess(session, 'promotions')
      return listPromotions(db)
    }

    case 'promotions.preview': {
      requireModuleAccess(session, 'promotions')
      return previewPromotion(db, payload as unknown as PromotionInput)
    }

    case 'promotions.create': {
      requireModuleAccess(session, 'promotions')
      requireCap(session, 'managePromotions')
      const input = payload as unknown as PromotionInput
      const result = savePromotion(db, input, session.userId)
      audit(
        db,
        session,
        'Creación de promoción',
        'Promoción',
        `${result.promotion.name} · ${result.promotion.badge}${result.belowCostCount ? ` · ${result.belowCostCount} producto(s) bajo costo` : ''}`,
        result.promotion.id
      )
      scheduleCatalogPublish(db, runtime)
      return result.promotion
    }

    case 'promotions.update': {
      requireModuleAccess(session, 'promotions')
      requireCap(session, 'managePromotions')
      const input = payload as unknown as PromotionInput
      if (!input.id) fail('Falta la promoción.', 'BAD_REQUEST')
      const result = savePromotion(db, input, session.userId)
      audit(
        db,
        session,
        'Actualización de promoción',
        'Promoción',
        `${result.promotion.name} · ${result.promotion.badge}${result.belowCostCount ? ` · ${result.belowCostCount} producto(s) bajo costo` : ''}`,
        result.promotion.id
      )
      scheduleCatalogPublish(db, runtime)
      return result.promotion
    }

    case 'promotions.toggle': {
      requireModuleAccess(session, 'promotions')
      requireCap(session, 'managePromotions')
      const id = text(payload?.id, 'Promoción', 1, 80)
      const active = Boolean(payload?.active)
      const promotion = togglePromotion(db, id, active, session.userId)
      audit(db, session, active ? 'Activación de promoción' : 'Pausa de promoción', 'Promoción', promotion.name, id)
      scheduleCatalogPublish(db, runtime)
      return promotion
    }

    case 'promotions.publishWeb': {
      requireModuleAccess(session, 'promotions')
      requireCap(session, 'managePromotions')
      const id = text(payload?.id, 'Promoción', 1, 80)
      const publishWeb = Boolean(payload?.publishWeb)
      const promotion = setPromotionWeb(db, id, publishWeb, session.userId)
      audit(
        db,
        session,
        publishWeb ? 'Publicación de promoción en web' : 'Retiro de promoción de web',
        'Promoción',
        promotion.name,
        id
      )
      scheduleCatalogPublish(db, runtime)
      return promotion
    }

    case 'promotions.delete': {
      requireModuleAccess(session, 'promotions')
      requireCap(session, 'managePromotions')
      const id = text(payload?.id, 'Promoción', 1, 80)
      const current = listPromotions(db).find((promotion) => promotion.id === id)
      deletePromotion(db, id)
      audit(db, session, 'Eliminación de promoción', 'Promoción', current?.name ?? id, id)
      scheduleCatalogPublish(db, runtime)
      return { deleted: true }
    }

    case 'catalog.status': {
      requireCap(session, 'publishCatalog')
      return catalogStatus(db, runtime)
    }

    case 'catalog.configureRemote': {
      requireCap(session, 'publishCatalog')
      const status = updateCatalogConfig(db, runtime, {
        remote: {
          enabled:
            payload?.enabled === undefined ? undefined : Boolean(payload.enabled),
          supabaseUrl:
            typeof payload?.supabaseUrl === 'string' ? payload.supabaseUrl : undefined,
          bucket: typeof payload?.bucket === 'string' ? payload.bucket : undefined
        }
      })
      audit(
        db,
        session,
        'Configuración de Supabase actualizada',
        'Catálogo web',
        `${status.remote.supabaseUrl} · bucket ${status.remote.bucket} · ${
          status.remote.enabled ? 'activada' : 'desactivada'
        }`,
        'catalog'
      )
      return status
    }

    case 'catalog.saveSecret': {
      requireCap(session, 'publishCatalog')
      const secret = text(payload?.secret, 'Clave secreta de Supabase', 20, 500)
      const status = saveRemoteSecret(db, runtime, secret)
      audit(
        db,
        session,
        'Clave de Supabase guardada',
        'Catálogo web',
        'La clave secreta se almacenó cifrada en este equipo.',
        'catalog'
      )
      return status
    }

    case 'catalog.clearSecret': {
      requireCap(session, 'publishCatalog')
      const status = clearRemoteSecret(db, runtime)
      audit(
        db,
        session,
        'Clave de Supabase eliminada',
        'Catálogo web',
        'Se retiró la clave secreta del equipo.',
        'catalog'
      )
      return status
    }

    case 'catalog.testConnection': {
      requireCap(session, 'publishCatalog')
      return testSupabaseConnection(db, runtime)
    }

    case 'catalog.publishRemote': {
      requireCap(session, 'publishCatalog')
      const result = await publishCatalogRemote(db, runtime)
      audit(
        db,
        session,
        result.ok ? 'Publicación en Supabase' : 'Error de publicación en Supabase',
        'Catálogo web',
        result.ok ? result.status.remote.lastMessage : result.error ?? result.status.remote.lastMessage,
        'catalog'
      )
      return result
    }

    case 'catalog.publish': {
      requireCap(session, 'publishCatalog')
      const result = await publishCatalog(db, runtime)
      const message = result.ok
        ? result.status.remote.enabled
          ? `${result.status.lastMessage} · ${result.status.remote.lastMessage}`
          : result.status.lastMessage
        : result.error ?? result.status.lastMessage
      audit(
        db,
        session,
        result.ok ? 'Publicación de catálogo web' : 'Error de publicación de catálogo web',
        'Catálogo web',
        message,
        'catalog'
      )
      return result
    }

    case 'catalog.chooseFolder': {
      requireCap(session, 'publishCatalog')
      const selected = await dialog.showOpenDialog({
        title: 'Selecciona la carpeta del catálogo web',
        properties: ['openDirectory', 'createDirectory']
      })
      if (selected.canceled || !selected.filePaths[0]) return { canceled: true }
      const targetPath = selected.filePaths[0]
      updateCatalogConfig(db, runtime, { targetPath })
      audit(db, session, 'Carpeta de catálogo web actualizada', 'Catálogo web', targetPath, 'catalog')
      return { canceled: false, status: catalogStatus(db, runtime) }
    }

    case 'settings.get': {
      requireModuleAccess(session, 'settings')
      return settingsData(db, runtime)
    }

    case 'legal.get': {
      return legalPublic(db)
    }

    case 'business.update': {
      requireModuleAccess(session, 'settings')
      requireCap(session, 'configureBusiness')
      const current = getLegal(db)
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
        email: text(payload?.email ?? current.email, 'Correo', 3, 160)
      }
      db.tx(() => {
        db.setSetting('legal_config', next)
        audit(
          db,
          session,
          'Actualización de datos del negocio',
          'Configuración',
          `${next.businessName} · NIT ${next.nit}-${next.nitDv} · ${next.phone}`,
          'business'
        )
      })
      return next
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
      const section = schema(
        payload?.section,
        z.enum([
          'print',
          'ai',
          'security',
          'business',
          'equipment',
          'payments',
          'messages',
          'tracking',
          'catalog'
        ])
      )
      if (section === 'ai') requireCap(session, 'configureAI')
      if (section === 'equipment') requireCap(session, 'manageStaff')
      if (section === 'business' || section === 'payments') {
        requireCap(session, 'configureBusiness')
      }
      if (section === 'tracking') requireCap(session, 'configureBusiness')
      if (section === 'catalog') requireCap(session, 'publishCatalog')
      if (section === 'catalog') {
        const value = payload?.value && typeof payload.value === 'object' ? payload.value : {}
        const remote =
          value.remote && typeof value.remote === 'object' ? value.remote : undefined
        updateCatalogConfig(db, runtime, {
          targetPath: typeof value.targetPath === 'string' ? value.targetPath : undefined,
          autoPublish: value.autoPublish === undefined ? undefined : Boolean(value.autoPublish),
          stockVisibility:
            value.stockVisibility === 'always' || value.stockVisibility === 'outOnly'
              ? value.stockVisibility
              : undefined,
          remote: remote
            ? {
                enabled:
                  remote.enabled === undefined ? undefined : Boolean(remote.enabled),
                supabaseUrl:
                  typeof remote.supabaseUrl === 'string' ? remote.supabaseUrl : undefined,
                bucket: typeof remote.bucket === 'string' ? remote.bucket : undefined
              }
            : undefined
        })
        audit(db, session, 'Actualización de catálogo web', 'Configuración', 'Sección catálogo actualizada.', 'catalog')
        return settingsData(db, runtime)
      }
      if (section === 'ai') {
        const current = db.getSetting<any>('ai_config', DEFAULT_SETTINGS.ai)
        const value = payload?.value && typeof payload.value === 'object' ? { ...payload.value } : {}
        const apiKey = typeof value.apiKey === 'string' ? value.apiKey.trim() : ''
        const provider = schema(value.provider ?? current.provider ?? 'gemini', z.enum(['gemini']))
        const model = normalizeAiModel(value.model ?? current.model)
        if (value.fallbackModels !== undefined && !Array.isArray(value.fallbackModels)) {
          fail('La lista de modelos de respaldo no es válida.')
        }
        const rawFallbacks = Array.isArray(value.fallbackModels)
          ? value.fallbackModels
          : Array.isArray(current.fallbackModels)
            ? current.fallbackModels
            : []
        const fallbackModels = [
          ...new Set(
            rawFallbacks
              .filter((item: unknown) => typeof item === 'string' && Boolean(item.trim()))
              .map((item: string) => normalizeAiModel(item, 'Modelo de respaldo'))
              .filter((item: string) => item !== model)
          )
        ].slice(0, 3)
        const autoFallback = fallbackModels.length
          ? value.autoFallback === undefined
            ? Boolean(current.autoFallback)
            : Boolean(value.autoFallback)
          : false
        let aiKey = db.getSetting<any>('ai_key', null)
        if (apiKey) {
          if (!safeStorage.isEncryptionAvailable()) {
            fail('El almacén seguro de Windows no está disponible; no se puede guardar la clave de IA.')
          }
          aiKey = {
            encrypted: safeStorage.encryptString(apiKey).toString('base64'),
            fingerprint: sha256(apiKey).slice(0, 12),
            updatedAt: new Date().toISOString()
          }
          db.setSetting('ai_key', aiKey)
        }
        db.setSetting('ai_config', {
          ...current,
          enabled: value.enabled === undefined ? current.enabled : Boolean(value.enabled),
          diagnosis:
            value.diagnosis === undefined ? current.diagnosis : Boolean(value.diagnosis),
          summary: value.summary === undefined ? current.summary : Boolean(value.summary),
          anomalies:
            value.anomalies === undefined ? current.anomalies : Boolean(value.anomalies),
          provider,
          model,
          fallbackModels,
          autoFallback,
          modelCatalog: Array.isArray(current.modelCatalog) ? current.modelCatalog : [],
          catalogUpdatedAt: current.catalogUpdatedAt ?? null,
          configured: Boolean(aiKey?.encrypted),
          keyFingerprint: aiKey?.fingerprint ?? undefined
        })
      } else {
        const current = db.getSetting<any>(`${section}_config`, (DEFAULT_SETTINGS as any)[section])
        db.setSetting(`${section}_config`, { ...current, ...(payload?.value ?? {}) })
      }
      audit(db, session, 'Actualización de configuración', 'Configuración', `Sección ${section} actualizada.`)
      return settingsData(db, runtime)
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
      if (row.role === 'admin') {
        const activeAdmins = Number(
          db.get<{ count: number }>(
            "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1"
          )?.count ?? 0
        )
        const demoting = payload?.role !== undefined && payload.role !== 'admin'
        const deactivating = payload?.active === false || payload?.active === 0
        if ((demoting || deactivating) && activeAdmins <= 1) {
          fail('Debe quedar al menos un administrador activo.')
        }
      }
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
      requireCap(session, 'restoreBackup')
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
      requireCap(session, 'restoreBackup')
      const password = getBackupPassword(db)
      if (!password) fail('Configura primero la contraseña de respaldo.')
      db.tx(() => {
        audit(
          db,
          session,
          'Visualización de contraseña de respaldo',
          'Respaldo',
          'El propietario copió la contraseña de respaldo.'
        )
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
      const productImagesRoot = path.join(folder, PRODUCT_IMAGE_FOLDER)
      const productImages = fs.existsSync(productImagesRoot)
        ? walkFiles(productImagesRoot).map((file) => ({
            path: file.relative.replace(/\\/g, '/'),
            data: fs.readFileSync(file.absolute).toString('base64')
          }))
        : []
      const paymentReceiptsRoot = path.join(folder, PAYMENT_RECEIPT_FOLDER)
      const paymentReceipts = fs.existsSync(paymentReceiptsRoot)
        ? walkFiles(paymentReceiptsRoot).map((file) => ({
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
        evidence,
        productImages,
        paymentReceipts
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
      requireCap(session, 'importBackup')
      const stored = getBackupPassword(db)
      const supplied =
        typeof payload?.password === 'string' && payload.password
          ? payload.password
          : session.actualRole === 'superadmin'
            ? stored
            : ''
      if (!supplied) {
        fail('Ingresa la contraseña del archivo .bctbackup para importar la base.', 'INVALID_PASSWORD')
      }
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
      fs.mkdirSync(path.join(folder, PRODUCT_IMAGE_FOLDER), { recursive: true })
      fs.mkdirSync(path.join(folder, PAYMENT_RECEIPT_FOLDER), { recursive: true })
      const databaseBytes = Buffer.from(String(container.database), 'base64')
      fs.writeFileSync(path.join(folder, BACKUP_DATABASE_FILENAME), databaseBytes)
      for (const item of Array.isArray(container.evidence) ? container.evidence : []) {
        const relative = String(item?.path ?? '').replace(/\\/g, '/')
        if (!relative || relative.includes('..') || path.isAbsolute(relative)) continue
        const target = path.join(folder, EVIDENCE_FOLDER, relative)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, Buffer.from(String(item?.data ?? ''), 'base64'))
      }
      for (const item of Array.isArray(container.productImages) ? container.productImages : []) {
        const relative = String(item?.path ?? '').replace(/\\/g, '/')
        if (!relative || relative.includes('..') || path.isAbsolute(relative)) continue
        const target = path.join(folder, PRODUCT_IMAGE_FOLDER, relative)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, Buffer.from(String(item?.data ?? ''), 'base64'))
      }
      for (const item of Array.isArray(container.paymentReceipts) ? container.paymentReceipts : []) {
        const relative = String(item?.path ?? '').replace(/\\/g, '/')
        if (!relative || relative.includes('..') || path.isAbsolute(relative)) continue
        const target = path.join(folder, PAYMENT_RECEIPT_FOLDER, relative)
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
      const scope = schema(
        payload?.scope ?? 'all',
        z.enum(['all', 'operation', 'custom'])
      )
      const requestedSelection = Array.isArray(payload?.selection)
        ? schema(
            payload.selection,
            z.array(
              z.enum(['operation', 'inventory', 'customers', 'suppliers', 'promotions'])
            )
          )
        : []
      const selected = new Set<string>(
        scope === 'all'
          ? ['operation', 'inventory', 'customers', 'suppliers', 'promotions']
          : scope === 'operation'
            ? ['operation']
            : requestedSelection
      )
      if (selected.has('inventory') || selected.has('customers') || selected.has('suppliers')) {
        selected.add('operation')
      }
      if (!selected.size) fail('Selecciona al menos un bloque para purgar.')
      const operation = selected.has('operation')
      const inventory = selected.has('inventory')
      const customers = selected.has('customers')
      const suppliers = selected.has('suppliers')
      const promotions = selected.has('promotions') || inventory
      // createBackup registra la copia previa en la tabla de respaldos.
      const backup = await createBackup(db, runtime, session)
      db.tx(() => {
        // Se preservan usuarios, configuración, auditoría y respaldos.
        db.exec('DROP TRIGGER IF EXISTS payments_no_update; DROP TRIGGER IF EXISTS payments_no_delete;')
        db.exec('DROP TRIGGER IF EXISTS cash_movements_no_update; DROP TRIGGER IF EXISTS cash_movements_no_delete;')
        db.exec('DROP TRIGGER IF EXISTS stock_movements_no_update; DROP TRIGGER IF EXISTS stock_movements_no_delete;')
        if (operation) {
          db.exec(`
            DELETE FROM account_movements;
            DELETE FROM cash_transfers;
            DELETE FROM payment_receipts;
            DELETE FROM payments;
            DELETE FROM invoice_items;
            DELETE FROM invoices;
            DELETE FROM cash_movements;
            DELETE FROM cash_sessions;
            DELETE FROM work_order_evidence;
            DELETE FROM work_order_events;
            DELETE FROM work_order_items;
            DELETE FROM work_orders;
            DELETE FROM supplier_payments;
            DELETE FROM purchase_items;
            DELETE FROM purchases;
            DELETE FROM sequences;
          `)
        }
        if (promotions) {
          db.exec('DELETE FROM promotion_targets; DELETE FROM promotions;')
        }
        if (inventory) {
          db.exec(`
            DELETE FROM stock_movements;
            DELETE FROM product_serials;
            DELETE FROM products;
          `)
        }
        if (customers) {
          db.exec('DELETE FROM customers WHERE is_final_consumer = 0;')
        }
        if (suppliers) {
          db.exec('DELETE FROM suppliers;')
        }
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
          detail: `Datos purgados (${scope}): ${[...selected].join(', ')}. Respaldo previo: ${backup.name}.`
        })
      })
      if (operation) {
        const evidenceRoot = getEvidencePath(runtime.userDataPath)
        if (fs.existsSync(evidenceRoot)) fs.rmSync(evidenceRoot, { recursive: true, force: true })
        fs.mkdirSync(evidenceRoot, { recursive: true })
        const paymentReceiptsRoot = paymentReceiptRoot(runtime.userDataPath)
        if (fs.existsSync(paymentReceiptsRoot)) {
          fs.rmSync(paymentReceiptsRoot, { recursive: true, force: true })
        }
        fs.mkdirSync(paymentReceiptsRoot, { recursive: true })
        db.appendAudit({
          userId: session.userId,
          userName: displayUser(session).name,
          role: roleLabel(session.role as any),
          action: 'Purga de evidencias',
          entity: 'Sistema',
          entityId: backup.id,
          detail: `Evidencias y comprobantes de las OT/pagos purgados eliminados del disco. El respaldo completo ${backup.name} los conserva.`
        })
      }
      if (inventory) {
        const productImagesRoot = productImageRoot(runtime.userDataPath)
        if (fs.existsSync(productImagesRoot)) {
          fs.rmSync(productImagesRoot, { recursive: true, force: true })
        }
        fs.mkdirSync(productImagesRoot, { recursive: true })
        db.appendAudit({
          userId: session.userId,
          userName: displayUser(session).name,
          role: roleLabel(session.role as any),
          action: 'Purga de imágenes de inventario',
          entity: 'Sistema',
          entityId: backup.id,
          detail: `Imágenes de productos eliminadas del disco. El respaldo completo ${backup.name} conserva las imágenes.`
        })
      }
      let catalog: { ok: boolean; error?: string } | undefined
      if (payload?.publishCatalog === true) {
        const published = await publishCatalog(db, runtime)
        catalog = { ok: published.ok, error: published.error }
      }
      return { purged: true, backup, requiresReload: true, scope, selection: [...selected], catalog }
    }

    default:
      fail(`Comando desconocido: ${command}`, 'UNKNOWN_COMMAND')
  }
}
