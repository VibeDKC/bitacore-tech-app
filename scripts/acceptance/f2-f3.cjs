const path = require('node:path')
const os = require('node:os')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))
const fs = require('node:fs')

const root = process.env.BITACORETECH_TEST_ROOT || path.join(os.tmpdir(), 'bitacoretech-acceptance', 'f2-f3')
const data = path.join(root, 'data')
const legacy = path.join(root, 'legacy')
const shots = path.join(root, 'shots')
const results = []

function pass(name, extra = '') {
  results.push({ ok: true, name })
  console.log(`PASS ${name}${extra ? ' — ' + extra : ''}`)
}
function fail(name, error) {
  results.push({ ok: false, name, error: String(error?.stack || error) })
  console.log(`FAIL ${name} — ${error?.stack || error}`)
}
function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function rpc(page, command, payload = {}) {
  const result = await page.evaluate(
    ({ command, payload }) => {
      const token =
        sessionStorage.getItem('bitacoretech.session.token') ||
        localStorage.getItem('bitacoretech.session.token')
      return window.bitacoretech.rpc(command, token ? { ...payload, __token: token } : payload)
    },
    { command, payload }
  )
  if (!result.ok) throw new Error(`${command}: ${result.error.code} ${result.error.message}`)
  return result.data
}

