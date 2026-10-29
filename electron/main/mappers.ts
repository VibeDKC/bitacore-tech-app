import type { Database } from './database'
import { productImageUrl } from './productImages'
import { paymentReceiptUrl } from './paymentReceipts'
import { evidenceDto, evidenceSetHash } from './evidence'
import { calculateNitDv } from './nit'
import { resolvePromotionForProductRow } from './promotions'
import { isTerminalOrderStatus, warrantyForOrder } from './orderStatus'

export const money = (cents: number | null | undefined) => Math.round(Number(cents ?? 0)) / 100
export const toCents = (value: number | null | undefined) => Math.round(Number(value ?? 0) * 100)
export const bool = (value: unknown) => Number(value) === 1

const STATUS_ORDER = ['recibido', 'diagnostico', 'aprobacion', 'reparacion', 'pruebas', 'listo', 'entregado', 'no_reparado', 'abandonado']

export function customerDto(db: Database, row: any) {
  const purchases =
    db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM invoices WHERE customer_id = ? AND status = 'activa' AND type = 'venta'",
      row.id
    )?.count ?? 0
  const orders = db.get<{ count: number }>('SELECT COUNT(*) AS count FROM work_orders WHERE customer_id = ?', row.id)?.count ?? 0
  const openOrders =
    db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM work_orders WHERE customer_id = ? AND status NOT IN ('entregado','no_reparado','abandonado')",
      row.id
    )?.count ?? 0
  const lastInvoice = db.get<{ date: string }>(
    'SELECT created_at AS date FROM invoices WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1',
    row.id
  )?.date
  const lastOrder = db.get<{ date: string }>(
    'SELECT created_at AS date FROM work_orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1',
    row.id
  )?.date
  const lastVisit = [row.updated_at, lastInvoice, lastOrder].filter(Boolean).sort().pop() ?? row.updated_at
  const phoneRows = db.all<any>(
    'SELECT id, phone, label, is_primary FROM customer_phones WHERE customer_id = ? ORDER BY is_primary DESC, created_at ASC',
    row.id
  )
  const phones = phoneRows.map((item) => ({
    id: item.id,
    phone: item.phone,
    label: item.label,
    isPrimary: bool(item.is_primary)
  }))
  if (!phones.length && row.phone && row.phone !== '—') {
    phones.push({ id: undefined, phone: row.phone, label: 'Principal', isPrimary: true })
  }
  const primaryPhone = phones.find((item) => item.isPrimary)?.phone ?? row.phone
  let phoneWarning: string | undefined
  if (phones.length) {
    const placeholders = phones.map(() => '?').join(', ')
    const duplicates = db.all<any>(
      `SELECT DISTINCT c.name, p.phone
       FROM customer_phones p JOIN customers c ON c.id = p.customer_id
       WHERE p.phone IN (${placeholders}) AND p.customer_id <> ?`,
      ...phones.map((item) => item.phone),
      row.id
    )
    if (duplicates.length) {
      phoneWarning = `Teléfono también registrado en: ${duplicates
        .map((item) => `${item.name} (${item.phone})`)
        .join(', ')}`
    }
  }

  return {
    id: row.id,
    name: row.name,
    documentType: row.document_type,
    document: row.document,
    documentMissing: bool(row.document_missing),
    documentDv:
      row.document_type === 'NIT' && !bool(row.is_foreign_document) && !bool(row.document_missing)
        ? calculateNitDv(row.document)
        : undefined,
    phone: primaryPhone,
    phones,
    phoneWarning,
    email: row.email,
    address: row.address,
    purchases: Number(purchases),
    orders: Number(orders),
    openOrders: Number(openOrders),
    lastVisit,
    isFinalConsumer: bool(row.is_final_consumer),
    isForeignDocument: bool(row.is_foreign_document),
    loyaltyActive: bool(row.loyalty_active),
    loyaltyDiscountType: row.loyalty_discount_type ?? 'percent',
    loyaltyDiscountValue: Number(row.loyalty_discount_value ?? 0),
    loyaltyValidUntil: row.loyalty_valid_until ?? null,
    loyaltyNotes: row.loyalty_notes ?? '',
    creditEnabled: bool(row.credit_enabled),
    creditLimit: money(row.credit_limit_cents),
    creditDays: Number(row.credit_days ?? 30)
  }
}

