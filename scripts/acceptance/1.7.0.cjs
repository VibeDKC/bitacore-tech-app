const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))

const root = process.env.BITACORETECH_TEST_ROOT || path.join(os.tmpdir(), 'bitacoretech-acceptance', '1.7.0')
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
    model: 'ThinkPad T7',
    serial: input.serial,
    accessories: 'Cargador',
    physicalCondition: 'Sin observaciones',
    reportedIssue: 'No enciende. Prueba de credenciales.',
    technicianId: input.technicianId,
    promisedAt: futureDate(),
    notes: 'OT de aceptación 1.7.0',
    credentials: input.credentials,
    intake: {
      category: 'laptop',
      categoryLabel: 'Portátil',
      estimate: 250000,
      diagnosticFee: 0,
      accessories: ['Cargador'],
      powerState: 'no_enciende',
      conditions: {},
      conditionNotes: '',
      lockType: 'contrasena',
      customerAuthorizesAccess: Boolean(input.credentials),
      customerWithheldCredentials: !input.credentials,
      technicalSheet: {
        os: 'Windows 11',
        cpu: { brand: 'Intel', family: 'Core i5', model: 'i5-1135G7' },
        ramModules: [{ id: 'ram_1', type: 'DDR4', capacity: '8 GB', speed: '3200 MHz', brand: 'Kingston', warranty: '12 meses' }],
        storageDrives: [{ id: 'disk_1', type: 'SSD M.2 NVMe', capacity: '512 GB', speed: '3000 MB/s', model: 'NV2', health: 'Bueno', warranty: '12 meses' }],
        battery: 'Buena'
      }
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
    await page.getByPlaceholder('Nombre y apellido').fill('Owner 1.7')
    await page.locator('input[placeholder="BitacoreTech"]').fill('Taller 1.7')
    await page.getByPlaceholder('usuario').fill('owner')
    await page.getByPlaceholder('Mínimo 8 caracteres').fill('Owner12345')
    await page.getByPlaceholder('Repite la contraseña').fill('Owner12345')
    await page.getByRole('button', { name: 'Crear cuenta y entrar' }).click()
    await page.getByText('Ventas hoy', { exact: true }).first().waitFor({ timeout: 30000 })
    pass('primer arranque 1.7.0')

    const tech1 = await rpc(page, 'users.create', {
      name: 'Técnico Credenciales',
      username: 'tec7a',
      email: 'tec7a@taller.co',
      role: 'tecnico',
      password: 'Tecnico12345'
    })
    const tech2 = await rpc(page, 'users.create', {
      name: 'Técnico Ajeno',
      username: 'tec7b',
      email: 'tec7b@taller.co',
      role: 'tecnico',
      password: 'Tecnico12345'
    })
    const admin = await rpc(page, 'users.create', {
      name: 'Admin Credenciales',
      username: 'admin7',
      email: 'admin7@taller.co',
      role: 'admin',
      password: 'Admin12345'
    })
    const tech1Login = await rpc(page, 'auth.login', { username: 'tec7a', password: 'Tecnico12345' })
    const tech2Login = await rpc(page, 'auth.login', { username: 'tec7b', password: 'Tecnico12345' })
    const adminLogin = await rpc(page, 'auth.login', { username: 'admin7', password: 'Admin12345' })
    const customer = await rpc(page, 'customers.create', {
      name: 'Cliente Credenciales',
      documentType: 'CC',
      document: '90909090',
      phone: '3112223344'
    })

    const secret = 'ClaveSuperSecreta-7'
    const order = await createOrder(page, {
      customerId: customer.id,
      serial: 'T7-SERIAL-001',
      technicianId: tech1.id,
      credentials: { username: 'soporte', secret, note: 'Usuario local de Windows' }
    })
    assert(order.hasCredentials === true, 'La OT no reporta credenciales guardadas')
    assert(order.hasCredentials && !JSON.stringify(order).includes(secret), 'La credencial se filtró en orderDto')

    const revealedOwner = await rpc(page, 'orders.revealCredentials', { id: order.id })
    assert(revealedOwner.secret === secret, 'El propietario no pudo descifrar la credencial')
    const revealedTech = await rpc(page, 'orders.revealCredentials', { id: order.id }, tech1Login.token)
    assert(revealedTech.secret === secret, 'El técnico asignado no pudo ver la credencial')
    const forbiddenTech = await rpcRaw(page, 'orders.revealCredentials', { id: order.id }, tech2Login.token)
    assert(!forbiddenTech.ok, 'Un técnico no asignado pudo ver la credencial')
    const revealedAdmin = await rpc(page, 'orders.revealCredentials', { id: order.id }, adminLogin.token)
    assert(revealedAdmin.secret === secret, 'El admin no pudo ver la credencial')
    const audit = await rpc(page, 'audit.list')
    assert(
      audit.some((entry) => entry.action === 'Consulta de credenciales del equipo'),
      'La consulta de credenciales no quedó en auditoría'
    )
    const updated = await rpc(page, 'orders.setCredentials', { id: order.id, username: 'soporte', secret: 'NuevaClave-7', note: 'Actualizada' })
    assert(updated.hasCredentials === true, 'La credencial actualizada no quedó registrada')
    const revealedUpdated = await rpc(page, 'orders.revealCredentials', { id: order.id })
    assert(revealedUpdated.secret === 'NuevaClave-7', 'La credencial actualizada no se recuperó')
    pass('credenciales cifradas, acceso restringido y auditoría de consultas')

    await page.getByText('Órdenes de trabajo', { exact: true }).first().click()
    await page.getByText(order.number, { exact: true }).first().click()
    await page.getByText('Credenciales del equipo', { exact: true }).first().waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: 'Ver credencial' }).click()
    const credentialsDialog = page.getByRole('dialog', { name: 'Credencial del equipo' })
    await credentialsDialog.waitFor({ timeout: 15000 })
    await credentialsDialog.getByLabel('Mostrar credencial').click()
    await credentialsDialog.getByText('NuevaClave-7', { exact: true }).waitFor({ timeout: 15000 })
    pass('la OT muestra la credencial al técnico autorizado')
    await page.screenshot({ path: path.join(shots, '01-credencial-ot.png') })
    await credentialsDialog.getByRole('button', { name: 'Cerrar', exact: true }).last().click()

    await page.getByText('Configuración', { exact: true }).first().click()
    await page.getByText('Mensajes', { exact: true }).first().click()
    await page.getByText('Mensajes para clientes', { exact: true }).first().waitFor({ timeout: 15000 })
    const initialTextarea = page.locator('textarea').first()
    await initialTextarea.fill('Hola {{cliente}}, tu {{equipo}} {{ot}} está en {{estado}}. Diagnóstico: {{diagnostico}}. Presupuesto: {{presupuesto}}.')
    await page.getByRole('button', { name: 'Guardar mensajes' }).click()
    await page.getByText('Mensajes actualizados', { exact: false }).first().waitFor({ timeout: 15000 })
    const settingsAfter = await rpc(page, 'settings.get')
    assert(settingsAfter.messages.initial.includes('{{diagnostico}}'), 'El mensaje inicial no se guardó')
    pass('editor de mensajes predeterminados funcional')
    await page.screenshot({ path: path.join(shots, '02-mensajes.png') })

    await page.getByText('Órdenes de trabajo', { exact: true }).first().click()
    await page.getByRole('button', { name: 'Nueva OT' }).first().click()
    await page.getByText('Recepción de equipo', { exact: true }).first().waitFor({ timeout: 20000 })
    const lockSelect = page
      .locator('select')
      .filter({ has: page.locator('option', { hasText: 'Contraseña' }) })
      .first()
    await lockSelect.selectOption('contrasena')
    await page.getByText('El cliente autoriza el acceso y desbloqueo del equipo para el diagnóstico.').click()
    await page.getByText('Credencial temporal del equipo', { exact: true }).first().waitFor({ timeout: 15000 })
    await page.getByPlaceholder('Se guarda cifrada').waitFor({ timeout: 15000 })
    pass('recepción permite capturar la credencial temporal')
    await page.screenshot({ path: path.join(shots, '04-credencial-recepcion.png') })

    const initialReport = await rpc(page, 'orders.diagnosticReport', { id: order.id, mode: 'initial' })
    assert(fs.existsSync(initialReport.path), 'No se generó el PDF del reporte inicial')
    assert(fs.statSync(initialReport.path).size > 1000, 'El PDF inicial está vacío')
    assert(initialReport.phoneFound === true && initialReport.whatsappUrl, 'No se preparó el enlace de WhatsApp')
    assert(initialReport.whatsappOpened === false, 'El test abrió WhatsApp externo')
    assert(initialReport.message.includes('Cliente Credenciales'), 'El mensaje no resolvió el cliente')
    assert(!initialReport.message.includes('NuevaClave-7'), 'El mensaje del reporte incluyó la credencial')
    pass('reporte inicial PDF y mensaje de WhatsApp sin credenciales')

    for (const status of ['diagnostico', 'aprobacion', 'reparacion', 'pruebas', 'listo']) {
      await rpc(page, 'orders.transition', { id: order.id, status })
    }
    const deliveryReport = await rpc(page, 'orders.diagnosticReport', { id: order.id, mode: 'delivery' })
    assert(fs.existsSync(deliveryReport.path), 'No se generó el PDF del reporte de entrega')
    assert(deliveryReport.fileName.includes('delivery'), 'El reporte de entrega no se identificó')
    assert(deliveryReport.whatsappUrl, 'El reporte de entrega no preparó WhatsApp')
    assert(deliveryReport.message.includes('listo'), 'El mensaje de entrega no usó la plantilla configurable')
    pass('reporte de entrega PDF y mensaje de equipo listo')

    await rpc(page, 'cash.open', { initialAmount: 100000 })
    const settled = await rpc(page, 'orders.settle', {
      id: order.id,
      noCharge: true,
      exceptionReason: 'Prueba de entrega 1.7.0'
    })
    assert(settled.status === 'entregado', 'La OT no se entregó')
    assert(settled.balance === 0, `La entrega sin cobro dejó saldo: ${settled.balance}`)
    assert(settled.hasCredentials === false, 'Las credenciales no se borraron al entregar')
    const revealAfterDelivery = await rpcRaw(page, 'orders.revealCredentials', { id: order.id })
    assert(!revealAfterDelivery.ok, 'Las credenciales sobrevivieron a la entrega')
    pass('borrado automático de credenciales al entregar')

    const noRepair = await createOrder(page, {
      customerId: customer.id,
      serial: 'T7-SERIAL-002',
      technicianId: tech1.id,
      credentials: { username: 'local', secret: 'NoReparar-7', note: '' }
    })
    assert(noRepair.hasCredentials === true, 'La segunda OT no guardó credenciales')
    const closed = await rpc(page, 'orders.transition', { id: noRepair.id, status: 'no_reparado', reason: 'Equipo sin reparación viable' })
    assert(closed.status === 'no_reparado', 'La OT no se cerró como no reparada')
    assert(closed.hasCredentials === false, 'Las credenciales no se borraron al cerrar como no reparado')
    pass('borrado automático de credenciales al cerrar como no reparado')

    const manual = await createOrder(page, {
      customerId: customer.id,
      serial: 'T7-SERIAL-003',
      technicianId: tech1.id,
      credentials: { username: 'local', secret: 'Manual-7', note: '' }
    })
    const deleted = await rpc(page, 'orders.deleteCredentials', { id: manual.id })
    assert(deleted.hasCredentials === false, 'La eliminación manual no quitó las credenciales')
    pass('eliminación manual de credenciales')

    await page.getByText('Órdenes de trabajo', { exact: true }).first().click()
    await page.getByText(order.number, { exact: true }).first().click()
    await page.getByText('Equipo y recepción', { exact: true }).first().waitFor({ timeout: 15000 })
    assert((await page.getByRole('button', { name: 'Reporte inicial' }).count()) > 0, 'Falta el botón de reporte inicial')
    assert((await page.getByRole('button', { name: 'Reporte de entrega' }).count()) > 0, 'Falta el botón de reporte de entrega')
    pass('la OT expone reportes inicial y de entrega')
    await page.screenshot({ path: path.join(shots, '03-reportes-ot.png') })

    await app.close()
  } catch (error) {
    fail('flujo 1.7.0', error)
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
