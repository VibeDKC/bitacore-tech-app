const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))

const root = process.env.BITACORETECH_TEST_ROOT || path.join(os.tmpdir(), 'bitacoretech-acceptance', '1.8.0')
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

async function rpcRaw(page, command, payload = {}, tokenOverride) {
  return page.evaluate(
    ({ command, payload, tokenOverride }) => {
      const token =
        tokenOverride ||
        sessionStorage.getItem('bitacoretech.session.token') ||
        localStorage.getItem('bitacoretech.session.token')
      return window.bitacoretech.rpc(command, token ? { ...payload, __token: token } : payload)
    },
    { command, payload, tokenOverride }
  )
}

async function rpc(page, command, payload = {}, tokenOverride) {
  const result = await rpcRaw(page, command, payload, tokenOverride)
  if (!result.ok) throw new Error(`${command}: ${result.error.code} ${result.error.message}`)
  return result.data
}

async function launch() {
  const packagedExe = process.env.BITACORETECH_PACKAGED_EXE
  return electron.launch({
    executablePath: packagedExe || path.join(project, 'node_modules/electron/dist/electron.exe'),
    args: packagedExe ? [] : ['.'],
    cwd: packagedExe ? path.dirname(packagedExe) : project,
    env: {
      ...process.env,
      BITACORETECH_DATA_PATH: data,
      BITACORETECH_LEGACY_DATA_PATH: legacy,
      BITACORETECH_TEST_PATHS: '1',
      BITACORETECH_DISABLE_EXTERNAL: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
    },
    timeout: 90000
  })
}

function futureDate(days = 3) {
  return new Date(Date.now() + days * 86400000).toISOString()
}

async function createOrder(page, input) {
  return rpc(page, 'orders.create', {
    customerId: input.customerId,
    deviceCategory: 'laptop',
    categoryLabel: 'Portátil',
    equipmentType: 'Portátil',
    brand: 'Lenovo',
    model: 'ThinkPad 1.8',
    serial: input.serial,
    accessories: 'Cargador',
    physicalCondition: 'Sin observaciones',
    reportedIssue: input.reportedIssue,
    technicianId: input.technicianId,
    promisedAt: futureDate(),
    notes: 'OT de aceptación 1.8.0',
    intake: {
      category: 'laptop',
      categoryLabel: 'Portátil',
      estimate: input.estimate ?? 250000,
      diagnosticFee: 0,
      accessories: ['Cargador'],
      powerState: 'enciende',
      conditions: {},
      conditionNotes: '',
      lockType: 'sin_bloqueo',
      customerAuthorizesAccess: false,
      customerWithheldCredentials: false,
      ...input.intake
    }
  })
}

