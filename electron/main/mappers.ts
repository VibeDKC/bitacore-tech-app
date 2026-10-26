import type { Database } from './database'
import { evidenceDto, evidenceSetHash } from './evidence'
import { calculateNitDv } from './nit'

export const money = (cents: number | null | undefined) => Math.round(Number(cents ?? 0)) / 100
export const toCents = (value: number | null | undefined) => Math.round(Number(value ?? 0) * 100)
export const bool = (value: unknown) => Number(value) === 1

const STATUS_ORDER = ['recibido', 'diagnostico', 'aprobacion', 'reparacion', 'pruebas', 'listo', 'entregado', 'no_reparado']

export function customerDto(db: Database, row: any) {
  const purchases =
    db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM invoices WHERE customer_id = ? AND status = 'activa' AND type = 'venta'",
      row.id
    )?.count ?? 0
  const orders = db.get<{ count: number }>('SELECT COUNT(*) AS count FROM work_orders WHERE customer_id = ?', row.id)?.count ?? 0
  const openOrders =
    db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM work_orders WHERE customer_id = ? AND status NOT IN ('entregado','no_reparado')",
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

  return {
    id: row.id,
    name: row.name,
    documentType: row.document_type,
    document: row.document,
    documentDv: row.document_type === 'NIT' && !bool(row.is_foreign_document) ? calculateNitDv(row.document) : undefined,
    phone: row.phone,
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
    loyaltyNotes: row.loyalty_notes ?? ''
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

  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    barcode: row.barcode,
    category: row.category,
    location: row.location,
    stock: Number(row.stock),
    minStock: Number(row.min_stock),
    ...(includeCost ? { cost: money(row.cost_cents) } : {}),
    price: money(row.price_cents),
    warrantyDays: Number(row.warranty_days),
    serials,
    service: bool(row.is_service),
    alertEnabled: row.alert_enabled === undefined ? true : bool(row.alert_enabled),
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

export function paymentDto(row: any) {
  return {
    id: row.id,
    number: row.number,
    kind: row.kind,
    method: row.method,
    amount: money(row.amount_cents),
    received: row.received_cents === null ? null : money(row.received_cents),
    change: money(row.change_cents),
    reference: row.reference,
    isException: bool(row.is_exception),
    exceptionReason: row.exception_reason,
    createdAt: row.created_at,
    createdByName: row.created_by_name
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
      lineTotal: money(line.line_total_cents),
      note: line.note ?? null,
      itemType: line.item_type === 'servicio' ? 'servicio' : 'producto'
    }))
  const payment = db.get<any>(
    'SELECT received_cents, change_cents FROM payments WHERE invoice_id = ? ORDER BY created_at DESC LIMIT 1',
    row.id
  )
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
    createdAt: row.created_at
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
    unitPrice: money(item.unit_price_cents)
  }))
  const payments = paymentRows.map(paymentDto)
  const itemsTotal = itemRows.reduce((sum, item) => sum + Number(item.unit_price_cents) * Number(item.quantity), 0)
  const totalCents = itemsTotal > 0 ? itemsTotal : toCents(intake?.estimate ?? 0)
  const paidCents = paymentRows.reduce((sum, payment) => sum + Number(payment.amount_cents), 0)
  const balanceCents = Math.max(totalCents - paidCents, 0)
  const balance = money(balanceCents)

  let settlement: any
  if (row.status === 'entregado') {
    const isException = invoiceRow && Number(invoiceRow.total_cents) === 0
    const exceptionReason = isException
      ? String(invoiceRow.notes ?? '').replace(/^Excepción:\s*/i, '')
      : undefined
    settlement = isException
      ? {
          status: 'exento',
          amount: 0,
          paidAt: row.delivered_at ?? invoiceRow?.created_at ?? row.updated_at,
          exceptionReason
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
    evidence: evidenceRows.map(evidenceDto),
    evidenceCount: activeEvidence.length,
    evidenceBytes,
    evidenceSetHash: evidenceSetHash(evidenceRows),
    evidenceVerified:
      activeEvidence.length > 0 && activeEvidence.every((item) => Boolean(item.verified_at)),
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
