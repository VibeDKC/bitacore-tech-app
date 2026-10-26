const path = require('node:path')
const os = require('node:os')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))
const fs = require('node:fs')

const root = process.env.BITACORETECH_TEST_ROOT || path.join(os.tmpdir(), 'bitacoretech-acceptance', 'f4-f5')
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

async function rpcRaw(page, command, payload = {}) {
  return page.evaluate(
    ({ command, payload }) => {
      const token =
        sessionStorage.getItem('bitacoretech.session.token') ||
        localStorage.getItem('bitacoretech.session.token')
      return window.bitacoretech.rpc(command, token ? { ...payload, __token: token } : payload)
    },
    { command, payload }
  )
}

async function rpc(page, command, payload = {}) {
  const result = await rpcRaw(page, command, payload)
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
      BITACORETECH_TEST_PATHS: '1',
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
    await page.getByPlaceholder('Nombre y apellido').fill('Owner T3')
    await page.locator('input[placeholder="BitacoreTech"]').fill('Taller T3')
    await page.getByPlaceholder('usuario').fill('owner')
    await page.getByPlaceholder('Mínimo 8 caracteres').fill('Owner12345')
    await page.getByPlaceholder('Repite la contraseña').fill('Owner12345')
    await page.getByRole('button', { name: 'Crear cuenta y entrar' }).click()
    await page.getByText('Ventas hoy', { exact: true }).first().waitFor({ timeout: 30000 })
    pass('primer arranque T3')

    const localToken = await page.evaluate(() => localStorage.getItem('bitacoretech.session.token'))
    const sessionToken = await page.evaluate(() => sessionStorage.getItem('bitacoretech.session.token'))
    assert(!localToken, 'El token quedó en localStorage')
    assert(sessionToken, 'El token no está en sessionStorage')
    const rememberBoxes = await page.getByText('Mantener sesión en este equipo', { exact: false }).count()
    assert(rememberBoxes === 0, 'Sigue visible el checkbox de recordar sesión')
    pass('sesión solo en sessionStorage y sin recordar')

    const invalidNit = await rpcRaw(page, 'legal.update', {
      nit: '901.245.678-9',
      nitDv: '9'
    })
    assert(!invalidNit.ok, 'Se aceptó un NIT con puntos')
    const validNit = await rpc(page, 'legal.update', { nit: '901245678', nitDv: '3' })
    assert(validNit.nit === '901245678' && validNit.nitDv === '3', 'NIT/DV no quedó normalizado')
    pass('NIT solo dígitos con DV automático')

    const invalidCustomerNit = await rpcRaw(page, 'customers.create', {
      name: 'Cliente NIT Inválido',
      documentType: 'NIT',
      document: '901.245.678'
    })
    assert(!invalidCustomerNit.ok, 'Se aceptó un NIT de cliente con puntos')
    const nitCustomer = await rpc(page, 'customers.create', {
      name: 'Cliente NIT',
      documentType: 'NIT',
      document: '901245678'
    })
    assert(nitCustomer.documentDv === '3', `DV de cliente inesperado: ${nitCustomer.documentDv}`)
    const foreignNit = await rpc(page, 'customers.create', {
      name: 'Cliente Extranjero',
      documentType: 'NIT',
      document: 'US-12345',
      isForeignDocument: true
    })
    assert(foreignNit.isForeignDocument === true, 'No se guardó el NIT extranjero')
    pass('NIT de cliente, DV y NIT extranjero')

    const tech = await rpc(page, 'users.create', {
      name: 'Tecnico Permisos',
      username: 'tecperm',
      email: 'tecperm@taller.co',
      role: 'tecnico',
      password: 'Tecnico123',
      document: '10101010',
      phone: '3000000000',
      address: 'Calle 10'
    })
    assert(tech.document === '10101010' && tech.phone === '3000000000', 'Campos de usuario no persistieron')
    const tinyPng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    const techWithPhoto = await rpc(page, 'users.update', {
      id: tech.id,
      photoDataUrl: tinyPng,
      permissions: [{ capability: 'viewCosts', allowed: true }]
    })
    assert(techWithPhoto.photoUrl, 'La foto de usuario no quedó guardada')
    assert(
      techWithPhoto.permissionOverrides?.some((item) => item.capability === 'viewCosts' && item.allowed),
      'El permiso por usuario no quedó guardado'
    )
    const techLogin = await rpcRaw(page, 'auth.login', { username: 'tecperm', password: 'Tecnico123' })
    assert(techLogin.ok && techLogin.data.permissions.includes('viewCosts'), 'La sesión del técnico no refleja el permiso')
    await rpc(page, 'permissions.updateRole', {
      role: 'tecnico',
      permissions: [{ capability: 'applyDiscount', allowed: true }]
    })
    const techLogin2 = await rpcRaw(page, 'auth.login', { username: 'tecperm', password: 'Tecnico123' })
    assert(
      techLogin2.ok && techLogin2.data.permissions.includes('applyDiscount'),
      'La matriz por rol no aplicó el permiso al técnico'
    )
    await rpc(page, 'permissions.updateRole', {
      role: 'tecnico',
      permissions: [{ capability: 'applyDiscount', allowed: false }]
    })
    pass('campos, foto, permiso por usuario y matriz por rol')

    const equipment = await rpc(page, 'equipment.create', {
      customerId: nitCustomer.id,
      category: 'laptop',
      categoryLabel: 'Portátil',
      equipmentType: 'Portátil',
      brand: 'Dell',
      model: 'Latitude T3',
      serial: 'T3-SERIAL-001',
      accessories: 'Cargador'
    })
    assert(equipment.id && equipment.serial === 'T3-SERIAL-001', 'Equipo no creado')
    const qrBefore = await rpc(page, 'equipment.qrEnabled')
    assert(qrBefore === false, 'El QR debería iniciar inactivo')
    await rpc(page, 'settings.updateSection', { section: 'equipment', value: { qrEnabled: true } })
    const qrAfter = await rpc(page, 'equipment.qrEnabled')
    assert(qrAfter === true, 'No se pudo activar el QR desde configuración')
    pass('catálogo de equipos y QR activable (inactivo por defecto)')

    const product = await rpc(page, 'inventory.create', {
      name: 'Producto Fidelidad',
      sku: 'T3-FID-001',
      category: 'Repuestos',
      stock: 10,
      minStock: 1,
      cost: 10000,
      price: 20000
    })
    const loyaltyCustomer = await rpc(page, 'customers.create', {
      name: 'Cliente Fiel T3',
      documentType: 'CC',
      document: '20202020'
    })
    await rpc(page, 'customers.update', {
      id: loyaltyCustomer.id,
      loyaltyActive: true,
      loyaltyDiscountType: 'percent',
      loyaltyDiscountValue: 50
    })
    await rpc(page, 'cash.open', { initialAmount: 100000 })
    const sale = await rpc(page, 'pos.sell', {
      customerId: loyaltyCustomer.id,
      lines: [{ productId: product.id, quantity: 1 }],
      method: 'Efectivo',
      received: 10000
    })
    assert(sale.invoice.total === 10000, `Total con fidelidad inesperado: ${sale.invoice.total}`)
    assert(sale.invoice.discount === 10000, `Descuento inesperado: ${sale.invoice.discount}`)
    pass('fidelidad automática en POS al 50 %')

    await rpc(page, 'customers.update', {
      id: loyaltyCustomer.id,
      loyaltyActive: true,
      loyaltyDiscountType: 'percent',
      loyaltyDiscountValue: 60
    })
    const belowCost = await rpcRaw(page, 'pos.sell', {
      customerId: loyaltyCustomer.id,
      lines: [{ productId: product.id, quantity: 1 }],
      method: 'Efectivo',
      received: 8000
    })
    assert(!belowCost.ok && belowCost.error.code === 'DISCOUNT_BELOW_COST', 'Se permitió vender por debajo del costo')
    pass('piso de fidelidad bloquea venta bajo costo')

    const backupPassword = await rpc(page, 'backups.setPassword', { password: 'Respaldo123' })
    assert(backupPassword.configured, 'No se configuró la contraseña de respaldo')
    const settings = await rpc(page, 'settings.get')
    assert(settings.backup.passwordConfigured === true, 'settings no reporta la contraseña de respaldo')
    const revealed = await rpc(page, 'backups.revealPassword')
    assert(revealed.password === 'Respaldo123', 'La contraseña de respaldo no se recuperó')
    pass('contraseña de respaldo cifrada y recuperable por el administrador')

    const audit = await rpc(page, 'audit.list')
    const actions = audit.map((entry) => entry.action)
    assert(actions.includes('Configuración de contraseña de respaldo'), 'Falta auditoría de contraseña de respaldo')
    assert(actions.includes('Actualización de fidelidad'), 'Falta auditoría de fidelidad')
    assert(actions.includes('Creación de equipo'), 'Falta auditoría de equipo')
    pass('auditoría de T3')

    await page.screenshot({ path: path.join(shots, '01-dashboard-t3.png') })
    await page.getByText('Configuración', { exact: true }).first().click()
    await page.getByText('Negocio', { exact: true }).first().click()
    const legalTab = await page.getByText('Legal y fiscal', { exact: true }).count()
    assert(legalTab === 0, 'Sigue existiendo la pestaña Legal y fiscal')
    await page.getByText('Cláusulas de recepción y abandono', { exact: true }).waitFor({ timeout: 15000 })
    await page.getByText('Catálogo de equipos', { exact: true }).waitFor({ timeout: 15000 })
    pass('Legal integrado en Negocio y ajustes de equipos visibles')

    await page.getByText('Usuarios y roles', { exact: true }).first().click()
    await page.getByText('Matriz configurable por rol', { exact: true }).waitFor({ timeout: 15000 })
    pass('matriz configurable por rol visible para el propietario')
    await page.screenshot({ path: path.join(shots, '03-matriz-permisos.png') })

    await page.getByText('Clientes', { exact: true }).first().click()
    await page.getByText('Cliente NIT', { exact: true }).first().click()
    await page.getByText('Equipos del cliente', { exact: true }).waitFor({ timeout: 15000 })
    await page.getByText('Dell Latitude T3', { exact: false }).first().click()
    await page.getByText('Etiqueta QR', { exact: true }).waitFor({ timeout: 15000 })
    pass('ficha de equipo y etiqueta QR visibles con la opción activa')
    await page.screenshot({ path: path.join(shots, '02-equipo-qr.png') })

    const backupPath = path.join(root, 't3.bctbackup')
    const exported = await rpc(page, 'backups.export', { path: backupPath })
    assert(exported.exported && fs.existsSync(backupPath), 'No se exportó el respaldo cifrado')
    const postBackupCustomer = await rpc(page, 'customers.create', {
      name: 'Cliente Posterior',
      documentType: 'CC',
      document: '30303030'
    })
    const imported = await rpc(page, 'backups.import', { path: backupPath })
    assert(imported.imported && imported.restored, 'No se importó el respaldo')
    const customersAfter = await rpc(page, 'customers.list')
    assert(
      !customersAfter.some((customer) => customer.id === postBackupCustomer.id),
      'La importación no restauró el estado anterior'
    )
    assert(
      customersAfter.some((customer) => customer.name === 'Cliente Fiel T3'),
      'La importación perdió datos previos'
    )
    pass('exportación e importación cifrada con restauración')
  } catch (error) {
    fail('flujo T3', error)
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
