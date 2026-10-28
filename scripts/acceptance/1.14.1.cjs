const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))

const root = process.env.BITACORETECH_TEST_ROOT || path.join(os.tmpdir(), 'bitacoretech-acceptance', '1.14.1')
const data = path.join(root, 'data')
const legacy = path.join(root, 'legacy')
const catalogTarget = path.join(root, 'catalog-web')
const shots = path.join(root, 'shots')
const results = []

fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(shots, { recursive: true })

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
  if (!ok) process.exitCode = 1
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}

function readDb() {
  return new DatabaseSync(path.join(data, 'bitacoretech.db'), { readOnly: true })
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
    await page.getByPlaceholder('Nombre y apellido').fill('Admin 1.14.1')
    await page.locator('input[placeholder="BitacoreTech"]').fill('Taller 1.14.1')
    await page.getByPlaceholder('usuario').fill('admin1141')
    await page.locator('input[type="password"]').nth(0).fill('Admin12345')
    await page.locator('input[type="password"]').nth(1).fill('Admin12345')
    await page.getByRole('button', { name: 'Crear cuenta y entrar' }).click()
    await page.getByText('Ventas hoy', { exact: true }).first().waitFor({ timeout: 30000 })
    adminToken = await page.evaluate(() => sessionStorage.getItem('bitacoretech.session.token'))
    check('primer arranque y sesión', Boolean(adminToken))

    await rpc('settings.updateSection', {
      section: 'catalog',
      value: { targetPath: catalogTarget, autoPublish: false }
    })
    const cash = await rpc('cash.open', { initialAmount: 200000 })
    check('caja abierta', Boolean(cash?.id ?? cash))
    await rpc('users.create', {
      name: 'Técnico 1.14.1',
      username: 'tec1141',
      email: 'tec1141@test.co',
      role: 'tecnico',
      password: 'Tecnico12345'
    })
    const technician = (await rpc('users.list')).find((user) => user.username === 'tec1141')

    const product = await rpc('inventory.create', {
      name: 'Repuesto 1.14.1',
      price: 100000,
      cost: 60000,
      stock: 10,
      category: 'Accesorios',
      location: 'Mostrador',
      condition: 'Nuevo',
      origin: 'Proveedor',
      warrantyDays: 30,
      rotation: 'rotativo',
      alertEnabled: false,
      publishWeb: true,
      service: false
    })
    const posCustomer = await rpc('customers.create', {
      name: 'Cliente POS 1.14.1',
      documentType: 'CC',
      document: '1010101010',
      phone: '3001112233',
      email: 'pos1141@test.co',
      address: 'Medellín'
    })
    const posSale = await rpc('pos.sell', {
      customerId: posCustomer.id,
      lines: [{ productId: product.id, quantity: 1 }],
      method: 'Efectivo',
      received: 100000
    })
    check('venta POS registrada', Boolean(posSale.invoice?.id), posSale.invoice?.number)

    const creditCustomer = await rpc('customers.create', {
      name: 'Cliente Crédito 1.14.1',
      documentType: 'CC',
      document: '2020202020',
      phone: '3004445566',
      email: 'credito1141@test.co',
      address: 'Medellín',
      creditEnabled: true
    })
    check('cliente autorizado para crédito', creditCustomer.creditEnabled === true)

    const order = await rpc('orders.create', {
      customerId: creditCustomer.id,
      deviceCategory: 'laptop',
      categoryLabel: 'Laptop',
      equipmentType: 'Laptop',
      brand: 'Lenovo',
      model: 'ThinkPad T14',
      serial: 'T14-1141',
      technicianId: technician.id,
      reportedIssue: 'Mantenimiento y cambio de disco',
      promisedAt: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      intake: { estimate: 150000 },
      accessories: 'Cargador',
      physicalCondition: 'Sin observaciones'
    })
    check(
      'código de seguimiento no incremental',
      /^SG-[0-9A-F]{16}$/.test(order.trackingCode ?? ''),
      order.trackingCode
    )
    const secondOrder = await rpc('orders.create', {
      customerId: creditCustomer.id,
      deviceCategory: 'laptop',
      categoryLabel: 'Laptop',
      equipmentType: 'Laptop',
      brand: 'HP',
      model: 'EliteBook',
      serial: 'HP-1141',
      technicianId: technician.id,
      reportedIssue: 'Diagnóstico',
      promisedAt: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      intake: { estimate: 80000 },
      accessories: 'Cargador',
      physicalCondition: 'Sin observaciones'
    })
    check(
      'código de seguimiento único',
      secondOrder.trackingCode !== order.trackingCode,
      `${order.trackingCode} / ${secondOrder.trackingCode}`
    )

    await rpc('orders.addItem', {
      id: order.id,
      type: 'servicio',
      description: 'Diagnóstico',
      quantity: 1,
      unitPrice: 30000
    })
    await rpc('orders.addItem', {
      id: order.id,
      type: 'servicio',
      description: 'Instalación',
      quantity: 1,
      unitPrice: 20000
    })
    await rpc('orders.addItem', {
      id: order.id,
      type: 'repuesto',
      description: product.name,
      quantity: 1,
      unitPrice: 100000,
      productId: product.id
    })
    for (const status of ['diagnostico', 'aprobacion', 'reparacion', 'pruebas', 'listo']) {
      await rpc('orders.transition', { id: order.id, status })
    }
    const invoiced = await rpc('orders.invoice', { id: order.id })
    check('OT facturada sin entregar', Boolean(invoiced.invoiceNumber) && invoiced.status === 'listo')
    check('saldo facturado', invoiced.balance === 150000, String(invoiced.balance))

    const db = readDb()
    const invoiceRow = db
      .prepare("SELECT * FROM invoices WHERE order_id = ? AND status = 'activa'")
      .get(order.id)
    const invoiceItems = db
      .prepare('SELECT description, quantity, unit_price_cents, item_type FROM invoice_items WHERE invoice_id = ? ORDER BY rowid')
      .all(invoiceRow.id)
    db.close()
    check(
      'mano de obra consolidada en una línea',
      invoiceItems.filter((item) => item.description === 'Mano de obra').length === 1 &&
        invoiceItems.find((item) => item.description === 'Mano de obra')?.unit_price_cents === 5000000
    )
    check(
      'repuesto conserva su línea',
      invoiceItems.filter((item) => item.item_type === 'repuesto').length === 1
    )

    const unpaid = await rpcRaw('orders.settle', {
      id: order.id,
      method: 'Efectivo',
      received: 0
    })
    check('no se entrega sin recibir el dinero', !unpaid.ok, unpaid.error?.message ?? '')

    const paid = await rpc('orders.settle', {
      id: order.id,
      method: 'Efectivo',
      received: 150000
    })
    check('entrega con pago completo', paid.status === 'entregado' && paid.balance === 0)

    await rpc('orders.addItem', {
      id: secondOrder.id,
      type: 'servicio',
      description: 'Mano de obra crédito',
      quantity: 1,
      unitPrice: 80000
    })
    for (const status of ['diagnostico', 'aprobacion', 'reparacion', 'pruebas', 'listo']) {
      await rpc('orders.transition', { id: secondOrder.id, status })
    }
    const creditInvoice = await rpc('orders.invoice', { id: secondOrder.id })
    check('OT a crédito facturada', Boolean(creditInvoice.invoiceNumber))
    const creditAttempt = await rpcRaw('orders.settle', {
      id: secondOrder.id,
      method: 'Efectivo',
      received: 0
    })
    check('crédito no salta el pago sin autorización', !creditAttempt.ok)
    const creditDelivered = await rpc('orders.settle', {
      id: secondOrder.id,
      credit: true
    })
    check(
      'entrega a crédito autorizada',
      creditDelivered.status === 'entregado' &&
        creditDelivered.settlement?.status === 'credito' &&
        creditDelivered.balance === 80000
    )

    const report = await rpc('reports.summary', { period: '30d' })
    check('reporte separa ventas POS', report.salesPos >= 100000, String(report.salesPos))
    check('reporte separa ventas OT', report.salesOt >= 230000, String(report.salesOt))

    await rpc('catalog.publish')
    const portal = JSON.parse(
      fs.readFileSync(path.join(catalogTarget, 'data', 'orders-demo.json'), 'utf8')
    )
    const published = portal.orders.find((item) => item.number === order.number)
    check(
      'portal publica hash y no el código',
      Boolean(published?.codeHash) &&
        published.codeHash === sha256(order.trackingCode) &&
        !JSON.stringify(published).includes(order.trackingCode)
    )

    const adminPurge = await rpcRaw('backups.purge', {
      confirmation: 'PURGAR',
      password: 'Admin12345',
      scope: 'operation'
    })
    check('admin no puede purgar', !adminPurge.ok, adminPurge.error?.message ?? '')

    const ownerPassword = process.env.BITACORETECH_OWNER_PASSWORD
    if (ownerPassword) {
      const ownerLogin = await rpcRaw(
        'auth.login',
        { username: 'propietario', password: ownerPassword },
        undefined
      )
      check('propietario inicia sesión', ownerLogin.ok, ownerLogin.error?.message ?? '')
      if (ownerLogin.ok) {
        const purged = await rpcRaw(
          'backups.purge',
          {
            confirmation: 'PURGAR',
            password: ownerPassword,
            scope: 'operation',
            publishCatalog: false
          },
          ownerLogin.data.token
        )
        check('purga operativa completada', purged.ok, purged.error?.message ?? '')
        const after = readDb()
        const counts = {
          orders: after.prepare('SELECT COUNT(*) AS c FROM work_orders').get().c,
          invoices: after.prepare('SELECT COUNT(*) AS c FROM invoices').get().c,
          products: after.prepare('SELECT COUNT(*) AS c FROM products').get().c,
          customers: after.prepare('SELECT COUNT(*) AS c FROM customers').get().c
        }
        after.close()
        check(
          'purga conserva inventario y clientes',
          counts.orders === 0 &&
            counts.invoices === 0 &&
            counts.products > 0 &&
            counts.customers > 0,
          JSON.stringify(counts)
        )
      }
    }

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