;(async () => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.mkdirSync(shots, { recursive: true })
  fs.mkdirSync(legacy, { recursive: true })

  const app = await launch()
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
    await page.getByPlaceholder('Nombre y apellido').fill('Owner 1.8')
    await page.locator('input[placeholder="BitacoreTech"]').fill('Taller 1.8')
    await page.getByPlaceholder('usuario').fill('owner')
    await page.getByPlaceholder('Mínimo 8 caracteres').fill('Owner12345')
    await page.getByPlaceholder('Repite la contraseña').fill('Owner12345')
    await page.getByRole('button', { name: 'Crear cuenta y entrar' }).click()
    await page.getByText('Ventas hoy', { exact: true }).first().waitFor({ timeout: 30000 })
    const ownerToken = await page.evaluate(() => sessionStorage.getItem('bitacoretech.session.token'))
    assert(ownerToken, 'No se obtuvo el token del propietario')
    pass('primer arranque 1.8.0')

    const admin = await rpc(page, 'users.create', {
      name: 'Admin 1.8',
      username: 'admin8',
      email: 'admin8@taller.co',
      role: 'admin',
      password: 'Admin12345'
    })
    const tech = await rpc(page, 'users.create', {
      name: 'Técnico 1.8',
      username: 'tec8',
      email: 'tec8@taller.co',
      role: 'tecnico',
      password: 'Tecnico12345'
    })
    const adminLogin = await rpc(page, 'auth.login', { username: 'admin8', password: 'Admin12345' })
    const techLogin = await rpc(page, 'auth.login', { username: 'tec8', password: 'Tecnico12345' })
    assert(adminLogin.permissions.includes('managePermissions'), 'El admin no recibió managePermissions')
    assert(adminLogin.permissions.includes('configureBusiness'), 'El admin no recibió configureBusiness')
    const customer = await rpc(page, 'customers.create', {
      name: 'Cliente 1.8',
      documentType: 'CC',
      document: '80808080',
      phone: '3108887799'
    })
    const product = await rpc(page, 'inventory.create', {
      name: 'Batería de prueba 1.8',
      sku: 'BAT-18-001',
      category: 'Repuestos',
      location: 'Taller',
      stock: 10,
      minStock: 1,
      cost: 30000,
      price: 60000,
      warrantyDays: 180,
      rotation: 'rotativo'
    })
    await rpc(page, 'dictionaries.create', {
      type: 'service_type',
      name: 'Mantenimiento de prueba 1.8',
      active: true
    })
    pass('usuarios, cliente, repuesto con garantía y tipo de servicio creados')

    const legalBefore = await rpc(page, 'legal.get')
    const businessUpdated = await rpc(
      page,
      'business.update',
      {
        businessName: 'Taller Admin 1.8',
        nit: '901245678',
        nitDv: '3',
        phone: '604 555 0188',
        email: 'admin@taller18.co',
        address: 'Calle 18 # 8-18',
        city: 'Medellín'
      },
      adminLogin.token
    )
    assert(businessUpdated.businessName === 'Taller Admin 1.8', 'El admin no pudo cambiar la identidad')
    assert(businessUpdated.version === legalBefore.version, 'La identidad no debe crear una versión legal')
    const legalForbidden = await rpcRaw(
      page,
      'legal.update',
      {
        abandonmentDays: 60,
        warrantyDays: 120,
        shortClauses: legalBefore.shortClauses,
        fullClauses: legalBefore.fullClauses
      },
      adminLogin.token
    )
    assert(!legalForbidden.ok, 'El admin pudo modificar las cláusulas legales')
    const regional = await rpc(
      page,
      'settings.updateSection',
      { section: 'business', value: { currency: 'COP', timezone: 'America/Bogota' } },
      adminLogin.token
    )
    assert(regional.business.currency === 'COP', 'El admin no pudo guardar la configuración regional')

    await rpc(
      page,
      'permissions.updateRole',
      { role: 'tecnico', permissions: [{ capability: 'applyDiscount', allowed: true }] },
      adminLogin.token
    )
    const techAfterGrant = await rpc(page, 'auth.login', { username: 'tec8', password: 'Tecnico12345' })
    assert(techAfterGrant.permissions.includes('applyDiscount'), 'El admin no aplicó un permiso al técnico')

    const cannotGrantNetProfit = await rpcRaw(
      page,
      'permissions.updateRole',
      { role: 'tecnico', permissions: [{ capability: 'viewNetProfit', allowed: true }] },
      adminLogin.token
    )
    assert(!cannotGrantNetProfit.ok, 'El admin concedió un permiso que su cuenta no tenía')
    const cannotGrantLegal = await rpcRaw(
      page,
      'permissions.updateRole',
      { role: 'tecnico', permissions: [{ capability: 'configureLegal', allowed: true }] },
      adminLogin.token
    )
    assert(!cannotGrantLegal.ok, 'El admin concedió un permiso exclusivo del propietario')
    const ownerCannotDelegateLegal = await rpcRaw(
      page,
      'permissions.updateRole',
      { role: 'admin', permissions: [{ capability: 'configureLegal', allowed: true }] },
      ownerToken
    )
    assert(!ownerCannotDelegateLegal.ok, 'El propietario pudo delegar un permiso exclusivo en la matriz')
    const cannotLockPermissions = await rpcRaw(
      page,
      'permissions.updateRole',
      { role: 'admin', permissions: [{ capability: 'managePermissions', allowed: false }] },
      adminLogin.token
    )
    assert(!cannotLockPermissions.ok, 'El admin pudo retirarse la gestión de permisos')

    await rpc(page, 'permissions.updateRole', {
      role: 'admin',
      permissions: [{ capability: 'viewNetProfit', allowed: true }]
    })
    await rpc(
      page,
      'permissions.updateRole',
      { role: 'tecnico', permissions: [{ capability: 'viewNetProfit', allowed: true }] },
      adminLogin.token
    )
    const techAfterNetProfit = await rpc(page, 'auth.login', { username: 'tec8', password: 'Tecnico12345' })
    assert(
      techAfterNetProfit.permissions.includes('viewNetProfit'),
      'El admin no pudo delegar un permiso que el propietario le había concedido'
    )
    await rpc(
      page,
      'permissions.updateRole',
      { role: 'admin', permissions: [{ capability: 'viewNetProfit', allowed: false }] },
      adminLogin.token
    )
    const settingsAfterAdminEdit = await rpc(page, 'settings.get', {}, adminLogin.token)
    assert(
      settingsAfterAdminEdit.rolePermissions.some(
        (item) => item.role === 'admin' && item.capability === 'viewNetProfit' && item.allowed === false
      ),
      'El admin no pudo editar la columna Administrador'
    )
    pass('permisos: admin edita roles con límites, propietario conserva exclusivos')

    const legalSaved = await rpc(
      page,
      'legal.update',
      {
        abandonmentDays: legalBefore.abandonmentDays,
        warrantyDays: legalBefore.warrantyDays,
        shortClauses: legalBefore.shortClauses,
        fullClauses: legalBefore.fullClauses
      },
      ownerToken
    )
    assert(legalSaved.version !== legalBefore.version, 'El propietario no pudo versionar las cláusulas')
    pass('negocio: identidad por admin y cláusulas por propietario')

    await page.evaluate((token) => sessionStorage.setItem('bitacoretech.session.token', token), adminLogin.token)
    await page.reload()
    await page.getByText('Ventas hoy', { exact: true }).first().waitFor({ timeout: 30000 })
    await page.getByText('Configuración', { exact: true }).first().click()
    await page.getByText('Datos del negocio', { exact: true }).first().waitFor({ timeout: 20000 })
    assert(await page.getByLabel('Nombre comercial').isEnabled(), 'El admin no puede editar la identidad')
    assert(
      await page.getByLabel(/Cláusulas cortas del ticket/).isDisabled(),
      'El admin puede editar las cláusulas legales'
    )
    await page.getByLabel('Nombre comercial').fill('Taller Admin UI 1.8')
    await page.getByRole('button', { name: 'Guardar cambios' }).first().click()
    await page.getByText('Datos del negocio actualizados', { exact: false }).first().waitFor({ timeout: 20000 })
    const legalAfterUi = await rpc(page, 'legal.get')
    assert(legalAfterUi.businessName === 'Taller Admin UI 1.8', 'La identidad no se guardó desde la interfaz')
    await page.getByText('Usuarios y roles', { exact: true }).first().click()
    await page.getByText('Matriz configurable por rol', { exact: true }).first().waitFor({ timeout: 15000 })
    assert(
      (await page.getByRole('button', { name: 'Guardar matriz' }).count()) === 1,
      'El admin no ve el guardado de la matriz'
    )
    pass('interfaz de admin: identidad editable, cláusulas bloqueadas y matriz visible')
    await page.screenshot({ path: path.join(shots, '01-admin-negocio.png') })

    await page.getByText('Órdenes de trabajo', { exact: true }).first().click()
    await page.getByRole('button', { name: 'Nueva OT' }).first().click()
    await page.getByText('Recepción de equipo', { exact: true }).first().waitFor({ timeout: 20000 })
    assert(
      (await page.getByText('Componentes internos visibles', { exact: true }).count()) === 0,
      'Sigue visible el campo de componentes internos'
    )
    await page.getByRole('button', { name: /PC Torre/ }).first().click()
    await page.getByText('Incluye discos o periféricos externos', { exact: true }).first().waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: 'Añadir disco' }).first().click()
    await page.getByLabel('Salud del disco en porcentaje').fill('87')
    const healthNa = page.getByLabel('Salud del disco N/A')
    await healthNa.check()
    assert(await page.getByLabel('Salud del disco en porcentaje').isDisabled(), 'N/A no bloquea el porcentaje')
    await healthNa.uncheck()
    await page.getByLabel('Salud del disco en porcentaje').fill('87')
    await page.getByRole('button', { name: 'Añadir módulo' }).first().click()
    assert(
      (await page.getByPlaceholder('12 meses').count()) === 0,
      'La ficha técnica sigue pidiendo garantía en componentes'
    )
    pass('recepción: sin componentes internos, salud % / N/A y sin garantía en ficha')
    await page.screenshot({ path: path.join(shots, '02-ficha-salud.png') })

    const reasonSelect = page
      .locator('select')
      .filter({ has: page.locator('option', { hasText: 'Falla de equipo' }) })
      .first()
    await reasonSelect.waitFor({ timeout: 15000 })
    assert(
      (await reasonSelect.locator('option', { hasText: 'Mantenimiento de prueba 1.8' }).count()) === 1,
      'El tipo de servicio creado en diccionarios no aparece en la OT'
    )
    await reasonSelect.selectOption('Mantenimiento preventivo')
    await page.getByText('Detalle del servicio (opcional)', { exact: true }).first().waitFor({ timeout: 15000 })
    assert(
      (await page.getByText('Falla reportada por el cliente *', { exact: true }).count()) === 0,
      'La falla sigue visible para un mantenimiento'
    )
    await reasonSelect.selectOption('__falla__')
    await page.getByText('Falla reportada por el cliente *', { exact: true }).first().waitFor({ timeout: 15000 })
    pass('recepción: falla de equipo vs. mantenimiento condicional y diccionario editable')
    await page.screenshot({ path: path.join(shots, '03-motivo-ingreso.png') })

    const healthOrder = await createOrder(page, {
      customerId: customer.id,
      serial: 'T8-HEALTH-001',
      technicianId: tech.id,
      reportedIssue: 'Prueba de salud de disco 1.8.',
      intake: {
        technicalSheet: {
          os: 'Windows 11',
          ramModules: [{ id: 'ram_1', type: 'DDR4', capacity: '8 GB', speed: '3200 MHz', brand: 'Kingston' }],
          storageDrives: [
            {
              id: 'disk_1',
              type: 'SSD M.2 NVMe',
              capacity: '512 GB',
              speed: '3000 MB/s',
              model: 'NV2',
              healthPercent: 87
            },
            {
              id: 'disk_2',
              type: 'HDD',
              capacity: '1 TB',
              speed: '7200 RPM',
              model: 'WD Blue',
              healthNotApplicable: true
            }
          ],
          battery: 'Buena'
        }
      }
    })
    const healthStored = await rpc(page, 'orders.get', { id: healthOrder.id })
    assert(
      healthStored.intake.technicalSheet.storageDrives[0].healthPercent === 87,
      'No se guardó el porcentaje de salud'
    )
    assert(
      healthStored.intake.technicalSheet.storageDrives[1].healthNotApplicable === true,
      'No se guardó la salud N/A'
    )
    const invalidHealth = await rpcRaw(page, 'orders.create', {
      customerId: customer.id,
      deviceCategory: 'laptop',
      categoryLabel: 'Portátil',
      equipmentType: 'Portátil',
      brand: 'Lenovo',
      model: 'ThinkPad 1.8',
      serial: 'T8-HEALTH-BAD',
      accessories: 'Cargador',
      physicalCondition: 'Sin observaciones',
      reportedIssue: 'Salud inválida 1.8.',
      technicianId: tech.id,
      promisedAt: futureDate(),
      intake: {
        category: 'laptop',
        categoryLabel: 'Portátil',
        estimate: 0,
        diagnosticFee: 0,
        accessories: [],
        powerState: 'enciende',
        conditions: {},
        conditionNotes: '',
        lockType: 'sin_bloqueo',
        customerAuthorizesAccess: false,
        customerWithheldCredentials: false,
        technicalSheet: {
          storageDrives: [{ id: 'disk_bad', type: 'SSD', capacity: '1 TB', healthPercent: 120 }]
        }
      }
    })
    assert(!invalidHealth.ok, 'El backend aceptó una salud de disco mayor a 100')
    pass('salud del disco: 87 %, N/A y rechazo de valores fuera de rango')

    const maintenanceOrder = await createOrder(page, {
      customerId: customer.id,
      serial: 'T8-MAINT-001',
      technicianId: tech.id,
      reportedIssue: 'Mantenimiento preventivo · Limpieza interna y revisión de ventilación',
      intake: {
        serviceKind: 'mantenimiento',
        serviceType: 'Mantenimiento preventivo',
        serviceDetail: 'Limpieza interna y revisión de ventilación'
      }
    })
    const maintenanceStored = await rpc(page, 'orders.get', { id: maintenanceOrder.id })
    assert(
      maintenanceStored.intake.serviceKind === 'mantenimiento' &&
        maintenanceStored.intake.serviceType === 'Mantenimiento preventivo',
      'No se guardó el motivo de mantenimiento'
    )

    await page.getByText('Órdenes de trabajo', { exact: true }).first().click()
    await page.getByText(healthOrder.number, { exact: true }).first().click()
    await page.getByText('Ficha técnica avanzada', { exact: true }).first().waitFor({ timeout: 15000 })
    await page.getByText(/Salud: 87%/).first().waitFor({ timeout: 15000 })
    await page.getByText(/Salud: N\/A/).first().waitFor({ timeout: 15000 })
    pass('detalle de OT muestra salud 87 % y N/A')
    await page.screenshot({ path: path.join(shots, '04-ot-salud.png') })

    await page.getByText('Órdenes de trabajo', { exact: true }).first().click()
    await page.getByText(maintenanceOrder.number, { exact: true }).first().click()
    await page.getByText('Servicio solicitado', { exact: true }).first().waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: 'Imprimir' }).first().click()
    await page.getByRole('button', { name: 'A4 · dos copias' }).first().click()
    await page.getByText('Servicio solicitado', { exact: true }).first().waitFor({ timeout: 15000 })
    pass('OT y comprobante usan “Servicio solicitado” para mantenimiento')
    await page.screenshot({ path: path.join(shots, '05-ot-mantenimiento.png') })
    await page.getByLabel('Cerrar vista previa').click()

    const warrantyOrder = await createOrder(page, {
      customerId: customer.id,
      serial: 'T8-WARRANTY-001',
      technicianId: tech.id,
      reportedIssue: 'Cambio de batería 1.8.'
    })
    let warrantyState = await rpc(page, 'orders.addItem', {
      id: warrantyOrder.id,
      type: 'repuesto',
      description: product.name,
      quantity: 1,
      unitPrice: 60000,
      productId: product.id
    })
    assert(warrantyState.items[0]?.warrantyDays === 180, 'El repuesto no heredó la garantía del producto')
    warrantyState = await rpc(page, 'orders.addItem', {
      id: warrantyOrder.id,
      type: 'servicio',
      description: 'Instalación de batería',
      quantity: 1,
      unitPrice: 20000
    })
    assert(warrantyState.items[1]?.warrantyDays === 0, 'El servicio no debe llevar garantía de repuesto')
    warrantyState = await rpc(page, 'orders.addItem', {
      id: warrantyOrder.id,
      type: 'repuesto',
      description: 'Repuesto aportado por el cliente',
      quantity: 1,
      unitPrice: 0
    })
    assert(warrantyState.items[2]?.warrantyDays === 0, 'El repuesto manual no debe llevar garantía')
    const manualWarranty = await rpcRaw(page, 'orders.addItem', {
      id: warrantyOrder.id,
      type: 'repuesto',
      description: 'Repuesto manual con garantía',
      quantity: 1,
      unitPrice: 10000,
      warrantyDays: 30
    })
    assert(!manualWarranty.ok, 'El backend aceptó garantía para un repuesto sin producto de inventario')
    pass('garantía: solo repuestos de inventario, servicios y manuales sin garantía')

    await page.getByText('Órdenes de trabajo', { exact: true }).first().click()
    await page.getByText(warrantyOrder.number, { exact: true }).first().click()
    await page.getByText('Garantía 180 días', { exact: true }).first().waitFor({ timeout: 15000 })
    pass('detalle de OT muestra la garantía del repuesto de inventario')
    await page.screenshot({ path: path.join(shots, '06-ot-garantia.png') })

    for (const status of ['diagnostico', 'aprobacion', 'reparacion', 'pruebas', 'listo']) {
      await rpc(page, 'orders.transition', { id: warrantyOrder.id, status })
    }
    const delivery = await rpc(page, 'orders.diagnosticReport', { id: warrantyOrder.id, mode: 'delivery' })
    assert(fs.existsSync(delivery.path), 'No se generó el reporte de entrega 1.8')
    assert(fs.statSync(delivery.path).size > 1000, 'El reporte de entrega está vacío')
    await rpc(page, 'cash.open', { initialAmount: 100000 })
    const settled = await rpc(page, 'orders.settle', {
      id: warrantyOrder.id,
      noCharge: true,
      exceptionReason: 'Prueba de garantía 1.8'
    })
    assert(settled.status === 'entregado', 'La OT de garantía no se entregó')
    const invoices = await rpc(page, 'invoices.list')
    const orderInvoice = invoices.find((invoice) => invoice.orderId === warrantyOrder.id)
    assert(orderInvoice, 'No se encontró la factura de la OT')
    assert(
      orderInvoice.lines.some((line) => String(line.note ?? '').includes('Garantía: 180 días')),
      'La factura A4 no incluyó la garantía del repuesto'
    )
    pass('reporte de entrega y factura A4 incluyen la garantía del repuesto')

    await app.close()
  } catch (error) {
    fail('flujo 1.8.0', error)
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
