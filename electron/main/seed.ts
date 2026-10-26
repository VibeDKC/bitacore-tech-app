import seedJson from './seed-data.json'
import type { Database } from './database'
import { DEFAULT_LEGAL, DEFAULT_SETTINGS, STATUS_CONFIG } from './defaults'
import { hashPassword, newToken, sha256 } from './security'

const seed = seedJson as any
const now = () => new Date().toISOString()
const cents = (value: number) => Math.round(Number(value || 0) * 100)
const iso = (value: unknown) => (typeof value === 'string' && value ? value : now())

export interface SeedOwner {
  id: string
  username: string
  name: string
  email: string
  password: string
}

/**
 * Datos mínimos que toda instalación necesita para abrir la aplicación:
 * estados, configuración, versión legal inicial y secuencias. No crea
 * usuarios ni datos de demostración. El propietario se crea en el primer
 * arranque mediante auth.setup.
 */
export function ensureReferenceData(db: Database) {
  const reference = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'reference_seeded'")
  if (reference?.value === '1') return

  // Una base creada por la versión anterior ya tiene todo el catálogo de
  // referencia y usuarios. No se debe sobrescribir su configuración.
  const seeded = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'seeded'")
  if (seeded?.value === '1') {
    db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('reference_seeded', '1')")
    return
  }

  db.tx(() => {
    for (const status of STATUS_CONFIG) {
      db.run(
        `INSERT OR REPLACE INTO order_status_config
          (status, label, short_label, description, tone, position, is_terminal, requires_payment, is_cancel)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        status.status,
        status.label,
        status.shortLabel,
        status.description,
        status.tone,
        status.position,
        status.isTerminal,
        status.requiresPayment,
        status.isCancel
      )
    }

    db.setSetting('legal_config', DEFAULT_LEGAL)
    db.setSetting('print_config', DEFAULT_SETTINGS.print)
    db.setSetting('ai_config', DEFAULT_SETTINGS.ai)
    db.setSetting('security_config', DEFAULT_SETTINGS.security)
    db.setSetting('business_config', DEFAULT_SETTINGS.business)
    db.setSetting('charts_history', [])

    db.run(
      'INSERT OR IGNORE INTO legal_versions (id, version, config_json, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
      'legal_v1',
      DEFAULT_LEGAL.version,
      JSON.stringify(DEFAULT_LEGAL),
      'system',
      DEFAULT_LEGAL.updatedAt
    )

    for (const key of ['order', 'invoice', 'payment', 'purchase', 'cash_session']) {
      db.run('INSERT OR IGNORE INTO sequences (key, value) VALUES (?, 0)', key)
    }

    db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('reference_seeded', '1')")
  })
}

/**
 * Datos ficticios para probar la aplicación. Solo se ejecuta cuando el
 * propietario lo elige explícitamente en el primer arranque. Las cuentas
 * demo reciben contraseñas aleatorias: nadie puede iniciar sesión con una
 * credencial conocida.
 */
export function runDemoSeed(db: Database, owner: SeedOwner) {
  const seeded = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'seeded'")
  if (seeded?.value === '1') return
  db.tx(() => seedAll(db, owner))
}

function seedAll(db: Database, owner: SeedOwner) {
  const createdAt = '2026-10-01T08:00:00'

  const users = [
    {
      id: owner.id,
      username: owner.username,
      name: owner.name,
      email: owner.email,
      role: 'superadmin',
      password: owner.password,
      protected: 1,
      active: 1
    },
    {
      id: 'u2',
      username: 'andrea',
      name: 'Andrea Salazar',
      email: 'andrea@bitacoretech.co',
      role: 'admin',
      password: newToken(),
      protected: 0,
      active: 1
    },
    {
      id: 'u3',
      username: 'camila',
      name: 'Camila Restrepo',
      email: 'camila@bitacoretech.co',
      role: 'cajero',
      password: newToken(),
      protected: 0,
      active: 1
    },
    {
      id: 'u4',
      username: 'julian',
      name: 'Julián Vélez',
      email: 'julian@bitacoretech.co',
      role: 'tecnico',
      password: newToken(),
      protected: 0,
      active: 1
    },
    {
      id: 'u5',
      username: 'santiago',
      name: 'Santiago Mejía',
      email: 'santiago@bitacoretech.co',
      role: 'tecnico',
      password: newToken(),
      protected: 0,
      active: 0
    }
  ]

  for (const user of users) {
    db.run(
      `INSERT INTO users (id, username, name, email, role, password_hash, active, is_protected, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      user.id,
      user.username,
      user.name,
      user.email,
      user.role,
      hashPassword(user.password),
      user.active,
      user.protected,
      createdAt,
      user.id === 'u3' ? '2026-10-25T08:02:00' : user.id === 'u2' ? '2026-10-25T09:12:00' : null
    )
  }

  const userIdByName = new Map(users.map((user) => [user.name, user.id]))

  for (const product of seed.products ?? []) {
    db.run(
      `INSERT OR IGNORE INTO products
        (id, name, sku, barcode, category, location, stock, min_stock, cost_cents, price_cents, warranty_days, is_service, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      product.id,
      product.name,
      product.sku,
      product.barcode,
      product.category,
      product.location,
      Number(product.stock ?? 0),
      Number(product.minStock ?? 0),
      cents(product.cost),
      cents(product.price),
      Number(product.warrantyDays ?? 0),
      product.service ? 1 : 0,
      createdAt,
      createdAt
    )
    for (const [index, serial] of (product.serials ?? []).entries()) {
      db.run(
        'INSERT OR IGNORE INTO product_serials (id, product_id, serial, status, created_at) VALUES (?, ?, ?, ?, ?)',
        `ser_${product.id}_${index}`,
        product.id,
        serial,
        'disponible',
        createdAt
      )
    }
    if (!product.service) {
      db.run(
        `INSERT INTO stock_movements
          (id, product_id, type, quantity, unit_cost_cents, reason, reference_type, reference_id, user_id, user_name, created_at)
         VALUES (?, ?, 'carga_inicial', ?, ?, 'Carga inicial de inventario', 'seed', ?, 'u1', 'Propietario BitacoreTech', ?)`,
        `seed_stock_${product.id}`,
        product.id,
        Number(product.stock ?? 0),
        cents(product.cost),
        product.id,
        createdAt
      )
    }
  }

  for (const customer of seed.customers ?? []) {
    db.run(
      `INSERT OR IGNORE INTO customers
        (id, name, document_type, document, phone, email, address, is_final_consumer, created_at, updated_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'u2')`,
      customer.id,
      customer.name,
      customer.documentType ?? 'CC',
      customer.document,
      customer.phone ?? '—',
      customer.email ?? '—',
      customer.address ?? 'Sin dirección',
      customer.isFinalConsumer ? 1 : 0,
      createdAt,
      iso(customer.lastVisit)
    )
  }

  for (const supplier of seed.suppliers ?? []) {
    db.run(
      `INSERT OR IGNORE INTO suppliers (id, name, nit, contact, phone, category, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      supplier.id,
      supplier.name,
      supplier.nit ?? '—',
      supplier.contact ?? '—',
      supplier.phone ?? '—',
      supplier.category ?? 'Repuestos',
      createdAt
    )
  }

  for (const order of seed.workOrders ?? []) {
    const technicianId = userIdByName.get(order.technician) ?? 'u4'
    const intake = order.intake
    const receivedAt = intake?.receivedAt ?? order.createdAt
    db.run(
      `INSERT OR IGNORE INTO work_orders
        (id, number, customer_id, device_category, category_label, equipment_type, brand, model, serial, accessories,
         physical_condition, reported_issue, diagnosis, status, technician_id, created_at, promised_at, delivered_at,
         notes, intake_json, received_by, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      order.id,
      order.number,
      order.customerId,
      intake?.category ?? 'otro',
      intake?.categoryLabel ?? order.equipmentType,
      order.equipmentType,
      order.brand,
      order.model,
      order.serial,
      order.accessories,
      order.physicalCondition,
      order.reportedIssue,
      order.diagnosis ?? '',
      order.status,
      technicianId,
      order.createdAt,
      order.promisedAt,
      order.deliveredAt ?? null,
      order.notes ?? null,
      intake ? JSON.stringify(intake) : null,
      intake?.receivedBy ?? order.technician,
      technicianId,
      order.deliveredAt ?? order.createdAt
    )

    for (const item of order.items ?? []) {
      const costRate = item.type === 'repuesto' ? 0.62 : 0
      db.run(
        `INSERT OR IGNORE INTO work_order_items
          (id, work_order_id, type, description, quantity, unit_price_cents, product_id, unit_cost_cents, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        item.id,
        order.id,
        item.type,
        item.description,
        Number(item.quantity || 1),
        cents(item.unitPrice),
        cents(item.unitPrice * costRate),
        order.createdAt
      )
    }

    for (const event of order.timeline ?? []) {
      if (event.state === 'pending') continue
      db.run(
        `INSERT OR IGNORE INTO work_order_events
          (id, work_order_id, status, title, description, user_id, user_name, state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        event.id,
        order.id,
        event.status,
        event.title,
        event.description,
        event.user === 'Recepción' ? 'u4' : userIdByName.get(event.user) ?? 'u4',
        event.user,
        event.state ?? 'done',
        event.date || order.createdAt
      )
    }
  }

  const sessionId = String(seed.currentCashTurn?.id ?? '184')
  db.run(
    `INSERT OR IGNORE INTO cash_sessions
      (id, opened_by, opened_by_name, opened_at, initial_cents, status)
     VALUES (?, 'u3', 'Camila Restrepo', ?, ?, 'abierto')`,
    sessionId,
    seed.currentCashTurn?.openedAt ?? '2026-10-25T08:02:00',
    cents(seed.currentCashTurn?.initialAmount ?? 200000)
  )

  for (const movement of seed.cashMovements ?? []) {
    db.run(
      `INSERT OR IGNORE INTO cash_movements
        (id, session_id, type, method, amount_cents, reason, reference_type, reference_id, user_id, user_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'seed', ?, 'u3', ?, ?)`,
      movement.id,
      sessionId,
      movement.type,
      movement.method,
      cents(movement.amount),
      movement.reason,
      movement.id,
      movement.user ?? 'Camila Restrepo',
      movement.time
    )
  }

  const customerByName = new Map<string, string>(
    (seed.customers ?? []).map((customer: any) => [customer.name, customer.id])
  )
  const productByName = new Map<string, any>(
    (seed.products ?? []).map((product: any) => [product.name, product])
  )
  const invoiceDescription: Record<string, string> = {
    'FV-000184': 'SSD NVMe Kingston 1TB',
    'FV-000183': 'Memoria RAM DDR4 16GB',
    'FV-000182': 'Mouse Logitech M170',
    'FV-000181': 'Mantenimiento preventivo',
    'FV-000180': 'Repuestos de mostrador',
    'FV-000179': 'Mantenimiento preventivo'
  }

  for (const invoice of seed.invoices ?? []) {
    const customerId = customerByName.get(invoice.customerName) ?? 'c0'
    const description = invoiceDescription[invoice.number] ?? 'Venta de mostrador'
    const product = productByName.get(description) as any
    const unitCost = product ? cents(product.cost) : Math.round(cents(invoice.total) * 0.62)
    db.run(
      `INSERT OR IGNORE INTO invoices
        (id, number, type, customer_id, customer_name, subtotal_cents, discount_percent, discount_cents,
         total_cents, payment_method, status, created_by, created_at)
       VALUES (?, ?, 'venta', ?, ?, ?, 0, 0, ?, ?, ?, 'u3', ?)`,
      invoice.id,
      invoice.number,
      customerId,
      invoice.customerName,
      cents(invoice.total),
      cents(invoice.total),
      invoice.method,
      invoice.status,
      invoice.date
    )
    db.run(
      `INSERT INTO invoice_items
        (id, invoice_id, product_id, description, quantity, unit_price_cents, unit_cost_cents, line_total_cents, item_type)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      `seed_ii_${invoice.id}`,
      invoice.id,
      product?.id ?? null,
      description,
      cents(invoice.total),
      unitCost,
      cents(invoice.total),
      product ? 'producto' : 'servicio'
    )
    db.run(
      `INSERT INTO payments
        (id, number, kind, order_id, invoice_id, method, amount_cents, received_cents, change_cents, reference,
         is_exception, created_by, created_by_name, created_at)
       VALUES (?, ?, 'venta', NULL, ?, ?, ?, ?, 0, NULL, 0, 'u3', 'Camila Restrepo', ?)`,
      `seed_pay_${invoice.id}`,
      `PG-${invoice.number}`,
      invoice.id,
      invoice.method,
      cents(invoice.total),
      cents(invoice.total),
      invoice.date
    )
  }

  const delivered = (seed.workOrders ?? []).find((order: any) => order.id === 'o7')
  if (delivered?.settlement) {
    const invoiceId = 'seed_ot_invoice_o7'
    db.run(
      `INSERT OR IGNORE INTO invoices
        (id, number, type, customer_id, customer_name, order_id, subtotal_cents, discount_percent, discount_cents,
         total_cents, payment_method, status, created_by, created_at)
       VALUES (?, 'FV-000178', 'ot', ?, ?, 'o7', ?, 0, 0, ?, 'Efectivo', 'activa', 'u3', ?)`,
      invoiceId,
      delivered.customerId,
      delivered.customerName,
      cents(delivered.settlement.amount),
      cents(delivered.settlement.amount),
      delivered.settlement.paidAt
    )
    db.run(
      `INSERT INTO invoice_items
        (id, invoice_id, product_id, description, quantity, unit_price_cents, unit_cost_cents, line_total_cents, item_type)
       VALUES ('seed_ii_o7', ?, NULL, 'Mantenimiento preventivo', 1, ?, 0, ?, 'servicio')`,
      invoiceId,
      cents(delivered.settlement.amount),
      cents(delivered.settlement.amount)
    )
    db.run(
      `INSERT INTO payments
        (id, number, kind, order_id, invoice_id, method, amount_cents, received_cents, change_cents, reference,
         is_exception, created_by, created_by_name, created_at)
       VALUES ('seed_adv_o7', 'AB-000001', 'saldo', 'o7', ?, 'Efectivo', ?, ?, 0, NULL, 0, 'u3', 'Camila Restrepo', ?)`,
      invoiceId,
      cents(delivered.settlement.amount),
      cents(delivered.settlement.amount),
      delivered.settlement.paidAt
    )
  }

  // Anticipo ficticio para mostrar el libro de pagos y el saldo separado del total.
  if ((seed.workOrders ?? []).some((order: any) => order.id === 'o1')) {
    db.run(
      `INSERT INTO payments
        (id, number, kind, order_id, invoice_id, method, amount_cents, received_cents, change_cents, reference,
         is_exception, created_by, created_by_name, created_at)
       VALUES ('seed_adv_o1', 'AB-000002', 'anticipo', 'o1', NULL, 'Efectivo', ?, ?, 0, 'Anticipo al ingreso',
               0, 'u3', 'Camila Restrepo', '2026-10-23T11:20:00')`,
      cents(150000),
      cents(150000)
    )
    db.run(
      `INSERT INTO cash_movements
        (id, session_id, type, method, amount_cents, reason, reference_type, reference_id, user_id, user_name, created_at)
       VALUES ('seed_adv_cash_o1', NULL, 'ingreso', 'Efectivo', ?, 'Anticipo OT-002341 · Carlos Mendoza', 'payment', 'seed_adv_o1',
               'u3', 'Camila Restrepo', '2026-10-23T11:20:00')`,
      cents(150000)
    )
  }

  for (const purchase of seed.purchases ?? []) {
    const supplier = (seed.suppliers ?? []).find((item: any) => item.name === purchase.supplier)
    db.run(
      `INSERT OR IGNORE INTO purchases
        (id, number, supplier_id, purchase_date, item_count, subtotal_cents, iva_cents, total_cents, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'u2', ?)`,
      purchase.id,
      purchase.number,
      supplier?.id ?? 's1',
      purchase.date,
      Number(purchase.items || 1),
      cents(purchase.subtotal),
      cents(purchase.iva),
      cents(purchase.total),
      purchase.status,
      purchase.date
    )
    db.run(
      `INSERT INTO purchase_items (id, purchase_id, product_id, description, quantity, unit_price_cents)
       VALUES (?, ?, NULL, 'Compra registrada según factura de proveedor', ?, ?)`,
      `seed_purchase_item_${purchase.id}`,
      purchase.id,
      Number(purchase.items || 1),
      cents(purchase.subtotal)
    )
  }

  for (const status of STATUS_CONFIG) {
    db.run(
      `INSERT OR REPLACE INTO order_status_config
        (status, label, short_label, description, tone, position, is_terminal, requires_payment, is_cancel)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      status.status,
      status.label,
      status.shortLabel,
      status.description,
      status.tone,
      status.position,
      status.isTerminal,
      status.requiresPayment,
      status.isCancel
    )
  }

  db.setSetting('legal_config', DEFAULT_LEGAL)
  db.setSetting('print_config', DEFAULT_SETTINGS.print)
  db.setSetting('ai_config', DEFAULT_SETTINGS.ai)
  db.setSetting('security_config', DEFAULT_SETTINGS.security)
  db.setSetting('business_config', DEFAULT_SETTINGS.business)
  db.setSetting('charts_history', seed.chartData ?? [])

  db.run(
    'INSERT OR IGNORE INTO legal_versions (id, version, config_json, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
    'legal_v1',
    DEFAULT_LEGAL.version,
    JSON.stringify(DEFAULT_LEGAL),
    'u1',
    DEFAULT_LEGAL.updatedAt
  )

  const maxOrder = Math.max(
    2341,
    ...(seed.workOrders ?? []).map((order: any) => Number(String(order.number).replace(/\D/g, '')) || 0)
  )
  const maxInvoice = Math.max(
    184,
    ...(seed.invoices ?? []).map((invoice: any) => Number(String(invoice.number).replace(/\D/g, '')) || 0)
  )
  const maxCash = Math.max(184, Number(seed.currentCashTurn?.id ?? 184) || 184)
  for (const [key, value] of [
    ['order', maxOrder],
    ['invoice', maxInvoice],
    ['payment', 2],
    ['purchase', 4],
    ['cash_session', maxCash]
  ] as const) {
    db.run('INSERT OR REPLACE INTO sequences (key, value) VALUES (?, ?)', key, value)
  }

  // Cadena de auditoría inicial con hashes reales encadenados.
  const seedAudits = [
    {
      at: '2026-10-24T15:58:00',
      user: 'Andrea Salazar',
      role: 'Administrador',
      action: 'Creación de usuario',
      entity: 'Santiago Mejía',
      detail: 'Rol asignado: Técnico. Estado: activo.',
      userId: 'u2'
    },
    {
      at: '2026-10-25T08:02:00',
      user: 'Camila Restrepo',
      role: 'Cajero',
      action: 'Apertura de caja',
      entity: 'Turno #184',
      detail: 'Base inicial $200.000.',
      userId: 'u3'
    },
    {
      at: '2026-10-25T09:30:00',
      user: 'Camila Restrepo',
      role: 'Cajero',
      action: 'Inicio de sesión',
      entity: 'Sesión',
      detail: 'Acceso correcto desde el equipo de caja.',
      userId: 'u3'
    },
    {
      at: '2026-10-25T09:52:00',
      user: 'Julián Vélez',
      role: 'Técnico',
      action: 'Cambio de estado OT',
      entity: 'OT-002339',
      detail: 'En reparación → Pruebas.',
      userId: 'u4'
    },
    {
      at: '2026-10-25T10:12:00',
      user: 'Andrea Salazar',
      role: 'Administrador',
      action: 'Cambio de precio',
      entity: 'SSD-KIN-1TB',
      detail: 'Precio anterior $379.000 → $389.000.',
      userId: 'u2'
    },
    {
      at: '2026-10-25T10:44:00',
      user: 'Andrea Salazar',
      role: 'Administrador',
      action: 'Anulación de factura',
      entity: 'FV-000179',
      detail: 'Motivo: cobro duplicado. Clave de anulación verificada.',
      userId: 'u2'
    }
  ]

  for (const event of seedAudits) {
    // Reutiliza el mismo algoritmo/encadenamiento que los eventos reales.
    const prev = db.get<{ hash: string }>('SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1')?.hash ?? 'GENESIS'
    const id = `seed_${sha256(`${event.at}|${event.action}|${event.entity}`).slice(0, 16)}`
    const payload = [
      id,
      event.at,
      event.userId,
      event.user,
      event.role,
      event.action,
      event.entity,
      '',
      event.detail,
      prev
    ].join('|')
    db.run(
      `INSERT INTO audit_log
        (id, created_at, user_id, user_name, role, action, entity, entity_id, detail, prev_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      id,
      event.at,
      event.userId,
      event.user,
      event.role,
      event.action,
      event.entity,
      event.detail,
      prev,
      sha256(payload)
    )
  }

  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('seeded', '1')")
  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('seed_version', '1')")
}
