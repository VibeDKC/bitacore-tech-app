const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { DatabaseSync } = require('node:sqlite')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))

const root = process.env.BITACORETECH_TEST_ROOT || path.join(os.tmpdir(), 'bitacoretech-acceptance', '1.16.0')
const data = path.join(root, 'data')
const legacy = path.join(root, 'legacy')
const shots = path.join(root, 'shots')
const results = []

fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(shots, { recursive: true })

const RECEIPT_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
  if (!ok) process.exitCode = 1
}

function readDb() {
  return new DatabaseSync(path.join(data, 'bitacoretech.db'), { readOnly: true })
}

function countRows(sql, ...params) {
  const db = readDb()
  try {
    return Number(db.prepare(sql).get(...params)?.c ?? 0)
  } finally {
    db.close()
  }
}

function writeDb(callback) {
  const db = new DatabaseSync(path.join(data, 'bitacoretech.db'))
  try {
    callback(db)
  } finally {
    db.close()
  }
}

async function main() {
  let app
  let page
  let adminToken

  async function rpcRaw(command, payload = {}, token = adminToken) {
    return page.evaluate(
      async ({ command, payload, token }) => {
        const body = token ? { ...payload, __token: token } : payload
        return window.bitacoretech.rpc(command, body)
      },
      { command, payload, token }
    )
  }
  async function rpc(command, payload = {}, token = adminToken) {
    const response = await rpcRaw(command, payload, token)
    if (!response.ok) throw new Error(`${command}: ${response.error.code} ${response.error.message}`)
    return response.data
  }

  try {
    app = await electron.launch({
      executablePath:
        process.env.BITACORETECH_PACKAGED_EXE ||
        path.join(project, 'node_modules/electron/dist/electron.exe'),
      args: process.env.BITACORETECH_PACKAGED_EXE ? [] : ['.'],
      cwd: process.env.BITACORETECH_PACKAGED_EXE
        ? path.dirname(process.env.BITACORETECH_PACKAGED_EXE)
        : project,
      env: {
        ...process.env,
        BITACORETECH_DATA_PATH: data,
        BITACORETECH_LEGACY_DATA_PATH: legacy,
        BITACORETECH_TEST_PATHS: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      },
      timeout: 90000
    })
    page = await app.firstWindow()
    await page.getByText('Configura tu taller', { exact: true }).waitFor({ timeout: 30000 })
    await page.getByPlaceholder('Nombre y apellido').fill('Admin 1.16.0')
    await page.locator('input[placeholder="BitacoreTech"]').fill('Taller 1.16.0')
    await page.getByPlaceholder('usuario').fill('admin116')
    await page.locator('input[type="password"]').nth(0).fill('Admin12345')
    await page.locator('input[type="password"]').nth(1).fill('Admin12345')
    await page.getByRole('button', { name: 'Crear cuenta y entrar' }).click()
    await page.getByText('Ventas hoy', { exact: true }).first().waitFor({ timeout: 30000 })
    adminToken = await page.evaluate(() => sessionStorage.getItem('bitacoretech.session.token'))
    check('primer arranque y sesión', Boolean(adminToken))

    const adminSession = await rpc('auth.session')
    check(
      'administrador accede a cartera',
      adminSession.modules.includes('receivables') &&
        adminSession.permissions.includes('collectReceivables')
    )

    const cash = await rpc('cash.open', { initialAmount: 200000 })
    check('caja abierta', Boolean(cash?.id ?? cash))
    const adminUser = (await rpc('users.list')).find((user) => user.username === 'admin116')
    const dictionaries = await rpc('dictionaries.list')
    const incomeAccount = dictionaries.find(
      (node) => node.type === 'income_account' && node.name === 'Cuenta de ingresos'
    )
    if (incomeAccount) {
      await rpc('dictionaries.update', {
        id: incomeAccount.id,
        active: true,
        responsibleUserId: adminUser.id
      })
    }
    check(
      'cuenta de ingresos activa',
      Boolean((await rpc('dictionaries.list')).find((node) => node.type === 'income_account' && node.active))
    )

    await rpc('users.create', {
      name: 'Técnico 1.16.0',
      username: 'tec116',
      email: 'tec116@test.co',
      role: 'tecnico',
      password: 'Tecnico12345'
    })
    const technician = (await rpc('users.list')).find((user) => user.username === 'tec116')
    await rpc('users.create', {
      name: 'Cajero 1.16.0',
      username: 'caj116',
      email: 'caj116@test.co',
      role: 'cajero',
      password: 'Cajero12345'
    })
    const cashierLogin = await rpc('auth.login', {
      username: 'caj116',
      password: 'Cajero12345'
    })
    check(
      'cajero accede a cartera',
      cashierLogin.modules.includes('receivables') &&
        cashierLogin.permissions.includes('collectReceivables')
    )
    const techLogin = await rpc('auth.login', {
      username: 'tec116',
      password: 'Tecnico12345'
    })
    const techReceivables = await rpcRaw('receivables.list', {}, techLogin.token)
    check(
      'técnico no accede a cartera',
      !techReceivables.ok && techReceivables.error?.code === 'FORBIDDEN',
      techReceivables.error?.code
    )

    const product = await rpc('inventory.create', {
      name: 'Repuesto 1.16.0',
      price: 100000,
      cost: 60000,
      stock: 20,
      category: 'Accesorios',
      location: 'Mostrador',
      condition: 'Nuevo',
      origin: 'Proveedor',
      warrantyDays: 30,
      rotation: 'rotativo',
      alertEnabled: false,
      publishWeb: false,
      service: false
    })
    const creditCustomer = await rpc('customers.create', {
      name: 'Cliente Cartera 1.16.0',
      documentType: 'CC',
      document: '4040404040',
      phone: '3009998877',
      email: 'cartera116@test.co',
      address: 'Medellín',
      creditEnabled: true,
      creditLimit: 150000,
      creditDays: 15
    })
    check(
      'cupo y días de crédito del cliente',
      creditCustomer.creditEnabled === true &&
        creditCustomer.creditLimit === 150000 &&
        creditCustomer.creditDays === 15,
      `${creditCustomer.creditLimit} · ${creditCustomer.creditDays}`
    )

    async function createReadyOrder(unitPrice, serial) {
      const order = await rpc('orders.create', {
        customerId: creditCustomer.id,
        deviceCategory: 'laptop',
        categoryLabel: 'Laptop',
        equipmentType: 'Laptop',
        brand: 'Lenovo',
        model: 'ThinkPad',
        serial,
        technicianId: technician.id,
        reportedIssue: 'Servicio de taller',
        promisedAt: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        intake: { estimate: unitPrice },
        accessories: 'Cargador',
        physicalCondition: 'Sin observaciones'
      })
      await rpc('orders.addItem', {
        id: order.id,
        type: 'servicio',
        description: 'Mano de obra',
        quantity: 1,
        unitPrice
      })
      for (const status of ['diagnostico', 'aprobacion', 'reparacion', 'pruebas', 'listo']) {
        await rpc('orders.transition', { id: order.id, status })
      }
      const invoiced = await rpc('orders.invoice', { id: order.id })
      return { ...order, ...invoiced }
    }

    const creditOrder = await createReadyOrder(100000, 'CARTERA-116-1')
    const credited = await rpc('orders.settle', { id: creditOrder.id, credit: true })
    check(
      'entrega a crédito dentro del cupo',
      credited.status === 'entregado' &&
        credited.settlement?.status === 'credito' &&
        credited.balance === 100000,
      `${credited.status} · ${credited.balance}`
    )
    check(
      'garantía calculada para OT entregada',
      credited.warranty?.days === 90 &&
        credited.warranty?.status === 'vigente' &&
        new Date(credited.warranty.until) > new Date(credited.deliveredAt),
      JSON.stringify(credited.warranty)
    )
    const historyAfterCredit = await rpc('invoices.history')
    const creditInvoice = historyAfterCredit.find(
      (invoice) => invoice.orderId === creditOrder.id
    )
    const dueDays = Math.round(
      (new Date(creditInvoice.dueDate).getTime() - Date.now()) / 86400000
    )
    check(
      'vencimiento a 15 días',
      creditInvoice.creditAuthorized === true && dueDays >= 14 && dueDays <= 15,
      `${creditInvoice.dueDate} · ${dueDays} días`
    )

    const blockedOrder = await createReadyOrder(100000, 'CARTERA-116-2')
    const overLimit = await rpcRaw('orders.settle', {
      id: blockedOrder.id,
      credit: true
    })
    check(
      'cupo de crédito bloquea el exceso',
      !overLimit.ok && String(overLimit.error?.message ?? '').includes('cupo de crédito'),
      overLimit.error?.message
    )
    const cashPaid = await rpc('orders.settle', {
      id: blockedOrder.id,
      method: 'Efectivo',
      received: 100000
    })
    check('la OT bloqueada se puede pagar en efectivo', cashPaid.status === 'entregado')

    const cartera = await rpc('receivables.list')
    check(
      'cartera muestra la factura a crédito',
      cartera.rows.length === 1 &&
        cartera.rows[0].invoiceId === creditInvoice.id &&
        cartera.rows[0].balance === 100000 &&
        cartera.summary.total === 100000 &&
        cartera.summary.count === 1,
      JSON.stringify(cartera.summary)
    )
    check(
      'cartera clasifica el saldo al día',
      cartera.rows[0].status === 'al_dia' &&
        cartera.rows[0].bucket === 'al_dia' &&
        cartera.summary.aging.d1_30 === 0
    )
    const detailBefore = await rpc('receivables.detail', {
      invoiceId: creditInvoice.id
    })
    check('detalle de cartera sin abonos', detailBefore.payments.length === 0)

    await rpc('settings.updateSection', {
      section: 'payments',
      value: { requireReceiptForDigital: true }
    })
    const abonoWithoutReceipt = await rpcRaw('receivables.addPayment', {
      invoiceId: creditInvoice.id,
      amount: 40000,
      method: 'Transferencia'
    })
    check(
      'abono digital exige comprobante',
      !abonoWithoutReceipt.ok && abonoWithoutReceipt.error?.code === 'RECEIPT_REQUIRED',
      abonoWithoutReceipt.error?.code
    )
    const firstPayment = await rpc('receivables.addPayment', {
      invoiceId: creditInvoice.id,
      amount: 40000,
      method: 'Transferencia',
      reference: 'TRF-116',
      receipt: { dataUrl: RECEIPT_PNG, name: 'abono.png', mimeType: 'image/png' }
    })
    check('abono digital con comprobante', Boolean(firstPayment.paymentId), firstPayment.number)
    const detailAfterFirst = await rpc('receivables.detail', {
      invoiceId: creditInvoice.id
    })
    check(
      'detalle refleja el primer abono',
      detailAfterFirst.balance === 60000 &&
        detailAfterFirst.paid === 40000 &&
        detailAfterFirst.payments.length === 1 &&
        detailAfterFirst.payments[0].receipt !== null,
      `${detailAfterFirst.balance} · ${detailAfterFirst.payments.length}`
    )
    const overpay = await rpcRaw('receivables.addPayment', {
      invoiceId: creditInvoice.id,
      amount: 70000,
      method: 'Efectivo'
    })
    check('abono mayor al saldo rechazado', !overpay.ok, overpay.error?.message ?? '')
    const finalPayment = await rpc('receivables.addPayment', {
      invoiceId: creditInvoice.id,
      amount: 60000,
      method: 'Efectivo'
    })
    check('abono final en efectivo', Boolean(finalPayment.paymentId))
    const carteraPaid = await rpc('receivables.list')
    check(
      'cartera se cierra al pagar',
      carteraPaid.rows.length === 0 && carteraPaid.summary.total === 0
    )
    const paidOrder = await rpc('orders.get', { id: creditOrder.id })
    check(
      'OT a crédito queda saldada',
      paidOrder.balance === 0 &&
        paidOrder.status === 'entregado' &&
        paidOrder.settlement?.status === 'pagado',
      `${paidOrder.balance} · ${paidOrder.settlement?.status}`
    )
    check(
      'abonos registrados en caja',
      countRows(
        "SELECT COUNT(*) AS c FROM cash_movements WHERE reason LIKE 'Abono cartera%'"
      ) === 2
    )
    check(
      'abonos guardados como pagos de cartera',
      countRows(
        "SELECT COUNT(*) AS c FROM payments WHERE order_id = ? AND kind = 'saldo'",
        creditOrder.id
      ) === 2
    )
    check(
      'comprobante del abono guardado',
      countRows('SELECT COUNT(*) AS c FROM payment_receipts') >= 1
    )

    check(
      'esquema con columnas de cartera',
      (() => {
        const db = readDb()
        try {
          const version = Number(
            db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v
          )
          const customerColumns = db
            .prepare('PRAGMA table_info(customers)')
            .all()
            .map((row) => row.name)
          const invoiceColumns = db
            .prepare('PRAGMA table_info(invoices)')
            .all()
            .map((row) => row.name)
          return (
            version >= 17 &&
            customerColumns.includes('credit_limit_cents') &&
            customerColumns.includes('credit_days') &&
            invoiceColumns.includes('due_date')
          )
        } finally {
          db.close()
        }
      })()
    )

    // Garantías y abandono: se alteran fechas en la base de prueba para validar los estados.
    writeDb((db) => {
      db.prepare('UPDATE work_orders SET delivered_at = ? WHERE id = ?').run(
        new Date(Date.now() - 80 * 86400000).toISOString(),
        creditOrder.id
      )
    })
    const warrantySoon = await rpc('orders.get', { id: creditOrder.id })
    check(
      'garantía por vencer',
      warrantySoon.warranty?.status === 'por_vencer' &&
        warrantySoon.warranty?.daysLeft >= 0 &&
        warrantySoon.warranty?.daysLeft <= 30,
      JSON.stringify(warrantySoon.warranty)
    )
    writeDb((db) => {
      db.prepare('UPDATE work_orders SET delivered_at = ? WHERE id = ?').run(
        new Date(Date.now() - 120 * 86400000).toISOString(),
        creditOrder.id
      )
    })
    const warrantyExpired = await rpc('orders.get', { id: creditOrder.id })
    check(
      'garantía vencida',
      warrantyExpired.warranty?.status === 'vencida' &&
        warrantyExpired.warranty?.daysLeft < 0,
      JSON.stringify(warrantyExpired.warranty)
    )

    const openOrder = await createReadyOrder(50000, 'CARTERA-116-3')
    writeDb((db) => {
      db.prepare('UPDATE work_orders SET created_at = ? WHERE id = ?').run(
        new Date(Date.now() - 60 * 86400000).toISOString(),
        openOrder.id
      )
    })
    const abandoned = await rpc('orders.get', { id: openOrder.id })
    check(
      'OT en riesgo de abandono',
      abandoned.abandonment?.atRisk === true &&
        abandoned.abandonment?.daysLeft < 0,
      JSON.stringify(abandoned.abandonment)
    )
    const notifications = await rpc('notifications.list')
    check(
      'notificación de abandono',
      notifications.some((item) => item.id === 'orders-abandonment')
    )

    // La OT abierta se factura a crédito para probar la interfaz de cartera.
    const openOrderCredit = await rpc('orders.settle', {
      id: openOrder.id,
      credit: true
    })
    check(
      'nueva OT a crédito para la interfaz',
      openOrderCredit.status === 'entregado' && openOrderCredit.balance === 50000,
      String(openOrderCredit.balance)
    )

    await page.locator('a[href="#/ordenes"]').click()
    await page.getByRole('heading', { name: 'Órdenes de trabajo' }).waitFor({ timeout: 30000 })
    await page.getByRole('button', { name: /Garantías/ }).click()
    await page.getByText(blockedOrder.number, { exact: true }).first().waitFor({ timeout: 15000 })
    check('pestaña de garantías en taller', true)

    await page.locator('a[href="#/cartera"]').click()
    await page.getByRole('heading', { name: 'Cartera' }).waitFor({ timeout: 30000 })
    await page.getByText('Saldo total', { exact: true }).waitFor()
    await page
      .getByText('Cliente Cartera 1.16.0', { exact: true })
      .first()
      .waitFor({ timeout: 15000 })
    check('interfaz de cartera lista', true)
    await page.getByText('Cliente Cartera 1.16.0', { exact: true }).first().click()
    await page.getByText(/Cartera · FV-/).waitFor({ timeout: 15000 })
    check('detalle de cartera abierto', true)
    await page.getByRole('textbox', { name: 'Valor del abono' }).fill('20000')
    await page.getByRole('button', { name: 'Registrar abono' }).click()
    await page.getByText(/Abono .* registrado/).waitFor({ timeout: 15000 })
    check('abono registrado desde la interfaz', true)
    await page.getByText('Cerrar', { exact: true }).click()
    const uiCartera = await rpc('receivables.list')
    check(
      'interfaz actualiza el saldo de cartera',
      uiCartera.rows.length === 1 && uiCartera.rows[0].balance === 30000,
      JSON.stringify(uiCartera.summary)
    )

    await page.screenshot({ path: path.join(shots, 'cartera-1.16.0.png'), fullPage: true })
    console.log(`\nRESULT ${results.filter((item) => item.ok).length}/${results.length} OK`)
    console.log(`SHOTS ${shots}`)
  } finally {
    try {
      await app?.close()
    } catch {
      // La app ya estaba cerrada.
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