export function equipmentDto(row: any) {
  let technicalSheet: Record<string, unknown> | null = null
  try {
    technicalSheet = row.technical_sheet_json ? JSON.parse(row.technical_sheet_json) : null
  } catch {
    technicalSheet = null
  }
  return {
    id: row.id,
    customerId: row.customer_id,
    category: row.category,
    categoryLabel: row.category_label,
    equipmentType: row.equipment_type,
    brand: row.brand,
    model: row.model,
    serial: row.serial,
    accessories: row.accessories,
    technicalSheet,
    notes: row.notes ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function productDto(db: Database, row: any, includeCost = true) {  const serials = db
    .all<{ serial: string }>('SELECT serial FROM product_serials WHERE product_id = ? ORDER BY created_at ASC', row.id)
    .map((item) => item.serial)
  const imageRows = db.all<any>(
    'SELECT * FROM product_images WHERE product_id = ? ORDER BY is_cover DESC, sort_order ASC, created_at ASC',
    row.id
  )
  const images = imageRows.map((image) => ({
    id: image.id,
    url: productImageUrl(String(image.image_path)),
    thumbnailUrl: productImageUrl(String(image.image_thumb_path || image.image_path)),
    alt: image.alt ?? '',
    sortOrder: Number(image.sort_order ?? 0),
    isCover: bool(image.is_cover),
    createdAt: image.created_at
  }))

  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    barcode: row.barcode,
    supplierSku: row.supplier_sku ?? '',
    category: row.category,
    location: row.location,
    condition: row.condition ?? '',
    origin: row.origin ?? '',
    stock: Number(row.stock),
    minStock: Number(row.min_stock),
    ...(includeCost ? { cost: money(row.cost_cents) } : {}),
    price: money(row.price_cents),
    description: row.description ?? '',
    internalNotes: row.internal_notes ?? '',
    slug: row.slug ?? '',
    imageUrl: row.image_path ? productImageUrl(String(row.image_path)) : null,
    imageThumbnailUrl: row.image_thumb_path
      ? productImageUrl(String(row.image_thumb_path))
      : row.image_path
        ? productImageUrl(String(row.image_path))
        : null,
    imageUpdatedAt: row.image_updated_at ?? null,
    images,
    warrantyDays: Number(row.warranty_days),
    serials,
    service: bool(row.is_service),
    serviceType: row.service_type ?? null,
    alertEnabled: row.alert_enabled === undefined ? true : bool(row.alert_enabled),
    publishWeb: row.publish_web === undefined ? true : bool(row.publish_web),
    promotion: resolvePromotionForProductRow(db, row),
    rotation: row.rotation === 'no_rotativo' || row.rotation === 'prueba' ? row.rotation : 'rotativo',
    iconKey: categoryIconKey(row.category),
    tone: categoryTone(row.category)
  }
}

export function categoryIconKey(category: string) {
  const map: Record<string, string> = {
    Almacenamiento: 'hard-drive',
    Memoria: 'memory-stick',
    'Periféricos': 'mouse',
    Repuestos: 'wrench',
    Componentes: 'cpu',
    Accesorios: 'cable',
    Insumos: 'spray-can',
    Servicios: 'flask-conical'
  }
  return map[category] ?? 'package'
}

export function categoryTone(category: string) {
  const map: Record<string, string> = {
    Almacenamiento: 'from-indigo-500/15 to-indigo-500/5 text-indigo-600',
    Memoria: 'from-sky-500/15 to-sky-500/5 text-sky-600',
    'Periféricos': 'from-slate-500/15 to-slate-500/5 text-slate-600',
    Repuestos: 'from-brand-500/15 to-brand-500/5 text-brand-600',
    Componentes: 'from-violet-500/15 to-violet-500/5 text-violet-600',
    Accesorios: 'from-emerald-500/15 to-emerald-500/5 text-emerald-600',
    Insumos: 'from-amber-500/15 to-amber-500/5 text-amber-600',
    Servicios: 'from-rose-500/15 to-rose-500/5 text-rose-600'
  }
  return map[category] ?? 'from-slate-500/15 to-slate-500/5 text-slate-600'
}

export function paymentDto(db: Database, row: any) {
  const receipt = db.get<any>('SELECT * FROM payment_receipts WHERE payment_id = ?', row.id)
  return {
    id: row.id,
    number: row.number,
    kind: row.kind,
    method: row.method,
    amount: money(row.amount_cents),
    received: row.received_cents === null ? null : money(row.received_cents),
    change: money(row.change_cents),
    reference: row.reference,
    incomeAccountId: row.income_account_id ?? null,
    incomeAccountName: row.income_account_name ?? null,
    isException: bool(row.is_exception),
    exceptionReason: row.exception_reason,
    createdAt: row.created_at,
    createdByName: row.created_by_name,
    createdByRole: row.created_by_role ?? null,
    receipt: receipt
      ? {
          url: paymentReceiptUrl(String(receipt.path)),
          filename: receipt.filename,
          mimeType: receipt.mime_type,
          size: Number(receipt.size_bytes ?? 0),
          uploadedAt: receipt.created_at,
          uploadedByName: receipt.uploaded_by_name ?? null
        }
      : null
  }
}

export function invoiceDto(db: Database, row: any, includeCustomer = true) {
  const count = db.get<{ count: number }>('SELECT COUNT(*) AS count FROM invoice_items WHERE invoice_id = ?', row.id)?.count ?? 0
  const lines = db
    .all<any>('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY rowid ASC', row.id)
    .map((line) => ({
      id: line.id,
      description: line.description,
      quantity: Number(line.quantity),
      unitPrice: money(line.unit_price_cents),
      originalUnitPrice: money(line.original_unit_price_cents || line.unit_price_cents),
      promotionName: line.promotion_name ?? null,
      promotionDiscount: money(line.promotion_discount_cents || 0),
      lineTotal: money(line.line_total_cents),
      note: line.note ?? null,
      itemType: line.item_type === 'servicio' ? 'servicio' : 'producto'
    }))
  const payment = db.get<any>(
    `SELECT id, received_cents, change_cents, income_account_name
     FROM payments WHERE invoice_id = ? ORDER BY created_at DESC LIMIT 1`,
    row.id
  )
  const receipt = payment?.id
    ? db.get<any>('SELECT * FROM payment_receipts WHERE payment_id = ?', payment.id)
    : null
  return {
    id: row.id,
    number: row.number,
    type: row.type,
    customerId: row.customer_id,
    customerName: includeCustomer ? row.customer_name : undefined,
    orderId: row.order_id,
    date: row.created_at,
    subtotal: money(row.subtotal_cents),
    discountPercent: Number(row.discount_percent),
    discountType: row.discount_type ?? 'percent',
    discountValue: Number(row.discount_value ?? 0),
    discount: money(row.discount_cents),
    total: money(row.total_cents),
    method: row.payment_method ?? 'Efectivo',
    status: row.status,
    items: Number(count),
    lines,
    received: payment ? money(payment.received_cents ?? row.total_cents) : money(row.total_cents),
    change: payment ? money(payment.change_cents ?? 0) : 0,
    notes: row.notes,
    createdAt: row.created_at,
    createdByName: row.created_by_name ?? null,
    createdByRole: row.created_by_role ?? null,
    dueDate: row.due_date ?? null,
    creditAuthorized: bool(row.credit_authorized),
    incomeAccountName: payment?.income_account_name ?? null,
    paymentId: payment?.id ?? null,
    paymentReceipt: receipt
      ? {
          url: paymentReceiptUrl(String(receipt.path)),
          filename: receipt.filename,
          mimeType: receipt.mime_type,
          size: Number(receipt.size_bytes ?? 0),
          uploadedAt: receipt.created_at,
          uploadedByName: receipt.uploaded_by_name ?? null
        }
      : null
  }
}

export function orderDto(db: Database, row: any) {
  const itemRows = db.all<any>(
    'SELECT * FROM work_order_items WHERE work_order_id = ? ORDER BY created_at ASC, rowid ASC',
    row.id
  )
  const eventRows = db.all<any>(
    'SELECT * FROM work_order_events WHERE work_order_id = ? ORDER BY created_at ASC, rowid ASC',
    row.id
  )
  const assignmentRows = db.all<any>(
    'SELECT * FROM work_order_assignments WHERE work_order_id = ? ORDER BY created_at ASC, rowid ASC',
    row.id
  )
  const paymentRows = db.all<any>('SELECT * FROM payments WHERE order_id = ? ORDER BY created_at ASC, rowid ASC', row.id)
  const invoiceRow = db.get<any>(
    "SELECT * FROM invoices WHERE order_id = ? ORDER BY created_at DESC LIMIT 1",
    row.id
  )
  const evidenceRows = db.all<any>(
    'SELECT * FROM work_order_evidence WHERE work_order_id = ? ORDER BY captured_at ASC, rowid ASC',
    row.id
  )
  const credentialRow = db.get<any>(
    'SELECT updated_at, view_count FROM work_order_credentials WHERE work_order_id = ?',
    row.id
  )
  const activeEvidence = evidenceRows.filter((item) => item.status === 'activa')
  const evidenceBytes = activeEvidence.reduce((sum, item) => sum + Number(item.size_bytes ?? 0), 0)
  const technician = row.technician_id
    ? db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', row.technician_id)?.name
    : null
  const equipmentRow = row.equipment_id
    ? db.get<any>('SELECT * FROM equipment WHERE id = ?', row.equipment_id)
    : null
  let intake: any = null
  try {
    intake = row.intake_json ? JSON.parse(row.intake_json) : null
  } catch {
    intake = null
  }

  const items = itemRows.map((item) => ({
    id: item.id,
    type: item.type,
    description: item.description,
    quantity: Number(item.quantity),
    unitPrice: money(item.unit_price_cents),
    warrantyDays: Number(item.warranty_days ?? 0),
    warrantyCovered: bool(item.warranty_covered)
  }))
  const payments = paymentRows.map((payment) => paymentDto(db, payment))
  const itemsTotal = itemRows.reduce((sum, item) => sum + Number(item.unit_price_cents) * Number(item.quantity), 0)
  const totalCents =
    invoiceRow?.status === 'activa'
      ? Number(invoiceRow.total_cents)
      : itemsTotal > 0
        ? itemsTotal
        : toCents(intake?.estimate ?? 0)
  const paidCents = paymentRows.reduce((sum, payment) => sum + Number(payment.amount_cents), 0)
  const isExceptionInvoice = Boolean(invoiceRow && String(invoiceRow.notes ?? '').startsWith('Excepción:'))
  const isCreditInvoice = Boolean(invoiceRow?.credit_authorized)
  const isWarrantyClaim = Boolean(row.warranty_of_order_id)
  const isNoChargeDelivery = row.status === 'entregado' && (isExceptionInvoice || isWarrantyClaim)
  const balanceCents = isNoChargeDelivery ? 0 : Math.max(totalCents - paidCents, 0)
  const balance = money(balanceCents)
  const dayMs = 24 * 60 * 60 * 1000
  const legal = db.getSetting<any>('legal_config', { warrantyDays: 90, abandonmentDays: 45 })
  const warranty = isWarrantyClaim ? null : warrantyForOrder(db, row)
  const warrantyOfRow = row.warranty_of_order_id
    ? db.get<any>('SELECT * FROM work_orders WHERE id = ?', row.warranty_of_order_id)
    : null
  const warrantyOf = warrantyOfRow
    ? {
        id: warrantyOfRow.id,
        number: warrantyOfRow.number,
        status: warrantyOfRow.status,
        deliveredAt: warrantyOfRow.delivered_at ?? null,
        warranty: warrantyForOrder(db, warrantyOfRow)
      }
    : null
  const warrantyClaims = db
    .all<any>(
      'SELECT id, number, status, warranty_result, created_at, delivered_at FROM work_orders WHERE warranty_of_order_id = ? ORDER BY created_at DESC',
      row.id
    )
    .map((claim) => ({
      id: claim.id,
      number: claim.number,
      status: claim.status,
      result: claim.warranty_result || 'pendiente',
      createdAt: claim.created_at,
      deliveredAt: claim.delivered_at ?? null
    }))
  let warrantyChecks: any = null
  try {
    warrantyChecks = row.warranty_checks_json ? JSON.parse(row.warranty_checks_json) : null
  } catch {
    warrantyChecks = null
  }
  const abandonmentDays = Math.max(
    1,
    Math.round(Number(intake?.legal?.abandonmentDays ?? legal?.abandonmentDays ?? 45))
  )
  let abandonment: any = null
  if (!isTerminalOrderStatus(row.status) && row.created_at) {
    const createdAt = new Date(row.created_at)
    if (Number.isFinite(createdAt.getTime())) {
      const at = new Date(createdAt.getTime() + abandonmentDays * dayMs)
      const daysLeft = Math.ceil((at.getTime() - Date.now()) / dayMs)
      abandonment = {
        days: abandonmentDays,
        at: at.toISOString(),
        daysLeft,
        atRisk: daysLeft <= 0
      }
    }
  }

  let settlement: any
  if (row.status === 'entregado') {
    const isException = isExceptionInvoice
    const exceptionReason = isException
      ? String(invoiceRow.notes ?? '').replace(/^Excepción:\s*/i, '')
      : undefined
    settlement = isCreditInvoice
      ? balanceCents > 0
        ? {
            status: 'credito',
            amount: money(invoiceRow?.total_cents ?? paidCents),
            method: 'Crédito',
            paidAt: row.delivered_at ?? invoiceRow?.created_at ?? row.updated_at,
            invoiceNumber: invoiceRow?.number,
            creditAuthorizedBy: invoiceRow?.credit_authorized_by ?? null
          }
        : {
            status: 'pagado',
            amount: money(invoiceRow?.total_cents ?? paidCents),
            method: 'Crédito',
            paidAt: row.delivered_at ?? invoiceRow?.created_at ?? row.updated_at,
            invoiceNumber: invoiceRow?.number,
            creditAuthorizedBy: invoiceRow?.credit_authorized_by ?? null
          }
      : isException || isWarrantyClaim
        ? {
            status: 'exento',
            amount: 0,
            paidAt: row.delivered_at ?? invoiceRow?.created_at ?? row.updated_at,
            exceptionReason: isWarrantyClaim ? 'Garantía' : exceptionReason
          }
        : {
            status: 'pagado',
            amount: money(invoiceRow?.total_cents ?? paidCents),
            method: invoiceRow?.payment_method ?? paymentRows.at(-1)?.method,
            paidAt: row.delivered_at ?? invoiceRow?.created_at ?? row.updated_at,
            invoiceNumber: invoiceRow?.number
          }
  }

  return {
    id: row.id,
    number: row.number,
    trackingCode: row.tracking_code ?? null,
    customerId: row.customer_id,
    customerName: row.customer_name,
    equipmentType: row.equipment_type,
    brand: row.brand,
    model: row.model,
    serial: row.serial,
    accessories: row.accessories,
    physicalCondition: row.physical_condition,
    reportedIssue: row.reported_issue,
    diagnosis: row.diagnosis,
    status: row.status,
    technician: technician ?? 'Sin asignar',
    technicianId: row.technician_id,
    equipmentId: row.equipment_id ?? null,
    equipment: equipmentRow ? equipmentDto(equipmentRow) : null,
    createdAt: row.created_at,
    promisedAt: row.promised_at,
    deliveredAt: row.delivered_at ?? undefined,
    items,
    timeline: eventRows.map((event, index) => ({
      id: event.id,
      status: event.status,
      title: event.title,
      description: event.description,
      user: event.user_name,
      date: event.created_at,
      state: event.state || (index === eventRows.length - 1 ? 'current' : 'done')
    })),
    notes: row.notes ?? '',
    intake,
    assignments: assignmentRows.map((assignment) => ({
      id: assignment.id,
      fromUserId: assignment.from_user_id ?? null,
      fromName: assignment.from_name ?? null,
      toUserId: assignment.to_user_id,
      toName: assignment.to_name,
      reason: assignment.reason ?? '',
      assignedBy: assignment.assigned_by,
      assignedByName: assignment.assigned_by_name,
      createdAt: assignment.created_at
    })),
    settlement,
    payments,
    paidAmount: money(paidCents),
    balance,
    total: money(totalCents),
    invoiceNumber: invoiceRow?.number,
    invoiceStatus: invoiceRow?.status,
    hasCredentials: Boolean(credentialRow),
    credentialsUpdatedAt: credentialRow?.updated_at ?? null,
    credentialsViewCount: Number(credentialRow?.view_count ?? 0),
    evidence: evidenceRows.map(evidenceDto),
    evidenceCount: activeEvidence.length,
    evidenceBytes,
    evidenceSetHash: evidenceSetHash(evidenceRows),
    evidenceVerified:
      activeEvidence.length > 0 && activeEvidence.every((item) => Boolean(item.verified_at)),
    warranty,
    warrantyOf,
    warrantyClaims,
    warrantyClaimReason: row.warranty_claim_reason ?? '',
    warrantyChecks,
    warrantyResult: row.warranty_result || 'pendiente',
    isWarrantyClaim,
    abandonedAt: row.abandoned_at ?? null,
    disassemblyProductId: row.disassembly_product_id ?? null,
    abandonment,
    statusOrder: STATUS_ORDER
  }
}

export function cashSessionDto(db: Database, row: any) {
  const movements = db.all<any>('SELECT * FROM cash_movements WHERE session_id = ? ORDER BY created_at ASC, rowid ASC', row.id)
  const sales = movements.filter((movement) => movement.type === 'venta')
  const cashSales = sales
    .filter((movement) => movement.method === 'Efectivo')
    .reduce((sum, movement) => sum + Number(movement.amount_cents), 0)
  const income = movements
    .filter((movement) => movement.type === 'ingreso')
    .reduce((sum, movement) => sum + Number(movement.amount_cents), 0)
  const expenses = movements
    .filter((movement) => movement.type === 'egreso')
    .reduce((sum, movement) => sum + Number(movement.amount_cents), 0)
  const expectedCents = Number(row.initial_cents) + cashSales + income - expenses
  const user = row.opened_by ? db.get<{ role: string }>('SELECT role FROM users WHERE id = ?', row.opened_by) : null
  const roleLabels: Record<string, string> = {
    superadmin: 'Propietario',
    admin: 'Administrador',
    tecnico: 'Técnico',
    cajero: 'Cajero'
  }

  return {
    id: row.id,
    user: row.opened_by_name,
    role: roleLabels[user?.role ?? 'cajero'] ?? 'Cajero',
    openedAt: row.opened_at,
    initialAmount: money(row.initial_cents),
    status: row.status,
    closedAt: row.closed_at,
    counted: row.counted_cents === null ? null : money(row.counted_cents),
    difference: row.difference_cents === null ? null : money(row.difference_cents),
    expected: money(row.status === 'cerrado' ? row.expected_cents : expectedCents),
    carryOver: money(row.carry_over_cents ?? 0),
    cashSales: money(cashSales),
    digitalSales: money(
      sales.filter((movement) => movement.method !== 'Efectivo').reduce((sum, movement) => sum + Number(movement.amount_cents), 0)
    ),
    income: money(income),
    expenses: money(expenses),
    sales: money(cashSales + sales.filter((movement) => movement.method !== 'Efectivo').reduce((sum, movement) => sum + Number(movement.amount_cents), 0)),
    movements: movements.map(cashMovementDto),
    notes: row.notes
  }
}

export function cashMovementDto(row: any) {
  return {
    id: row.id,
    type: row.type,
    method: row.method,
    amount: money(row.amount_cents),
    reason: row.reason,
    user: row.user_name,
    time: row.created_at
  }
}

export function auditDto(row: any) {
  const roleLabels: Record<string, string> = {
    superadmin: 'Propietario',
    admin: 'Administrador',
    tecnico: 'Técnico',
    cajero: 'Cajero'
  }
  return {
    id: row.id,
    time: row.created_at,
    user: row.user_name,
    role: roleLabels[row.role] ?? row.role,
    action: row.action,
    entity: row.entity_id ? `${row.entity} · ${row.entity_id}` : row.entity,
    entityName: row.entity,
    entityId: row.entity_id,
    detail: row.detail,
    hash: row.hash,
    prevHash: row.prev_hash
  }
}