;(async () => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.mkdirSync(shots, { recursive: true })
  fs.mkdirSync(legacy, { recursive: true })

  const app = await electron.launch({
    executablePath: path.join(project, 'node_modules/electron/dist/electron.exe'),
    args: ['.'],
    cwd: project,
    env: {
      ...process.env,
      BITACORETECH_DATA_PATH: data,
      BITACORETECH_LEGACY_DATA_PATH: legacy,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
    },
    timeout: 90000
  })

  try {
    const page = await app.firstWindow()
    page.on('pageerror', (error) => console.log('PAGEERROR', error.message))
    page.on('console', (message) => {
      if (message.type() === 'error' && !/favicon|Autofill|DevTools/i.test(message.text())) {
        console.log('CONSOLE', message.text())
      }
    })
    await page.waitForFunction(() => Boolean(window.bitacoretech), null, { timeout: 30000 })
    await page.getByText('Configura tu taller', { exact: true }).waitFor({ timeout: 20000 })
    await page.getByPlaceholder('Nombre y apellido').fill('Dave Prueba')
    await page.locator('input[placeholder="BitacoreTech"]').fill('Taller E2E')
    await page.getByPlaceholder('usuario').fill('dueno')
    await page.getByPlaceholder('correo@taller.co').fill('dueno@taller.co')
    await page.getByPlaceholder('Mínimo 8 caracteres').fill('ClaveSegura123')
    await page.getByPlaceholder('Repite la contraseña').fill('ClaveSegura123')
    await page.getByRole('button', { name: 'Crear cuenta y entrar' }).click()
    await page.getByText('Ventas hoy', { exact: true }).first().waitFor({ timeout: 30000 })
    pass('primer arranque y propietario en base limpia')

    const tech1 = await rpc(page, 'users.create', {
      name: 'Tecnico Uno',
      username: 'tec1',
      email: 'tec1@taller.co',
      role: 'tecnico',
      password: 'Tecnico123'
    })
    const tech2 = await rpc(page, 'users.create', {
      name: 'Tecnico Dos',
      username: 'tec2',
      email: 'tec2@taller.co',
      role: 'tecnico',
      password: 'Tecnico123'
    })
    const techs = await rpc(page, 'orders.technicians')
    assert(techs.length === 2, `Técnicos inesperados: ${JSON.stringify(techs)}`)
    pass('dos técnicos activos disponibles para asignación')

    await page.getByText('Compras', { exact: true }).first().click()
    await page.getByText('Compras y proveedores', { exact: true }).waitFor({ timeout: 20000 })
    await page.getByRole('button', { name: /Proveedores/ }).click()
    await page.getByRole('button', { name: 'Agregar proveedor' }).click()
    await page.getByPlaceholder('Distribuidora Andina S.A.S.').fill('Proveedor UI')
    await page.getByPlaceholder('900123456').fill('900123456')
    await page.getByPlaceholder('Nombre del vendedor').fill('Vendedor Uno')
    await page.getByPlaceholder('310 000 0000').fill('3101112233')
    await page.getByRole('button', { name: 'Crear proveedor' }).click()
    await page.getByText('Proveedor UI', { exact: true }).first().waitFor({ timeout: 20000 })
    pass('proveedor creado desde la interfaz')

    const suppliers = await rpc(page, 'suppliers.list')
    const supplier = suppliers.find((item) => item.name === 'Proveedor UI')
    assert(supplier, 'El proveedor UI no quedó en la base')
    pass('proveedor persistido en SQLite')

    await page.getByRole('button', { name: 'Editar' }).first().click()
    await page.getByPlaceholder('Nombre del vendedor').fill('Vendedor Editado')
    await page.getByRole('button', { name: 'Guardar cambios' }).click()
    await page.getByText('Vendedor Editado', { exact: false }).first().waitFor({ timeout: 15000 })
    pass('proveedor editado desde la interfaz')

    const product = await rpc(page, 'inventory.create', {
      name: 'Repuesto E2E',
      sku: 'E2E-REP-001',
      category: 'Repuestos',
      stock: 0,
      minStock: 1,
      cost: 0,
      price: 90000
    })

    const purchase = await rpc(page, 'purchases.create', {
      supplierId: supplier.id,
      number: 'FC-E2E-001',
      date: new Date().toISOString().slice(0, 10),
      status: 'recibida',
      items: [{ productId: product.id, quantity: 3, unitPrice: 50000 }]
    })
    assert(purchase.total === 178500, `Total de compra inesperado: ${purchase.total}`)
    assert(purchase.lines?.length === 1, 'La compra no devolvió sus líneas')
    const inventory = await rpc(page, 'inventory.list')
    const updatedProduct = inventory.find((item) => item.id === product.id)
    assert(updatedProduct.stock === 3, `Stock inesperado: ${updatedProduct.stock}`)
    assert(updatedProduct.cost === 50000, `Costo inesperado: ${updatedProduct.cost}`)
    pass('compra actualiza stock y costo', `stock ${updatedProduct.stock} · costo ${updatedProduct.cost}`)

    await page.reload()
    await page.getByText('Compras y proveedores', { exact: true }).waitFor({ timeout: 20000 })
    await page.getByText('FC-E2E-001', { exact: true }).first().waitFor({ timeout: 20000 })
    await page.getByText('FC-E2E-001', { exact: true }).first().click()
    await page.getByRole('button', { name: 'Imprimir comprobante' }).click()
    const receiptDialog = page.getByRole('dialog', { name: 'Comprobante de compra' })
    await receiptDialog.getByText('Comprobante interno de compra', { exact: true }).waitFor({ timeout: 15000 })
    await receiptDialog.getByText('Repuesto E2E', { exact: false }).first().waitFor({ timeout: 15000 })
    pass('comprobante de compra con detalle y líneas')
    await page.screenshot({ path: path.join(shots, '01-comprobante-compra.png') })
    await receiptDialog.getByText('Cerrar', { exact: true }).click()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    const customer = await rpc(page, 'customers.create', {
      name: 'Cliente E2E',
      documentType: 'CC',
      document: '10000001',
      phone: '3001112233',
      email: 'cliente@e2e.co',
      address: 'Calle 1 # 2-3'
    })
    const order = await rpc(page, 'orders.create', {
      customerId: customer.id,
      deviceCategory: 'laptop',
      categoryLabel: 'Portátil',
      equipmentType: 'Portátil',
      brand: 'Lenovo',
      model: 'ThinkPad E2E',
      serial: 'E2E-SERIAL-001',
      accessories: 'Cargador',
      physicalCondition: 'Sin observaciones',
      reportedIssue: 'No enciende. Prueba E2E.',
      technicianId: tech1.id,
      promisedAt: new Date(Date.now() + 3 * 86400000).toISOString(),
      notes: 'OT de aceptación',
      intake: {
        category: 'laptop',
        categoryLabel: 'Portátil',
        estimate: 450000,
        diagnosticFee: 0,
        accessories: ['Cargador'],
        powerState: 'no_enciende',
        conditions: {},
        conditionNotes: '',
        lockType: 'sin_bloqueo',
        customerAuthorizesAccess: false,
        customerWithheldCredentials: false,
        technicalSheet: {}
      }
    })
    assert(order.technician === 'Tecnico Uno', `Técnico inicial inesperado: ${order.technician}`)
    assert(order.assignments?.length === 1, `Asignaciones iniciales: ${order.assignments?.length}`)
    pass('OT creada con técnico asignado y trazabilidad inicial')

    await page.getByText('Órdenes de trabajo', { exact: true }).first().click()
    await page.getByText(order.number, { exact: true }).first().click()
    await page.getByText('Tecnico Uno', { exact: false }).first().waitFor({ timeout: 20000 })
    await page.getByRole('button', { name: 'Reasignar' }).first().click()
    await page.locator('select').selectOption(tech2.id)
    await page.getByPlaceholder('Ej. el técnico anterior quedó sin disponibilidad, el cliente pidió otro especialista…').fill('Cambio de disponibilidad')
    await page.getByRole('button', { name: 'Reasignar' }).last().click()
    await page.getByText('Tecnico Dos', { exact: false }).first().waitFor({ timeout: 20000 })
    const reassigned = await rpc(page, 'orders.get', { id: order.id })
    assert(reassigned.technician === 'Tecnico Dos', `Técnico tras reasignar: ${reassigned.technician}`)
    assert(reassigned.assignments?.length === 2, `Asignaciones tras reasignar: ${reassigned.assignments?.length}`)
    pass('reasignación de técnico desde la interfaz con historial')
    await page.screenshot({ path: path.join(shots, '02-trazabilidad-tecnico.png') })

    await rpc(page, 'orders.addItem', {
      id: order.id,
      type: 'servicio',
      description: 'Cambio de placa',
      quantity: 1,
      unitPrice: 450000,
      productId: null
    })
    await rpc(page, 'cash.open', { initialAmount: 200000 })
    await rpc(page, 'orders.addPayment', {
      id: order.id,
      amount: 100000,
      method: 'Efectivo',
      reference: 'Anticipo E2E'
    })
    for (const status of ['diagnostico', 'aprobacion', 'reparacion', 'pruebas', 'listo']) {
      await rpc(page, 'orders.transition', { id: order.id, status })
    }
    const settled = await rpc(page, 'orders.settle', {
      id: order.id,
      method: 'Efectivo',
      received: 350000
    })
    assert(settled.status === 'entregado', `Estado tras cobro: ${settled.status}`)
    assert(settled.settlement?.status === 'pagado', 'La OT no quedó pagada')
    pass('flujo OT con anticipo, estados y cobro/entrega')

    const closedReassign = await page.evaluate(
      ({ id, tech2 }) => {
        const token = sessionStorage.getItem('bitacoretech.session.token')
        return window.bitacoretech.rpc('orders.reassignTechnician', {
          id,
          technicianId: tech2,
          reason: 'Intento sobre OT cerrada',
          __token: token
        })
      },
      { id: order.id, tech2: tech2.id }
    )
    assert(!closedReassign.ok, 'Se permitió reasignar una OT cerrada')
    pass('reasignación bloqueada en OT entregada')

    const audit = await rpc(page, 'audit.list')
    const actions = audit.map((entry) => entry.action)
    assert(actions.includes('Reasignación de técnico'), 'Falta auditoría de reasignación')
    assert(actions.includes('Cobro y entrega de OT'), 'Falta auditoría de cobro/entrega')
    assert(actions.includes('Creación de proveedor'), 'Falta auditoría de proveedor')
    pass('auditoría con proveedor, reasignación y cobro')

    const dashboard = await rpc(page, 'dashboard.get')
    assert(dashboard.stats.salesToday >= 450000, `Ventas de hoy inesperadas: ${dashboard.stats.salesToday}`)
    pass('dashboard refleja la venta del día', String(dashboard.stats.salesToday))

    await page.getByText('Clientes', { exact: true }).first().click()
    await page.getByText('Cliente E2E', { exact: true }).first().click()
    await page.getByText(String(settled.invoiceNumber), { exact: true }).first().click()
    const invoiceDialog = page.getByRole('dialog', { name: new RegExp(`Factura ${settled.invoiceNumber}`) })
    await invoiceDialog.getByText('Cambio de placa', { exact: false }).first().waitFor({ timeout: 15000 })
    pass('historial de cliente abre el documento de factura')
    await invoiceDialog.getByText('Cerrar', { exact: true }).click()
    await page.getByText(order.number, { exact: true }).first().click()
    await page.getByText('Trazabilidad de técnico', { exact: true }).waitFor({ timeout: 20000 })
    pass('historial de cliente abre la OT seleccionada')

    await page.screenshot({ path: path.join(shots, '03-dashboard.png') })
  } catch (error) {
    fail('flujo integral F2/F3', error)
  } finally {
    await app.close().catch(() => {})
  }

  const failed = results.filter((item) => !item.ok)
  console.log(`\nRESULT ${results.length - failed.length}/${results.length} OK`)
  console.log('ROOT=' + root)
  if (failed.length) process.exit(1)
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
