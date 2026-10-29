const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { DatabaseSync } = require('node:sqlite')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))

const root = process.env.BITACORETECH_TEST_ROOT || path.join(os.tmpdir(), 'bitacoretech-acceptance', '1.18.0')
const data = path.join(root, 'data')
const legacy = path.join(root, 'legacy')
const shots = path.join(root, 'shots')
const results = []

fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(shots, { recursive: true })

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
  if (!ok) process.exitCode = 1
}

function openDb() {
  return new DatabaseSync(path.join(data, 'bitacoretech.db'), { readOnly: true })
}

async function main() {
  let app
  let page
  let token

  async function rpcRaw(command, payload = {}, useToken = token) {
    return page.evaluate(
      async ({ command, payload, token }) => {
        const body = token ? { ...payload, __token: token } : payload
        return window.bitacoretech.rpc(command, body)
      },
      { command, payload, token: useToken }
    )
  }
  async function rpc(command, payload = {}) {
    const response = await rpcRaw(command, payload)
    if (!response.ok) throw new Error(`${command}: ${response.error.code} ${response.error.message}`)
    return response.data
  }
  async function transitionTo(orderId, statuses) {
    let current
    for (const status of statuses) {
      current = await rpc('orders.transition', { id: orderId, status })
    }
    return current
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
    await page.getByPlaceholder('Nombre y apellido').fill('Admin 1.18.0')
    await page.locator('input[placeholder="BitacoreTech"]').fill('Taller 1.18.0')
    await page.getByPlaceholder('usuario').fill('admin118')
    await page.locator('input[type="password"]').nth(0).fill('Admin12345')
    await page.locator('input[type="password"]').nth(1).fill('Admin12345')
    await page.getByRole('button', { name: 'Crear cuenta y entrar' }).click()
    await page.getByText('Ventas hoy', { exact: true }).first().waitFor({ timeout: 30000 })
    token = await page.evaluate(() => sessionStorage.getItem('bitacoretech.session.token'))
    check('primer arranque y sesión', Boolean(token))

    await rpc('cash.open', { initialAmount: 0 })
    const admin = (await rpc('orders.technicians')).find((item) => item.name === 'Admin 1.18.0')
    check('técnico administrador disponible', Boolean(admin?.id), admin?.name)

    const customer = await rpc('customers.create', {
      name: 'Cliente Garantía 1.18',
      document: '1018181818',
      phone: '3008181818',
      email: 'garantia118@test.co',
      address: 'Medellín'
    })
    check('cliente creado', Boolean(customer.id), customer.name)

    const original = await rpc('orders.create', {
      customerId: customer.id,
      deviceCategory: 'laptop',
      categoryLabel: 'Laptop',
      equipmentType: 'Laptop',
      brand: 'Lenovo',
      model: 'ThinkPad 1.18',
      serial: 'LEN-118',
      technicianId: admin.id,
      reportedIssue: 'Mantenimiento preventivo',
      promisedAt: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      accessories: 'Cargador',
      physicalCondition: 'Sin observaciones',
      intake: { estimate: 50000, serviceKind: 'mantenimiento', serviceType: 'Mantenimiento' }
    })
    await rpc('orders.addItem', {
      id: original.id,
      type: 'servicio',
      description: 'Mantenimiento preventivo',
      quantity: 1,
      unitPrice: 50000
    })
    await transitionTo(original.id, ['diagnostico', 'aprobacion', 'reparacion', 'pruebas', 'listo'])
    const delivered = await rpc('orders.settle', {
      id: original.id,
      method: 'Efectivo',
      received: 50000
    })
    check(
      'OT original entregada con garantía',
      delivered.status === 'entregado' && Boolean(delivered.warranty?.until),
      `${delivered.status} · ${delivered.warranty?.until}`
    )

    const claim = await rpc('orders.createWarranty', {
      id: original.id,
      reason: 'El equipo funciona en el taller pero no en casa del cliente.',
      technicianId: admin.id
    })
    check(
      'reclamo de garantía vinculado',
      claim.number === 'OT-000002' &&
        claim.isWarrantyClaim === true &&
        claim.warrantyOf?.number === original.number,
      `${claim.number} · ${claim.warrantyOf?.number}`
    )
    check('reclamo sin venta', !claim.invoiceNumber && claim.total === 0, `${claim.total}`)

    const checks = await rpc('orders.updateWarranty', {
      id: claim.id,
      checks: {
        workshopTests: 'Encendido, carga, video y red estables durante 2 horas.',
        homeConditions: 'Cliente reporta que falla con el cargador de su casa.',
        result: 'sin_falla',
        recommendations: 'Probar con otro cargador y otra toma; volver si se repite.'
      }
    })
    check(
      'pruebas de garantía guardadas',
      checks.warrantyResult === 'sin_falla' &&
        checks.warrantyChecks?.workshopTests?.includes('2 horas'),
      checks.warrantyResult
    )

    await transitionTo(claim.id, ['diagnostico', 'aprobacion', 'reparacion', 'pruebas', 'listo'])
    const warrantyDelivered = await rpc('orders.deliverWarranty', { id: claim.id })
    check(
      'entrega de garantía sin cobro',
      warrantyDelivered.status === 'entregado' &&
        warrantyDelivered.settlement?.status === 'exento' &&
        !warrantyDelivered.invoiceNumber,
      `${warrantyDelivered.status} · ${warrantyDelivered.settlement?.status}`
    )

    const originalAfter = await rpc('orders.get', { id: original.id })
    check(
      'la OT original lista el reclamo',
      originalAfter.warrantyClaims?.length === 1 &&
        originalAfter.warrantyClaims[0].number === claim.number &&
        originalAfter.warrantyClaims[0].result === 'sin_falla',
      JSON.stringify(originalAfter.warrantyClaims)
    )

    const abandonOrder = await rpc('orders.create', {
      customerId: customer.id,
      deviceCategory: 'otro',
      categoryLabel: 'Equipo',
      equipmentType: 'Equipo',
      brand: 'Genérico',
      model: 'Abandono 1.18',
      serial: 'AB-118',
      technicianId: admin.id,
      reportedIssue: 'Equipo sin reclamar',
      promisedAt: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      accessories: 'Sin accesorios',
      physicalCondition: 'Sin observaciones',
      intake: { estimate: 0 }
    })
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
    {
      const db = new DatabaseSync(path.join(data, 'bitacoretech.db'))
      db.prepare('UPDATE work_orders SET created_at = ?, updated_at = ? WHERE id = ?')
        .run(oldDate, oldDate, abandonOrder.id)
      db.close()
    }
    const atRisk = await rpc('orders.get', { id: abandonOrder.id })
    check('OT marcada en riesgo de abandono', atRisk.abandonment?.atRisk === true, JSON.stringify(atRisk.abandonment))
    const abandoned = await rpc('orders.abandonToDisassembly', {
      id: abandonOrder.id,
      confirmation: abandonOrder.number,
      reason: 'Cliente no respondió después de 60 días.'
    })
    check(
      'OT cerrada como abandonada',
      abandoned.status === 'abandonado' && Boolean(abandoned.disassemblyProductId),
      `${abandoned.status} · ${abandoned.disassemblyProductId}`
    )

    const db = openDb()
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(abandoned.disassemblyProductId)
    const movement = db.prepare("SELECT * FROM stock_movements WHERE reference_id = ? AND type = 'traspaso_despiece'").get(abandonOrder.id)
    const statusConfig = db.prepare("SELECT * FROM order_status_config WHERE status = 'abandonado'").get()
    const version = Number(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v)
    const warrantyColumns = db.prepare('PRAGMA table_info(work_orders)').all().map((row) => row.name)
    const loginTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='login_attempts'").get()
    db.close()
    check(
      'producto de despiece creado',
      product?.category === 'Despiece' &&
        product?.location === 'Caja de despiece' &&
        Number(product?.stock) === 1 &&
        Number(product?.publish_web) === 0,
      product ? `${product.sku} · ${product.category} · ${product.stock}` : 'sin producto'
    )
    check('movimiento de traspaso a despiece', movement?.quantity === 1, movement?.reason)
    check('estado abandonado configurado', Boolean(statusConfig), statusConfig?.label)
    check(
      'esquema 19 con garantía y despiece',
      version === 19 &&
        warrantyColumns.includes('warranty_of_order_id') &&
        warrantyColumns.includes('warranty_checks_json') &&
        warrantyColumns.includes('disassembly_product_id') &&
        Boolean(loginTable),
      `v${version}`
    )

    await page.locator('a[href="#/ordenes"]').click()
    await page.getByText('OT-000002', { exact: true }).first().waitFor({ timeout: 30000 })
    check('lista de OT muestra el reclamo', true)
    await page.screenshot({ path: path.join(shots, 'ordenes-1.18.0.png'), fullPage: true })

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
