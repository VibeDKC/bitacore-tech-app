const path = require('node:path')
const os = require('node:os')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))
const fs = require('node:fs')

const root = process.env.BITACORETECH_TEST_ROOT || path.join(os.tmpdir(), 'bitacoretech-acceptance', '1.5.0')
const data = path.join(root, 'data')
const legacy = path.join(root, 'legacy')
const shots = path.join(root, 'shots')
const results = []
const tinyPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

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
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
    },
    timeout: 90000
  })
}

;(async () => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.mkdirSync(shots, { recursive: true })
  fs.mkdirSync(legacy, { recursive: true })

  let app = await launch()
  let closed = false

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
    await page.getByPlaceholder('Nombre y apellido').fill('Owner T4')
    await page.locator('input[placeholder="BitacoreTech"]').fill('Taller T4')
    await page.getByPlaceholder('usuario').fill('owner')
    await page.getByPlaceholder('Mínimo 8 caracteres').fill('Owner12345')
    await page.getByPlaceholder('Repite la contraseña').fill('Owner12345')
    await page.getByRole('button', { name: 'Crear cuenta y entrar' }).click()
    await page.getByText('Ventas hoy', { exact: true }).first().waitFor({ timeout: 30000 })
    pass('primer arranque 1.5.0')

    const ownerToken = await page.evaluate(() => sessionStorage.getItem('bitacoretech.session.token'))
    assert(ownerToken, 'No se obtuvo el token del propietario')
    const owner = await rpc(page, 'auth.session')

    const testProduct = await rpc(page, 'inventory.create', {
      name: 'Referencia de prueba 1.5',
      sku: 'T4-PRUEBA-001',
      category: 'Repuestos',
      stock: 4,
      minStock: 10,
      cost: 10000,
      price: 25000,
      rotation: 'prueba',
      alertEnabled: false
    })
    assert(testProduct.rotation === 'prueba', `Rotación inesperada: ${testProduct.rotation}`)
    assert(testProduct.alertEnabled === false, 'La referencia de prueba no debería generar alerta')
    const inventoryList = await rpc(page, 'inventory.list')
    const testInList = inventoryList.find((item) => item.id === testProduct.id)
    assert(testInList && testInList.alertEnabled === false, 'inventory.list no conserva alertEnabled')
    pass('inventario: referencia de prueba sin alerta')

    const updated = await rpc(page, 'inventory.update', {
      id: testProduct.id,
      name: 'Referencia rotativa 1.5',
      price: 32000,
      minStock: 2,
      rotation: 'rotativo',
      alertEnabled: true
    })
    assert(updated.name === 'Referencia rotativa 1.5' && updated.price === 32000, 'No se actualizó la referencia')
    assert(updated.alertEnabled === true && updated.rotation === 'rotativo', 'No se actualizaron alerta/rotación')

    const admin = await rpc(page, 'users.create', {
      name: 'Admin Foto T4',
      username: 'adminfoto',
      email: 'adminfoto@taller.co',
      role: 'admin',
      password: 'Admin12345',
      document: '40404040',
      phone: '3000000000'
    })
    const tech = await rpc(page, 'users.create', {
      name: 'Tecnico T4',
      username: 'tecnico4',
      email: 'tecnico4@taller.co',
      role: 'tecnico',
      password: 'Tecnico12345',
      document: '50505050'
    })
    const adminLogin = await rpc(page, 'auth.login', { username: 'adminfoto', password: 'Admin12345' })
    const adminToken = adminLogin.token
    const techLogin = await rpc(page, 'auth.login', { username: 'tecnico4', password: 'Tecnico12345' })
    const techToken = techLogin.token

    const ownerPhoto = await rpc(page, 'users.updatePhoto', { id: owner.user.id, photoDataUrl: tinyPng }, adminToken)
    assert(ownerPhoto.photoUrl, 'El admin no pudo guardar la foto del propietario')
    const adminPhoto = await rpc(page, 'users.updatePhoto', { id: admin.id, photoDataUrl: tinyPng }, adminToken)
    assert(adminPhoto.photoUrl, 'El admin no pudo guardar su propia foto')
    const forbiddenOwnerEdit = await rpcRaw(page, 'users.update', { id: owner.user.id, name: 'Owner alterado' }, adminToken)
    assert(!forbiddenOwnerEdit.ok, 'El admin pudo editar la ficha completa del propietario')
    const adminInventoryUpdate = await rpc(page, 'inventory.update', { id: testProduct.id, price: 35000 }, adminToken)
    assert(adminInventoryUpdate.price === 35000, 'El admin no pudo editar la referencia')
    const techInventoryUpdate = await rpcRaw(page, 'inventory.update', { id: testProduct.id, price: 99999 }, techToken)
    assert(!techInventoryUpdate.ok, 'El técnico pudo editar una referencia de inventario')
    pass('permisos: admin edita inventario y foto; técnico no edita referencias')

    const service = await rpc(page, 'inventory.create', {
      name: 'Mantenimiento de servidores',
      sku: 'T4-SERV-001',
      category: 'Servicios',
      price: 90000,
      service: true,
      rotation: 'no_rotativo',
      alertEnabled: false
    })
    const customer = await rpc(page, 'customers.create', {
      name: 'Cliente Historial T4',
      documentType: 'CC',
      document: '60606060',
      phone: '3101112233'
    })
    await rpc(page, 'cash.open', { initialAmount: 100000 })
    const note = 'Cambio de pasta térmica y limpieza interna del servidor'
    const sale = await rpc(page, 'pos.sell', {
      customerId: customer.id,
      lines: [{ productId: service.id, quantity: 1, note }],
      method: 'Efectivo',
      received: 90000
    })
    assert(sale.invoice.lines?.[0]?.note === note, 'La nota del servicio no quedó en la factura')
    assert(sale.receipt.lines?.[0]?.note === note, 'La nota del servicio no quedó en el comprobante')
    const history = await rpc(page, 'invoices.history')
    assert(history.some((invoice) => invoice.id === sale.invoice.id), 'La venta no aparece en invoices.history')
    pass('POS: nota de servicio en factura, comprobante e historial')

    const order = await rpc(page, 'orders.create', {
      customerId: customer.id,
      deviceCategory: 'laptop',
      categoryLabel: 'Portátil',
      equipmentType: 'Portátil',
      brand: 'Lenovo',
      model: 'ThinkPad T4',
      serial: 'T4-SERIAL-001',
      accessories: 'Cargador',
      physicalCondition: 'Sin observaciones',
      reportedIssue: 'No enciende. Prueba de términos 1.5.0.',
      technicianId: tech.id,
      promisedAt: new Date(Date.now() + 3 * 86400000).toISOString(),
      notes: 'OT de aceptación 1.5.0',
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

    await page.getByText('Punto de venta', { exact: true }).first().click()
    await page.getByText('Historial de ventas', { exact: true }).first().click()
    await page.getByText(sale.invoice.number, { exact: true }).first().waitFor({ timeout: 15000 })
    pass('historial de ventas visible en POS')
    await page.screenshot({ path: path.join(shots, '05-historial-ventas.png') })

    await page.getByLabel(`Reimprimir ${sale.invoice.number}`).click()
    await page.getByText('Comprobante de venta', { exact: true }).waitFor({ timeout: 15000 })
    assert((await page.getByText(note, { exact: false }).count()) === 0, 'La nota del servicio apareció en el ticket de 80 mm')
    await page.getByRole('button', { name: 'A4 · dos copias' }).first().click()
    await page.getByText(note, { exact: false }).first().waitFor({ timeout: 15000 })
    pass('nota de servicio solo en A4, oculta en 80/58 mm')
    await page.screenshot({ path: path.join(shots, '06-nota-servicio-a4.png') })
    await page.getByLabel('Cerrar vista previa').click()

    await page.getByText('Inventario', { exact: true }).first().click()
    await page.getByText('Referencia rotativa 1.5', { exact: true }).first().waitFor({ timeout: 15000 })
    await page.getByLabel('Editar Referencia rotativa 1.5').click()
    await page.getByRole('dialog', { name: 'Editar referencia' }).waitFor({ timeout: 15000 })
    await page.screenshot({ path: path.join(shots, '07-editar-referencia.png') })
    await page.getByRole('dialog', { name: 'Editar referencia' }).getByRole('button', { name: 'Cancelar' }).click()
    await page.keyboard.press('Escape')
    pass('edición de referencia visible para el propietario')

    await page.getByText('Órdenes de trabajo', { exact: true }).first().click()
    await page.getByText(order.number, { exact: true }).first().click()
    await page.getByRole('button', { name: 'Imprimir' }).first().click()
    await page.getByText('Términos esenciales', { exact: false }).first().waitFor({ timeout: 15000 })
    const versionLabels = await page.getByText(/v1\.0/).count()
    assert(versionLabels === 0, `La versión v1.0 sigue visible en el comprobante (${versionLabels})`)
    pass('términos impresos sin versión v1.0')
    await page.screenshot({ path: path.join(shots, '01-terminos-sin-version.png') })

    await page.evaluate((token) => sessionStorage.setItem('bitacoretech.session.token', token), adminToken)
    await page.reload()
    await page.getByText('Configuración', { exact: true }).first().waitFor({ timeout: 30000 })
    await page.getByText('Configuración', { exact: true }).first().click()
    await page.getByText('Usuarios y roles', { exact: true }).first().click()
    await page.getByText('Owner T4', { exact: true }).first().waitFor({ timeout: 15000 })
    await page.getByLabel('Cambiar foto de Owner T4').click()
    await page.getByText('Solo cambia la foto', { exact: false }).waitFor({ timeout: 15000 })
    await page
      .getByRole('dialog', { name: 'Foto de perfil' })
      .locator('input[type="file"]')
      .setInputFiles({
        name: 'owner.png',
        mimeType: 'image/png',
        buffer: Buffer.from(tinyPng.split(',')[1], 'base64')
      })
    await page.getByRole('button', { name: 'Guardar foto' }).click()
    await page.getByText('Foto de perfil actualizada', { exact: false }).first().waitFor({ timeout: 15000 })
    pass('admin cambia la foto del propietario desde la interfaz')
    await page.screenshot({ path: path.join(shots, '02-admin-foto-propietario.png') })

    await page.evaluate((token) => sessionStorage.setItem('bitacoretech.session.token', token), ownerToken)
    await page.reload()
    await page.getByText('Punto de venta', { exact: true }).first().waitFor({ timeout: 30000 })
    assert((await page.locator('img[alt="Owner T4"]').count()) > 0, 'La foto del propietario no se muestra en el avatar global')
    pass('foto de perfil visible en topbar/sidebar')
    await page.screenshot({ path: path.join(shots, '03-avatar-foto.png') })

    await app.close()
    closed = true

    app = await launch()
    const loginPage = await app.firstWindow()
    await loginPage.waitForFunction(() => Boolean(window.bitacoretech), null, { timeout: 30000 })
    await loginPage.getByText('Bienvenido de nuevo', { exact: true }).waitFor({ timeout: 20000 })
    const tokenAfterClose = await loginPage.evaluate(() => sessionStorage.getItem('bitacoretech.session.token'))
    assert(!tokenAfterClose, 'El token sobrevivió al cierre de la aplicación')
    pass('la sesión se cierra al cerrar la aplicación')
    await loginPage.screenshot({ path: path.join(shots, '04-sesion-cerrada.png') })
    await app.close()
    closed = true
  } catch (error) {
    fail('flujo 1.5.0', error)
  } finally {
    if (!closed) await app.close().catch(() => {})
  }

  const failed = results.filter((item) => !item.ok)
  console.log(`\nRESULT ${results.length - failed.length}/${results.length} OK`)
  console.log('ROOT=' + root)
  if (failed.length) process.exit(1)
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
