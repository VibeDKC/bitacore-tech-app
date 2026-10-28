const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { DatabaseSync } = require('node:sqlite')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))

const root = process.env.BITACORETECH_TEST_ROOT || path.join(os.tmpdir(), 'bitacoretech-acceptance', '1.15.0')
const data = path.join(root, 'data')
const legacy = path.join(root, 'legacy')
const shots = path.join(root, 'shots')
const results = []

fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(shots, { recursive: true })

// PNG 1x1 válido para probar el adjunto de comprobantes.
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
    await page.getByPlaceholder('Nombre y apellido').fill('Admin 1.15.0')
    await page.locator('input[placeholder="BitacoreTech"]').fill('Taller 1.15.0')
    await page.getByPlaceholder('usuario').fill('admin115')
    await page.locator('input[type="password"]').nth(0).fill('Admin12345')
    await page.locator('input[type="password"]').nth(1).fill('Admin12345')
    await page.getByRole('button', { name: 'Crear cuenta y entrar' }).click()
    await page.getByText('Ventas hoy', { exact: true }).first().waitFor({ timeout: 30000 })
    adminToken = await page.evaluate(() => sessionStorage.getItem('bitacoretech.session.token'))
    check('primer arranque y sesión', Boolean(adminToken))

    const initialSettings = await rpc('settings.get')
    check(
      'comprobante digital desactivado por defecto',
      initialSettings.payments?.requireReceiptForDigital === false
    )
    const requirements = await rpc('payments.requirements')
    check('requisito de comprobante consultable', requirements.requireReceiptForDigital === false)

    const cash = await rpc('cash.open', { initialAmount: 200000 })
    check('caja abierta', Boolean(cash?.id ?? cash))

    await rpc('users.create', {
      name: 'Técnico 1.15.0',
      username: 'tec115',
      email: 'tec115@test.co',
      role: 'tecnico',
      password: 'Tecnico12345'
    })
    const technician = (await rpc('users.list')).find((user) => user.username === 'tec115')
    const adminUser = (await rpc('users.list')).find((user) => user.username === 'admin115')
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
    const activeIncome = (await rpc('dictionaries.list')).find(
      (node) => node.type === 'income_account' && node.active
    )
    check('cuenta de ingresos activa', Boolean(activeIncome), activeIncome?.name)

    const product = await rpc('inventory.create', {
      name: 'Repuesto 1.15.0',
      price: 70000,
      cost: 40000,
      stock: 10,
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

    const quickCustomer = await rpc('customers.create', {
      name: 'Cliente rápido 1.15.0',
      documentType: 'CC'
    })
    check(
      'cliente rápido sin documento ni teléfono',
      quickCustomer.name === 'Cliente rápido 1.15.0' &&
        quickCustomer.documentMissing === true,
      quickCustomer.document
    )

    const serviceOnly = await rpc('pos.sell', {
      customerId: quickCustomer.id,
      lines: [],
      manualLines: [
        {
          description: 'Mantenimiento preventivo',
          quantity: 2,
          unitPrice: 50000,
          warrantyDays: 30,
          note: 'Incluye limpieza'
        }
      ],
      method: 'Efectivo',
      received: 100000
    })
    check(
      'venta POS solo con servicio manual',
      serviceOnly.invoice?.total === 100000 &&
        serviceOnly.receipt?.total === 100000,
      `${serviceOnly.invoice?.number} · ${serviceOnly.invoice?.total}`
    )
    const serviceLine = serviceOnly.receipt?.lines?.[0]
    check(
      'servicio manual en el comprobante',
      serviceLine?.name === 'Mantenimiento preventivo' &&
        serviceLine?.productId === null &&
        serviceLine?.quantity === 2 &&
        serviceLine?.lineTotal === 100000,
      JSON.stringify(serviceLine)
    )
    check(
      'garantía y nota del servicio manual',
      String(serviceLine?.note ?? '').includes('Garantía: 30 días') &&
        String(serviceLine?.note ?? '').includes('Incluye limpieza'),
      serviceLine?.note
    )

    const serviceInvoiceId = serviceOnly.invoice.id
    const serviceDb = readDb()
    const serviceItems = serviceDb
      .prepare(
        'SELECT product_id, description, item_type, unit_price_cents, line_total_cents FROM invoice_items WHERE invoice_id = ?'
      )
      .all(serviceInvoiceId)
    serviceDb.close()
    check(
      'línea manual sin producto de inventario',
      serviceItems.length === 1 &&
        serviceItems[0].product_id === null &&
        serviceItems[0].item_type === 'servicio' &&
        serviceItems[0].unit_price_cents === 5000000 &&
        serviceItems[0].line_total_cents === 10000000,
      JSON.stringify(serviceItems)
    )
    check(
      'servicio manual no mueve stock',
      countRows(
        "SELECT COUNT(*) AS c FROM stock_movements WHERE reference_type = 'invoice' AND reference_id = ?",
        serviceInvoiceId
      ) === 0
    )

    const mixedSale = await rpc('pos.sell', {
      customerId: quickCustomer.id,
      lines: [{ productId: product.id, quantity: 1 }],
      manualLines: [
        { description: 'Diagnóstico express', quantity: 1, unitPrice: 30000 }
      ],
      method: 'Efectivo',
      received: 100000
    })
    check(
      'venta mixta producto y servicio',
      mixedSale.invoice?.total === 100000 && mixedSale.receipt?.lines?.length === 2,
      String(mixedSale.invoice?.total)
    )
    const mixedDb = readDb()
    const mixedItems = mixedDb
      .prepare(
        'SELECT product_id, description, item_type FROM invoice_items WHERE invoice_id = ? ORDER BY rowid'
      )
      .all(mixedSale.invoice.id)
    const stock = mixedDb
      .prepare('SELECT stock FROM products WHERE id = ?')
      .get(product.id)
    mixedDb.close()
    check(
      'venta mixta descuenta solo el producto',
      stock.stock === 9 &&
        mixedItems.length === 2 &&
        mixedItems[0].product_id === product.id &&
        mixedItems[1].product_id === null &&
        mixedItems[1].item_type === 'servicio',
      JSON.stringify({ stock: stock.stock, mixedItems })
    )

    const emptySale = await rpcRaw('pos.sell', {
      customerId: quickCustomer.id,
      lines: [],
      manualLines: [],
      method: 'Efectivo',
      received: 0
    })
    check('venta sin líneas rechazada', !emptySale.ok, emptySale.error?.message ?? '')
    const zeroPrice = await rpcRaw('pos.sell', {
      customerId: quickCustomer.id,
      lines: [],
      manualLines: [{ description: 'Servicio inválido', quantity: 1, unitPrice: 0 }],
      method: 'Efectivo',
      received: 0
    })
    check('servicio manual sin valor rechazado', !zeroPrice.ok, zeroPrice.error?.message ?? '')
    check(
      'venta inválida no crea facturas',
      countRows('SELECT COUNT(*) AS c FROM invoices') === 2
    )

    // Interfaz POS: atajos, cliente rápido y venta de servicio.
    await page.locator('a[href="#/pos"]').click()
    await page.getByRole('heading', { name: 'Punto de venta' }).waitFor({ timeout: 30000 })

    await page.keyboard.press('F1')
    const focusedPlaceholder = await page.evaluate(
      () => document.activeElement?.getAttribute('placeholder') ?? ''
    )
    check('F1 enfoca el buscador', focusedPlaceholder.includes('Buscar por nombre'))

    const search = page.getByPlaceholder(/Buscar por nombre/)
    await search.fill('zzz')
    await page.keyboard.press('Escape')
    check('Escape limpia la búsqueda', (await search.inputValue()) === '')

    await page.keyboard.press('F2')
    await page.getByRole('heading', { name: 'Nuevo cliente' }).waitFor()
    check('F2 abre cliente rápido', true)
    await page.getByPlaceholder('Nombre o razón social').fill('Cliente UI 1.15.0')
    await page.getByRole('button', { name: 'Guardar cliente' }).click()
    await page.getByText('Cliente creado', { exact: true }).waitFor({ timeout: 15000 })
    const selectedCustomer = await page
      .locator('select')
      .evaluateAll((selects) =>
        selects.some((select) =>
          Array.from(select.options).some((option) => option.text.includes('Cliente UI 1.15.0'))
        )
      )
    check('cliente rápido disponible en el POS', selectedCustomer)

    await page.keyboard.press('F3')
    await page.getByRole('heading', { name: 'Facturar servicio' }).waitFor()
    check('F3 abre facturación de servicio', true)
    await page
      .getByPlaceholder('Ej. Mantenimiento preventivo de portátil')
      .fill('Servicio UI 1.15.0')
    await page.getByRole('textbox', { name: 'Valor del servicio *' }).fill('45000')
    await page.getByRole('button', { name: 'Añadir al carrito' }).click()
    await page.getByText('Servicio UI 1.15.0', { exact: true }).waitFor()
    check('servicio manual visible en el carrito', true)

    await page.keyboard.press('F5')
    await page.getByRole('heading', { name: 'Cobrar venta' }).waitFor()
    check('F5 abre el cobro', true)
    await page.getByRole('button', { name: 'Confirmar pago' }).click()
    await page.getByText('Comprobante de venta', { exact: true }).waitFor({ timeout: 15000 })
    check('venta de servicio confirmada desde el POS', true)
    await page.getByRole('button', { name: 'Cerrar vista previa' }).click()
    await page.keyboard.press('F9')
    await page.getByText('Comprobante de venta', { exact: true }).waitFor()
    check('F9 reimprime la última venta', true)
    await page.getByRole('button', { name: 'Cerrar vista previa' }).click()

    const uiSaleDb = readDb()
    const uiInvoice = uiSaleDb
      .prepare("SELECT id, total_cents FROM invoices WHERE customer_name = 'Cliente UI 1.15.0' ORDER BY created_at DESC LIMIT 1")
      .get()
    const uiItems = uiInvoice
      ? uiSaleDb
          .prepare('SELECT product_id, description, item_type, line_total_cents FROM invoice_items WHERE invoice_id = ?')
          .all(uiInvoice.id)
      : []
    uiSaleDb.close()
    check(
      'venta UI guarda el servicio manual',
      uiInvoice?.total_cents === 4500000 &&
        uiItems.length === 1 &&
        uiItems[0].product_id === null &&
        uiItems[0].description === 'Servicio UI 1.15.0' &&
        uiItems[0].item_type === 'servicio',
      JSON.stringify({ uiInvoice, uiItems })
    )

    // Comprobante obligatorio en cobros digitales.
    const updated = await rpc('settings.updateSection', {
      section: 'payments',
      value: { requireReceiptForDigital: true }
    })
    check(
      'configuración de comprobante obligatorio',
      updated.payments?.requireReceiptForDigital === true
    )
    const requirementsOn = await rpc('payments.requirements')
    check('requisito activo consultable', requirementsOn.requireReceiptForDigital === true)

    const invoicesBefore = countRows('SELECT COUNT(*) AS c FROM invoices')
    const transferWithout = await rpcRaw('pos.sell', {
      customerId: quickCustomer.id,
      lines: [{ productId: product.id, quantity: 1 }],
      method: 'Transferencia'
    })
    check(
      'POS exige comprobante en transferencia',
      !transferWithout.ok && transferWithout.error?.code === 'RECEIPT_REQUIRED',
      transferWithout.error?.code
    )
    const cardWithout = await rpcRaw('pos.sell', {
      customerId: quickCustomer.id,
      lines: [{ productId: product.id, quantity: 1 }],
      method: 'Tarjeta'
    })
    check(
      'POS exige comprobante en tarjeta',
      !cardWithout.ok && cardWithout.error?.code === 'RECEIPT_REQUIRED',
      cardWithout.error?.code
    )
    check(
      'cobros rechazados no crean facturas',
      countRows('SELECT COUNT(*) AS c FROM invoices') === invoicesBefore
    )

    const transferWith = await rpc('pos.sell', {
      customerId: quickCustomer.id,
      lines: [{ productId: product.id, quantity: 1 }],
      method: 'Transferencia',
      receipt: { dataUrl: RECEIPT_PNG, name: 'soporte.png', mimeType: 'image/png' }
    })
    check(
      'POS acepta transferencia con comprobante',
      Boolean(transferWith.invoice?.id),
      transferWith.invoice?.number
    )
    check(
      'comprobante del POS guardado',
      countRows('SELECT COUNT(*) AS c FROM payment_receipts') >= 1
    )

    const cashWithout = await rpc('pos.sell', {
      customerId: quickCustomer.id,
      lines: [{ productId: product.id, quantity: 1 }],
      method: 'Efectivo',
      received: 70000
    })
    check('efectivo no exige comprobante', Boolean(cashWithout.invoice?.id))

    // Comprobante obligatorio en anticipos y entrega de OT.
    const orderCustomer = await rpc('customers.create', {
      name: 'Cliente OT 1.15.0',
      documentType: 'CC',
      document: '3030303030',
      phone: '3007778899',
      email: 'ot115@test.co',
      address: 'Medellín'
    })
    const order = await rpc('orders.create', {
      customerId: orderCustomer.id,
      deviceCategory: 'laptop',
      categoryLabel: 'Laptop',
      equipmentType: 'Laptop',
      brand: 'Lenovo',
      model: 'ThinkPad T14',
      serial: 'T14-1150',
      technicianId: technician.id,
      reportedIssue: 'Mantenimiento',
      promisedAt: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      intake: { estimate: 100000 },
      accessories: 'Cargador',
      physicalCondition: 'Sin observaciones'
    })
    await rpc('orders.addItem', {
      id: order.id,
      type: 'servicio',
      description: 'Mano de obra',
      quantity: 1,
      unitPrice: 100000
    })
    for (const status of ['diagnostico', 'aprobacion', 'reparacion', 'pruebas', 'listo']) {
      await rpc('orders.transition', { id: order.id, status })
    }
    await rpc('orders.invoice', { id: order.id })

    const paymentsBefore = countRows('SELECT COUNT(*) AS c FROM payments')
    const depositWithout = await rpcRaw('orders.addPayment', {
      id: order.id,
      amount: 40000,
      method: 'Transferencia'
    })
    check(
      'OT exige comprobante en anticipo digital',
      !depositWithout.ok && depositWithout.error?.code === 'RECEIPT_REQUIRED',
      depositWithout.error?.code
    )
    check(
      'anticipo rechazado no crea pagos',
      countRows('SELECT COUNT(*) AS c FROM payments') === paymentsBefore
    )

    const depositWith = await rpc('orders.addPayment', {
      id: order.id,
      amount: 40000,
      method: 'Transferencia',
      receipt: { dataUrl: RECEIPT_PNG, name: 'anticipo.png', mimeType: 'image/png' }
    })
    check(
      'OT acepta anticipo con comprobante',
      depositWith.balance === 60000,
      String(depositWith.balance)
    )

    const settleWithout = await rpcRaw('orders.settle', {
      id: order.id,
      method: 'Tarjeta'
    })
    check(
      'OT exige comprobante al entregar con tarjeta',
      !settleWithout.ok && settleWithout.error?.code === 'RECEIPT_REQUIRED',
      settleWithout.error?.code
    )
    const settled = await rpc('orders.settle', {
      id: order.id,
      method: 'Tarjeta',
      receipt: { dataUrl: RECEIPT_PNG, name: 'entrega.png', mimeType: 'image/png' }
    })
    check(
      'OT entrega con tarjeta y comprobante',
      settled.status === 'entregado' && settled.balance === 0,
      `${settled.status} · ${settled.balance}`
    )
    check(
      'comprobantes de OT guardados',
      countRows(
        "SELECT COUNT(*) AS c FROM payment_receipts pr JOIN payments p ON p.id = pr.payment_id WHERE p.order_id = ?",
        order.id
      ) === 2
    )

    const off = await rpc('settings.updateSection', {
      section: 'payments',
      value: { requireReceiptForDigital: false }
    })
    check(
      'comprobante digital se puede desactivar',
      off.payments?.requireReceiptForDigital === false
    )
    const transferOff = await rpc('pos.sell', {
      customerId: quickCustomer.id,
      lines: [{ productId: product.id, quantity: 1 }],
      method: 'Transferencia'
    })
    check('sin la regla se permite transferencia sin soporte', Boolean(transferOff.invoice?.id))

    await rpc('users.create', {
      name: 'Cajero 1.15.0',
      username: 'caj115',
      email: 'caj115@test.co',
      role: 'cajero',
      password: 'Cajero12345'
    })
    const cashierLogin = await rpc('auth.login', {
      username: 'caj115',
      password: 'Cajero12345'
    })
    const cashierRequirements = await rpcRaw(
      'payments.requirements',
      {},
      cashierLogin.token
    )
    check(
      'cajero consulta requisitos de cobro',
      cashierRequirements.ok &&
        typeof cashierRequirements.data?.requireReceiptForDigital === 'boolean'
    )
    const cashierUpdate = await rpcRaw(
      'settings.updateSection',
      { section: 'payments', value: { requireReceiptForDigital: true } },
      cashierLogin.token
    )
    check('cajero no cambia la regla de comprobantes', !cashierUpdate.ok)

    await page.screenshot({ path: path.join(shots, 'pos-1.15.0.png'), fullPage: true })
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
